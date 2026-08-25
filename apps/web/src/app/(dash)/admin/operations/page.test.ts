import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Operations provider health window", () => {
  it("按服务商和上游模型展示近 90 天健康数据且不显示 UUID", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const zh = JSON.parse(readFileSync(new URL("../../../../../messages/zh-CN.json", import.meta.url), "utf8")) as {
      admin: { operations: { providerHealthTitle: string } };
    };
    const en = JSON.parse(readFileSync(new URL("../../../../../messages/en.json", import.meta.url), "utf8")) as {
      admin: { operations: { providerHealthTitle: string } };
    };

    expect(page).toContain("statement_timestamp() - interval '90 days'");
    expect(page).toContain("s.gatewayExecutions.providerName");
    expect(page).toContain("s.gatewayExecutions.upstreamModel");
    expect(page).toContain("s.gatewayExecutions.model");
    expect(page).not.toContain("{r.providerRef as string}");
    expect(zh.admin.operations.providerHealthTitle).toContain("近 90 天");
    expect(en.admin.operations.providerHealthTitle).toContain("last 90 days");
  });
});
