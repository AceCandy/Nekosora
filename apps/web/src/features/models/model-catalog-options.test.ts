import { describe, expect, it } from "vitest";
import { rankCatalogOptions } from "./model-catalog-options";

const catalog = [
  { name: "GPT-4o", canonicalModelId: "gpt-4o" },
  { name: "DeepSeek V3", canonicalModelId: "deepseek-v3" },
  { name: "DALL-E 3", canonicalModelId: "dall-e-3" },
  { name: "通用聊天", canonicalModelId: "__generic_chat__" },
  { name: "Claude Sonnet", canonicalModelId: "claude-sonnet" },
];

describe("rankCatalogOptions", () => {
  it("优先展示通用模板和与当前模型名同前缀或同首字母的模板", () => {
    expect(rankCatalogOptions(catalog, "deepseek-v4-flash").map((entry) => entry.name)).toEqual([
      "通用聊天",
      "DeepSeek V3",
      "DALL-E 3",
      "Claude Sonnet",
      "GPT-4o",
    ]);
  });

  it("按模板名称或规范模型 ID 搜索", () => {
    expect(rankCatalogOptions(catalog, "", "sonnet").map((entry) => entry.name)).toEqual(["Claude Sonnet"]);
  });
});
