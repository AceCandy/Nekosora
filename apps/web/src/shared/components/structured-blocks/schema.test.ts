import { describe, expect, it } from "vitest";
import { parsePartialMetricItems, parseStructured } from "./schema";

describe("parseStructured", () => {
  it("合法 chart JSON 解析成功", () => {
    const raw = JSON.stringify({
      type: "bar",
      xKey: "day",
      series: [{ key: "v", label: "值" }],
      data: [{ day: "一", v: 1 }],
    });
    const r = parseStructured("chart", raw);
    expect(r.ok).toBe(true);
  });

  it("jsonrepair 也修不好的 JSON 返回 invalid_json", () => {
    // 两个根对象连写:jsonrepair 无法修复(strict 同样失败)
    const r = parseStructured("chart", '{"a":1}{"b":2}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_json");
  });

  it("chart 缺 series 返回 schema_mismatch", () => {
    const r = parseStructured("chart", JSON.stringify({ type: "bar", data: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema_mismatch");
  });

  it("chart type 非法返回 schema_mismatch", () => {
    const r = parseStructured(
      "chart",
      JSON.stringify({ type: "radar", series: [{ key: "v" }], data: [] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema_mismatch");
  });

  it("metric 合法（含 trend / delta）", () => {
    const r = parseStructured(
      "metric",
      JSON.stringify({ label: "QPS", value: 120, unit: "/s", trend: "up", delta: "+12%" }),
    );
    expect(r.ok).toBe(true);
  });

  it("metric value 缺失返回 schema_mismatch", () => {
    const r = parseStructured("metric", JSON.stringify({ label: "QPS" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema_mismatch");
  });

  it("metric 数组(多指标)解析成功", () => {
    const raw = JSON.stringify([
      { label: "最高温", value: 35, unit: "℃", trend: "up" },
      { label: "最低温", value: 22, unit: "℃", trend: "flat" },
    ]);
    const r = parseStructured("metric", raw);
    expect(r.ok).toBe(true);
  });

  it("metric 程度族 trend(high/medium/low)解析成功", () => {
    const r = parseStructured(
      "metric",
      JSON.stringify([
        { label: "雷雨概率", value: 70, unit: "%", trend: "high" },
        { label: "降水日数", value: 2, unit: "天", trend: "low" },
      ]),
    );
    expect(r.ok).toBe(true);
  });

  it("metric 流式增量:半截数组只返回已闭合的指标项", () => {
    const raw = `[
      {"label": "周三", "value": 70, "unit": "%", "trend": "high"},
      {"label": "周二", "val`;
    const items = parsePartialMetricItems(raw);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("周三");
    expect(items[0].trend).toBe("high");
  });

  it("metric 流式增量:字符串内的括号不误切,且字段缺失项被丢弃", () => {
    // label 里含 } 字符,且第二个元素缺 value(未闭合,本就不会被切)
    const raw = `[
      {"label": "a}b", "value": 1},
      {"label": "c"`;
    const items = parsePartialMetricItems(raw);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("a}b");
  });

  it("metric 流式增量:未出现数组起始括号返回空", () => {
    expect(parsePartialMetricItems("")).toEqual([]);
    expect(parsePartialMetricItems("[")).toEqual([]);
  });

  it("metric 空数组返回 schema_mismatch", () => {
    const r = parseStructured("metric", JSON.stringify([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema_mismatch");
  });

  it("table 合法", () => {
    const r = parseStructured(
      "table",
      JSON.stringify({ columns: [{ key: "a", label: "A" }], rows: [{ a: "x" }] }),
    );
    expect(r.ok).toBe(true);
  });

  it("table 缺 columns 返回 schema_mismatch", () => {
    const r = parseStructured("table", JSON.stringify({ rows: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema_mismatch");
  });

  it("callout 合法（含 type/title/body）", () => {
    const r = parseStructured(
      "callout",
      JSON.stringify({ type: "warning", title: "额度将耗尽", body: "剩余请求不足 5%。" }),
    );
    expect(r.ok).toBe(true);
  });

  it("callout type 非法返回 schema_mismatch", () => {
    const r = parseStructured("callout", JSON.stringify({ type: "info", body: "x" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema_mismatch");
  });
});

// 宽容修复:strict JSON.parse 失败时由 jsonrepair 兜底,覆盖模型常见坏 JSON。
describe("parseStructured 宽容修复(jsonrepair)", () => {
  it("数字加引号 + 逗号关进引号(真实坏样本)→ metric 解析成功", () => {
    // 模型实际产出:value 被引号、逗号被关进引号、下一字段 unit 丢逗号丢引号
    const raw = `{"label":"海岸线长度","value":"18039,"unit":"km","trend":"flat"}`;
    const r = parseStructured("metric", raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const item = (r.data as Array<{ value: unknown }>)[0] ?? r.data;
      expect((item as { value: unknown }).value).toBe("18039");
    }
  });

  it("数组里每条都坏 → 全部修复成功", () => {
    const raw = `[
      {"label":"内陆河流总长度","value":"211000,"unit":"km","trend":"high"},
      {"label":"长江长度","value":"6300,"unit":"km","trend":"up"}
    ]`;
    const r = parseStructured("metric", raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toHaveLength(2);
  });

  it("末尾多余逗号 → 修复成功", () => {
    const raw = `{"label":"QPS","value":120,"unit":"/s",}`;
    const r = parseStructured("metric", raw);
    expect(r.ok).toBe(true);
  });

  it("strict 合法时不改变行为(仍成功)", () => {
    const raw = JSON.stringify({ label: "QPS", value: 120, trend: "up" });
    const r = parseStructured("metric", raw);
    expect(r.ok).toBe(true);
  });

  it("两对象连写(无法修复)→ 仍 invalid_json", () => {
    const raw = `{"label":"a","value":1}{"label":"b","value":2}`;
    const r = parseStructured("metric", raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_json");
  });

  it("流式增量逐项修复:可切出的项含末尾多余逗号也被救回", () => {
    // 第一项末尾多余逗号(strict 失败、jsonrepair 可修;引号平衡,扫描器能正确切出)
    const raw = `[
      {"label":"周三","value":70,"unit":"%","trend":"high",},
      {"label":"周二","val`;
    const items = parsePartialMetricItems(raw);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("周三");
  });
});
