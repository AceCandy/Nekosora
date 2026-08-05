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

  it("首条非字符串 system content 不会在槽位组装时丢失", () => {
    const systemContent = [
      { type: "text", text: "多模态系统提示" },
      { type: "image_url", image_url: { url: "data:image/png;base64,system" } },
    ];
    const result = assembleContext({
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: "你好" },
      ],
      memories: [],
      compaction: noCompaction,
      fileContext: "文件上下文",
      maxTokens: 32_000,
    });

    expect(result.some((message) => message.role === "system" && message.content === systemContent)).toBe(true);
    expect(JSON.stringify(result)).toContain("文件上下文");
    expect(JSON.stringify(result)).toContain("你好");
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

describe("assembleContext 压缩后丢弃旧历史", () => {
  it("有摘要时移除被覆盖的旧消息,保留摘要 + 最近轮", () => {
    // 12 个 user 轮 → 默认保留最近 8 轮,前 4 轮应被丢弃
    const messages: { role: string; content: string | unknown[] }[] = [
      { role: "system", content: "系统提示" },
    ];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: "user", content: `OLD_USER_${i}` });
      messages.push({ role: "assistant", content: `OLD_ASSISTANT_${i}` });
    }
    messages.push({ role: "user", content: "RECENT_TAIL_USER" });

    const result = assembleContext({
      messages,
      memories: [],
      compaction: {
        compacted: true,
        summary: "长对话摘要正文",
        strategy: "turn_cap",
        fallbackLevel: "L3",
      },
      fileContext: null,
      maxTokens: 32000,
      preserveRecentTurns: 8,
    });

    const serialized = JSON.stringify(result);
    // 证明旧历史被移除,而非仅断言摘要存在
    // retainRecentTurns 与 compact 一致:数满 8 个 user 后在下一 user 处截断,
    // 截断点前一条 assistant 可能仍保留(与 maybeCompact 窗口对齐)
    expect(serialized).not.toContain("OLD_USER_0");
    expect(serialized).not.toContain("OLD_ASSISTANT_0");
    expect(serialized).not.toContain("OLD_USER_4");
    expect(serialized).toContain("OLD_USER_5");
    expect(serialized).toContain("RECENT_TAIL_USER");
    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("[先前对话摘要]");
    expect(result[0].content).toContain("长对话摘要正文");
    const nonSystem = result.filter((m) => m.role !== "system");
    expect(nonSystem.some((m) => m.content === "OLD_USER_0")).toBe(false);
    expect(nonSystem.some((m) => m.content === "RECENT_TAIL_USER")).toBe(true);
    // 被覆盖的最旧轮不得出现在发送集合
    expect(nonSystem.findIndex((m) => m.content === "OLD_USER_0")).toBe(-1);
    expect(nonSystem.length).toBeLessThan(messages.length - 1);
  });

  it("无摘要时不丢弃历史(即使 compacted=false)", () => {
    const messages = [
      { role: "user", content: "KEEP_OLD" },
      { role: "assistant", content: "KEEP_REPLY" },
      { role: "user", content: "now" },
    ];
    const result = assembleContext({
      messages,
      memories: [],
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 32000,
    });
    expect(JSON.stringify(result)).toContain("KEEP_OLD");
    expect(JSON.stringify(result)).toContain("KEEP_REPLY");
  });
});

describe("assembleContext 输入 token 预算", () => {
  it("超出 maxTokens 时裁掉最早非 system 消息,保留 system 与最近消息", () => {
    const messages: { role: string; content: string | unknown[] }[] = [
      { role: "system", content: "SYS_KEEP" },
    ];
    for (let i = 0; i < 20; i++) {
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `PAD_${i}_` + "x".repeat(200),
      });
    }
    messages.push({ role: "user", content: "LATEST_USER_MSG" });

    const result = assembleContext({
      messages,
      memories: [],
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 400, // 远小于全部消息
      preserveRecent: 4,
    });

    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("SYS_KEEP");
    expect(JSON.stringify(result)).toContain("LATEST_USER_MSG");
    // 最早填充应被裁掉
    expect(JSON.stringify(result)).not.toContain("PAD_0_");
    expect(result.length).toBeLessThan(messages.length);
  });

  it("预算裁剪保留多模态 content 数组结构", () => {
    const imageContent = [
      { type: "text", text: "看看这张图" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ];
    const messages: { role: string; content: string | unknown[] }[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: "user", content: `history_${i}_` + "y".repeat(120) });
      messages.push({ role: "assistant", content: `reply_${i}_` + "z".repeat(120) });
    }
    messages.push({ role: "user", content: imageContent });

    const result = assembleContext({
      messages,
      memories: [],
      compaction: noCompaction,
      fileContext: null,
      maxTokens: 500,
      preserveRecent: 2,
    });

    const last = result[result.length - 1];
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual(imageContent);
    expect(result[0]?.role === "system" || result.some((m) => m.role === "user")).toBe(true);
  });

  it("预算内不改变无 slot 消息的引用", () => {
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
});
