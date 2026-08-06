import { describe, it, expect } from "vitest";
import { estimateMessagesTokens, estimateTokens, trimToTokenBudget } from "@/lib/tokens";

describe("estimateTokens", () => {
  it("中文按 CJK 规则估算", () => {
    // 6 字 → ceil(6*2/3)=4
    expect(estimateTokens("你好世界测试")).toBe(4);
  });

  it("英文约每 4 字符 1 token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars
  });
});

describe("trimToTokenBudget", () => {
  it("预算充足时保留 system 与最近 preserveRecent 条", () => {
    const messages = [
      { role: "system", content: "SYSTEM" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `m${i}_` + "w".repeat(80),
      })),
    ];
    const trimmed = trimToTokenBudget(messages, 200, 4);
    expect(trimmed[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(trimmed.length).toBeLessThan(messages.length);
    // 最近 4 条非 system 必须在
    const nonSystem = trimmed.filter((m) => m.role !== "system");
    expect(nonSystem.length).toBeGreaterThanOrEqual(4);
    expect(nonSystem.slice(-4).map((m) => m.content)).toEqual(
      messages.filter((m) => m.role !== "system").slice(-4).map((m) => m.content),
    );
  });

  it("极小预算下仍严格不超过上限", () => {
    const messages = [
      { role: "system", content: "system_" + "s".repeat(400) },
      { role: "user", content: "latest_" + "u".repeat(400) },
    ];
    const trimmed = trimToTokenBudget(messages, 12, 1);

    expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(12);
    expect(trimmed.at(-1)?.role).toBe("user");
  });

  it("跳过超预算旧消息后仍保留更近且可容纳的消息", () => {
    const messages = [
      { role: "user", content: "oversized_" + "x".repeat(800) },
      { role: "assistant", content: "small" },
      { role: "user", content: "latest" },
    ];
    const trimmed = trimToTokenBudget(messages, 16, 1);

    expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(16);
    expect(trimmed.map((m) => m.content)).toEqual(["small", "latest"]);
  });

  it("图片超过剩余预算时会移除图片 part", () => {
    const messages = [{
      role: "user",
      content: [
        { type: "text", text: "caption" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
      ],
    }];
    const trimmed = trimToTokenBudget(messages, 12, 1);

    expect(estimateMessagesTokens(trimmed)).toBeLessThanOrEqual(12);
    expect(trimmed[0].content).toEqual([{ type: "text", text: "caption" }]);
  });

  it("预算充足时保留全部消息顺序", () => {
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ];
    const trimmed = trimToTokenBudget(messages, 10_000, 8);
    expect(trimmed).toEqual(messages);
  });

  it("图片 content 按固定 token 计入且整条保留", () => {
    const img = {
      role: "user",
      content: [
        { type: "text", text: "img" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
      ],
    };
    const messages = [
      { role: "user", content: "old_" + "n".repeat(400) },
      { role: "assistant", content: "old_a_" + "n".repeat(400) },
      img,
    ];
    const trimmed = trimToTokenBudget(messages, 300, 1);
    expect(trimmed[trimmed.length - 1]).toEqual(img);
    expect(estimateMessagesTokens([img])).toBeGreaterThan(255);
  });
});
