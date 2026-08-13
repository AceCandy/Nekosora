import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Operations provider health window", () => {
  it("统计和双语标题都明确限制为近 90 天", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const zh = JSON.parse(readFileSync(new URL("../../../../../messages/zh-CN.json", import.meta.url), "utf8")) as {
      admin: { operations: { providerHealthTitle: string } };
    };
    const en = JSON.parse(readFileSync(new URL("../../../../../messages/en.json", import.meta.url), "utf8")) as {
      admin: { operations: { providerHealthTitle: string } };
    };

    expect(page).toContain("statement_timestamp() - interval '90 days'");
    expect(zh.admin.operations.providerHealthTitle).toContain("近 90 天");
    expect(en.admin.operations.providerHealthTitle).toContain("last 90 days");
  });
});
