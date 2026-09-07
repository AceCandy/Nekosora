import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UsageDashboard, UsageSummary } from "./UsageDashboard";
import { CollapsibleStats } from "./CollapsibleStats";
import { UsageTabs } from "./UsageTabs";
import { DateRangePicker } from "./DateRangePicker";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh-CN.json";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./UsageCharts", () => ({ RequestsTrendChart: () => null, ModelTokensChart: () => null, ModelCallsPie: () => null, SourceBar: () => null }));

describe("用量查询层级", () => {
  it("自定义日期有可访问名称，中英文均有对应文案", () => {
    const html = renderToStaticMarkup(<DateRangePicker range="custom" start="2026-08-01" end="2026-08-02" onChange={() => {}} />);
    expect(html).toContain('aria-label="startDate"');
    expect(html).toContain('aria-label="endDate"');
    expect(zh.admin.usage.startDate).toBe("开始日期");
    expect(en.admin.usage.endDate).toBe("End date");
  });
  it("默认收起图表，空图表合并成一条提示", () => {
    const html = renderToStaticMarkup(<CollapsibleStats><UsageDashboard series={[]} byModel={[]} bySource={[]} /></CollapsibleStats>);
    expect(html).toContain("<summary");
    expect(html).not.toContain(" open=");
    expect(html.match(/chartEmptyRange/g)).toHaveLength(1);
    expect(html).not.toContain("chartModelTokens");
  });
  it("摘要声明所选范围，不误称全部时间", () => {
    const html = renderToStaticMarkup(<UsageSummary totals={{ calls: 2, promptTokens: 3, completionTokens: 5 }} />);
    expect(html).toContain("statsScope");
    expect(html).not.toContain("metricAllTime");
    expect(html.match(/<dd /g)).toHaveLength(3);
  });
  it("切换明细和错误保留自定义日期及全部用户范围", () => {
    const html = renderToStaticMarkup(<UsageTabs current="usage" basePath="/panel/usage" range="custom" start="2026-08-01" end="2026-08-02" user="__all__" />);
    expect(html).toContain("start=2026-08-01&amp;end=2026-08-02&amp;user=__all__&amp;tab=errors");
  });
});
