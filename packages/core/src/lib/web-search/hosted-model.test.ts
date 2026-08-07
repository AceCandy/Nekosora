import { describe, expect, it } from "vitest";
import { buildHostedSearchPrompt, normalizeHostedSources } from "./hosted-model";

describe("buildHostedSearchPrompt", () => {
  it("注入当前日期并要求最新问题核对来源日期", () => {
    const prompt = buildHostedSearchPrompt(
      "最新的模型发布信息",
      new Date("2026-08-03T12:00:00.000Z"),
    );

    expect(prompt).toContain("当前日期（UTC）：2026-08-03");
    expect(prompt).toContain("发布日期或更新时间更近");
    expect(prompt).toContain("问题：最新的模型发布信息");
  });

  it("将不支持原生过滤的时间范围写入搜索提示词", () => {
    const prompt = buildHostedSearchPrompt(
      "OpenAI 最新动态",
      new Date("2026-08-07T12:00:00.000Z"),
      { preset: "week", startDate: "2026-08-01", endDate: "2026-08-07" },
    );

    expect(prompt).toContain("检索时间范围（UTC，含首尾日期）：2026-08-01 至 2026-08-07");
    expect(prompt).toContain("范围外信息仅可作为必要背景并明确说明");
  });

  it("保留来源提供的合法发布日期", () => {
    expect(normalizeHostedSources([{
      sourceType: "url",
      url: "https://example.com/news",
      title: "News",
      publishedAt: "2026-08-03",
    }])).toEqual([{
      title: "News",
      url: "https://example.com/news",
      snippet: "",
      publishedAt: "2026-08-03T00:00:00.000Z",
    }]);
  });
});
