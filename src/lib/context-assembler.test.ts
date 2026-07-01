import { describe, it, expect } from "vitest";
import { assembleContext } from "@/lib/context-assembler";
import type { UserMemory } from "@/lib/memory/service";
import type { CompactionResult } from "@/lib/compact/service";

const noCompaction: CompactionResult = {
  compacted: false,
  summary: null,
  strategy: "none",
  fallbackLevel: "none",
};

describe("assembleContext 基础行为", () => {
  it("无任何 slot 时原样返回 messages", () => {
    const messages = [{ role: "user", content: "你好" }];
    const result = assembleContext({
      messages,
      memories: [],
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 32000,
    });
    expect(result).toBe(messages);
  });

  it("有 slot 时在最前面插入聚合 system 消息", () => {
    const result = assembleContext({
      messages: [{ role: "user", content: "你好" }],
      memories: [],
      compaction: noCompaction,
      fileContext: "文件片段A",
      maxTokens: 32000,
    });
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("文件片段A");
    // 原 user 消息保留在后
    expect(result[1].role).toBe("user");
  });
});

describe("assembleContext 槽位组装", () => {
  it("已有 system 被纳入聚合 system,原 system 从对话中移除", () => {
    const result = assembleContext({
      messages: [
        { role: "system", content: "原始系统提示" },
        { role: "user", content: "你好" },
      ],
      memories: [],
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 32000,
    });
    // 只应有 1 个 system(聚合后的)+ 1 个 user
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("原始系统提示");
    expect(result[1].role).toBe("user");
  });

  it("templateSystemPrompt 作为 slot 纳入", () => {
    const result = assembleContext({
      messages: [{ role: "user", content: "你好" }],
      memories: [],
      compaction: noCompaction,
      fileContext: null,
      templateSystemPrompt: "模板指令",
      maxTokens: 32000,
    });
    expect(result[0].content).toContain("模板指令");
  });

  it("compaction.summary 包裹 [先前对话摘要] 标记", () => {
    const result = assembleContext({
      messages: [{ role: "user", content: "你好" }],
      memories: [],
      compaction: { compacted: true, summary: "之前的对话总结", strategy: "turn_cap", fallbackLevel: "L3" },
      fileContext: null,
      maxTokens: 32000,
    });
    expect(result[0].content).toContain("[先前对话摘要]");
    expect(result[0].content).toContain("之前的对话总结");
  });

  it("preference 记忆包裹 [用户偏好] 标记", () => {
    const memories: UserMemory[] = [
      { id: "1", scope: "preference", content: "喜欢中文回答", source: "ai" },
    ];
    const result = assembleContext({
      messages: [{ role: "user", content: "你好" }],
      memories,
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 32000,
    });
    expect(result[0].content).toContain("[用户偏好]");
    expect(result[0].content).toContain("喜欢中文回答");
  });

  it("profile 记忆包裹 [用户画像] 标记", () => {
    const memories: UserMemory[] = [
      { id: "2", scope: "profile", content: "前端工程师", source: "ai" },
    ];
    const result = assembleContext({
      messages: [{ role: "user", content: "你好" }],
      memories,
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 32000,
    });
    expect(result[0].content).toContain("[用户画像]");
    expect(result[0].content).toContain("前端工程师");
  });

  it("多 slot 用 \\n\\n---\\n\\n 分隔", () => {
    const result = assembleContext({
      messages: [{ role: "system", content: "系统A" }],
      memories: [{ id: "1", scope: "preference", content: "偏好B", source: "ai" }],
      compaction: { compacted: true, summary: "摘要C", strategy: "turn_cap", fallbackLevel: "L3" },
      fileContext: null,
      maxTokens: 32000,
    });
    const content = result[0].content as string;
    // 顺序:已有 system → compaction → preference
    expect(content).toContain("系统A");
    expect(content).toContain("[先前对话摘要]");
    expect(content).toContain("[用户偏好]");
    expect(content).toContain("\n\n---\n\n");
  });
});
