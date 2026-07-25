import { describe, expect, it } from "vitest";
import {
  calculateTokenBudgets,
  replaceMessageText,
  selectCurrentBranchMessages,
} from "@/lib/chat/orchestrator";

describe("calculateTokenBudgets", () => {
  it("小窗口仍为输入和输出各保留有效预算", () => {
    const result = calculateTokenBudgets(1_024, 16_384);

    expect(result.inputBudget).toBeLessThanOrEqual(1_024);
    expect(result.inputBudget).toBeGreaterThan(0);
    expect(result.maxOutputTokens).toBeGreaterThanOrEqual(1);
    expect(result.inputBudget + result.maxOutputTokens).toBeLessThanOrEqual(1_024);
  });

  it("非法目录预算回退到兼容默认值", () => {
    const result = calculateTokenBudgets(Number.NaN, Number.NaN);

    expect(result).toEqual({
      inputBudget: 15_616,
      maxOutputTokens: 16_384,
    });
  });
});

describe("selectCurrentBranchMessages", () => {
  it("只返回叶节点所在的 parent 链", () => {
    const messages = [
      { id: "u1", publicId: "pub-u1", parentId: null, content: "root" },
      { id: "a1", publicId: "pub-a1", parentId: "u1", content: "answer" },
      { id: "u2", publicId: "pub-u2", parentId: "a1", content: "branch-a" },
      { id: "u3", publicId: "pub-u3", parentId: "a1", content: "branch-b" },
    ];

    expect(selectCurrentBranchMessages(messages, "pub-u3").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u3",
    ]);
  });

  it("叶节点不存在时不回退到整段会话", () => {
    expect(selectCurrentBranchMessages([
      { id: "u1", publicId: "pub-u1", parentId: null },
    ], "missing")).toEqual([]);
  });
});

describe("replaceMessageText", () => {
  it("替换文本并保留图片 part", () => {
    const image = { type: "image_url", image_url: { url: "data:image/png;base64,xx" } };
    expect(replaceMessageText([
      { type: "text", text: "old" },
      image,
      { type: "text", text: "old-context" },
    ], "rendered")).toEqual([
      { type: "text", text: "rendered" },
      image,
    ]);
  });

  it("字符串内容直接替换", () => {
    expect(replaceMessageText("old", "rendered")).toBe("rendered");
  });
});
