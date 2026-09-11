import { afterEach, describe, expect, it, vi } from "vitest";
import { redirect, notFound } from "next/navigation";
import { loadChatData } from "./load-data";

afterEach(() => vi.restoreAllMocks());

describe("loadChatData", () => {
  it("成功时保留数据且不记录失败", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = { messages: [] };
    expect(await loadChatData("messages", Promise.resolve(data))).toBe(data);
    expect(log).not.toHaveBeenCalled();
  });

  it("核心失败只向外抛固定错误，可选失败返回缺省值", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new Error("SQL params: private text; postgres://private; Cookie: private");
    await expect(loadChatData("messages", Promise.reject(raw))).rejects.toThrow("Chat data could not be loaded");
    expect(await loadChatData("output-modes", Promise.reject(raw), () => [])).toEqual([]);
    expect(log.mock.calls).toEqual([
      ["[chat-load] messages failed"],
      ["[chat-load] output-modes failed"],
    ]);
  });

  it.each([redirect, notFound])("框架控制流不降级也不记录为故障", async (controlFlow) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let signal: unknown;
    try { controlFlow("/login"); } catch (error) { signal = error; }
    await expect(loadChatData("output-modes", Promise.reject(signal), () => [])).rejects.toBe(signal);
    expect(log).not.toHaveBeenCalled();
  });
});
