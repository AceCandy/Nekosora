import { describe, expect, it } from "vitest";
import { parseStructured } from "./schema";

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

  it("非法 JSON 返回 invalid_json", () => {
    const r = parseStructured("chart", "{not json");
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
