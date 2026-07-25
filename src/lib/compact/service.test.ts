/**
 * compact/service.ts 单测 —— 链式摘要 + 质量兜底 + 摘要模型可配(design §4)。
 *
 * 覆盖:
 *   - 链式合并:有 previousSummary 时 prompt 含旧摘要,LLM 在其基础上更新
 *   - 质量兜底:LLM 产出 < MIN_SUMMARY_CHARS(200) 拒绝覆盖,保留旧摘要 / 回退模板
 *   - 摘要模型可配:task.compact_model 配置优先,空则回退第一个 public+enabled
 *
 * 通过 mock DB + mock streamChat + mock getSetting 隔离真实依赖。
 * coveragePathHash / estimateMessagesTokens 为纯函数,走真实实现。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- 共享 mock 状态 ----
const mockData = vi.hoisted(() => ({
  snapshots: [] as Record<string, unknown>[],
  models: [] as Record<string, unknown>[],
  llmResponse: "" as string,
  compactModelSetting: null as string | null,
  compactModelIdSetting: null as string | null,
}));

// ---- mock drizzle-orm ----
vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ type: "eq", col, val }),
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  desc: (col: string) => ({ type: "desc", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: "sql", strings: [...strings], values }),
}));

// ---- mock @/lib/infra/db ----
// 链式 query builder:select(fields).from(table).where().orderBy().limit() 可在任意节点 await。
vi.mock("@/lib/infra/db", () => {
  function matches(row: Record<string, unknown>, cond: unknown): boolean {
    if (!cond) return true;
    const c = cond as { type: string; col?: string; val?: unknown; conds?: unknown[] };
    if (c.type === "eq") return row[c.col!] === c.val;
    if (c.type === "and") return c.conds!.every((sub) => matches(row, sub));
    return true;
  }

  function makeQuery(rows: Record<string, unknown>[], fields: Record<string, string> | undefined) {
    const chain = {
      where(cond: unknown) {
        return makeQuery(rows.filter((r) => matches(r, cond)), fields);
      },
      orderBy(...descs: { type: string; col?: string }[]) {
        if (descs.length === 0 || !descs[0] || !descs[0].col) return chain;
        const col = descs[0].col;
        const sorted = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av instanceof Date && bv instanceof Date) return bv.getTime() - av.getTime();
          if (typeof av === "number" && typeof bv === "number") return bv - av;
          return String(bv ?? "").localeCompare(String(av ?? ""));
        });
        return makeQuery(sorted, fields);
      },
      limit(n: number) {
        return makeQuery(rows.slice(0, n), fields);
      },
      then(resolve: (v: unknown[]) => void, reject: (e: unknown) => void) {
        const out = fields
          ? rows.map((r) => {
              const o: Record<string, unknown> = {};
              for (const [k, col] of Object.entries(fields)) o[k] = r[col];
              return o;
            })
          : rows.slice();
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return chain;
  }

  const schema = {
    contextSnapshots: {
      __table: "contextSnapshots",
      id: "id",
      conversationId: "conversationId",
      runId: "runId",
      coveredUntilMessageId: "coveredUntilMessageId",
      coveredUntilPublicId: "coveredUntilPublicId",
      coveragePathHash: "coveragePathHash",
      coveredMessageCount: "coveredMessageCount",
      sourceTokens: "sourceTokens",
      summaryTokens: "summaryTokens",
      summaryText: "summaryText",
      strategy: "strategy",
      createdAt: "createdAt",
    },
    models: { __table: "models", id: "id", name: "name", visibility: "visibility", enabled: "enabled" },
  };

  return {
    getDb: async () => ({
      select: (fields?: Record<string, string>) => ({
        from: (table: { __table: string }) =>
          makeQuery(table.__table === "models" ? mockData.models : mockData.snapshots, fields),
      }),
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          mockData.snapshots.push({
            ...row,
            id: row.id ?? `s${mockData.snapshots.length + 1}`,
            createdAt: new Date(),
          });
        },
      }),
    }),
    getSchema: () => schema,
    isPg: false,
  };
});

// ---- mock @/lib/system-settings/service ----
vi.mock("@/lib/system-settings/service", () => ({
  getSetting: vi.fn(async (_ns: string, key: string) =>
    key === "compact_model_id" ? mockData.compactModelIdSetting : mockData.compactModelSetting),
}));

// ---- mock @/lib/stream:返回配置好的 LLM 响应 ----
vi.mock("@/lib/stream", () => ({
  streamChat: vi.fn(async function* () {
    yield { type: "text-delta", text: mockData.llmResponse };
  }),
}));

import { maybeCompact, resetCompactModelConfig } from "./service";
import { streamChat } from "@/lib/stream";

beforeEach(() => {
  mockData.snapshots = [];
  mockData.models = [];
  mockData.llmResponse = "";
  mockData.compactModelSetting = null;
  mockData.compactModelIdSetting = null;
  resetCompactModelConfig();
  vi.mocked(streamChat).mockClear();
});

/** 生成 n 个 user 轮(每轮 user+assistant 共 2n 条消息)。 */
function makeMessages(nUserTurns: number) {
  const msgs = [];
  for (let i = 0; i < nUserTurns; i++) {
    const u = i + 1;
    msgs.push({
      id: `u${u}`,
      publicId: `pu${u}`,
      parentId: i === 0 ? null : `pa${i}`,
      role: "user",
      content: `用户消息${u}`,
    });
    msgs.push({
      id: `a${u}`,
      publicId: `pa${u}`,
      parentId: `pu${u}`,
      role: "assistant",
      content: `助手回复${u}`,
    });
  }
  return msgs;
}

const LONG_SUMMARY = "本次对话涵盖了多个主题:用户首先询问了项目架构,助手详细解释了前后端分离的设计方案,包括数据库选型、API 路由设计以及前端状态管理。随后用户进一步追问了部署相关的问题,助手介绍了容器化方案和 CI/CD 流程,涵盖镜像构建、环境变量管理、健康检查与滚动更新等细节。最后双方讨论了测试策略,确认采用单元测试与集成测试并重的方式,并对端到端测试的覆盖范围做了明确约定。整体讨论围绕工程实践展开,产出了若干关键决策与后续待办事项,需要团队在下一次评审会上同步。";

const PREV_SUMMARY = "这是先前对话的摘要内容,包含了早期讨论的关键信息。";

describe("maybeCompact 链式摘要", () => {
  it("有 previousSummary 时 prompt 含旧摘要(在其基础上合并更新)", async () => {
    // 预置一个前缀快照(同分支前缀:coveredUntilMessageId=u5,count < 当前 covered.length)
    mockData.snapshots = [
      {
        id: "snap-old",
        conversationId: "c1",
        coveragePathHash: "old-hash",
        coveredMessageCount: 9,
        coveredUntilMessageId: "u5",
        summaryText: PREV_SUMMARY,
        createdAt: new Date(Date.now() - 10000),
      },
    ];
    mockData.compactModelSetting = "compact-model-test";
    mockData.llmResponse = LONG_SUMMARY;

    const result = await maybeCompact("c1", makeMessages(20));

    // L3 成功(长摘要通过质量门)
    expect(result.compacted).toBe(true);
    expect(result.fallbackLevel).toBe("L3");
    // prompt 含旧摘要(链式合并)
    const call = vi.mocked(streamChat).mock.calls[0][0] as { request: { messages: { content: string }[] } };
    const prompt = call.request.messages[1].content;
    expect(prompt).toContain("[先前对话摘要]");
    expect(prompt).toContain(PREV_SUMMARY);
    expect(prompt).toContain("合并新对话内容");
    // 用了配置的摘要模型
    expect(call.request.model).toBe("compact-model-test");
    // 新快照保存了长摘要
    const saved = mockData.snapshots[mockData.snapshots.length - 1];
    expect(saved.summaryText).toBe(LONG_SUMMARY);
  });

  it("无 previousSummary 时 prompt 不含旧摘要锚点(从头摘)", async () => {
    mockData.snapshots = [];
    mockData.compactModelSetting = "compact-model-test";
    mockData.llmResponse = LONG_SUMMARY;

    await maybeCompact("c1", makeMessages(20));

    const call = vi.mocked(streamChat).mock.calls[0][0] as { request: { messages: { content: string }[] } };
    const prompt = call.request.messages[1].content;
    expect(prompt).not.toContain("[先前对话摘要]");
    expect(prompt).toContain("用户消息");
  });
});

describe("maybeCompact 质量兜底", () => {
  it("LLM 产出过短(<200)时拒绝覆盖,保留旧摘要(L1)", async () => {
    mockData.snapshots = [
      {
        id: "snap-old",
        conversationId: "c1",
        coveragePathHash: "old-hash",
        coveredMessageCount: 9,
        coveredUntilMessageId: "u5",
        summaryText: PREV_SUMMARY,
        createdAt: new Date(Date.now() - 10000),
      },
    ];
    mockData.compactModelSetting = "compact-model-test";
    mockData.llmResponse = "好的"; // 远小于 200

    const result = await maybeCompact("c1", makeMessages(20));

    // L3 / L2 均过短被拒,回退 L1 保留旧摘要
    expect(result.fallbackLevel).toBe("L1");
    expect(result.summary).toBe(PREV_SUMMARY);
    const saved = mockData.snapshots[mockData.snapshots.length - 1];
    expect(saved.summaryText).toBe(PREV_SUMMARY);
    // streamChat 被调用两次(L3 + L2)
    expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(2);
  });

  it("无旧摘要 + 过短产出 → L1 模板(非空)", async () => {
    mockData.snapshots = [];
    mockData.compactModelSetting = "compact-model-test";
    mockData.llmResponse = "好";

    const result = await maybeCompact("c1", makeMessages(20));

    expect(result.fallbackLevel).toBe("L1");
    expect(result.summary).toContain("上下文摘要不可用");
    const saved = mockData.snapshots[mockData.snapshots.length - 1];
    expect(saved.summaryText).toContain("上下文摘要不可用");
  });

  it("长摘要(>=200)正常接受(L3)", async () => {
    mockData.snapshots = [];
    mockData.compactModelSetting = "compact-model-test";
    mockData.llmResponse = LONG_SUMMARY;

    const result = await maybeCompact("c1", makeMessages(20));

    expect(result.fallbackLevel).toBe("L3");
    expect(result.summary).toBe(LONG_SUMMARY);
    // 只调用一次 L3 即成功
    expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(1);
  });
});

describe("maybeCompact 摘要模型可配", () => {
  it("未配置时回退第一个 public+enabled 模型", async () => {
    mockData.snapshots = [];
    mockData.compactModelSetting = null; // 未配置
    mockData.models = [
      { id: "private-id", name: "private-model", visibility: "private", enabled: true },
      { id: "fallback-id", name: "fallback-model", visibility: "public", enabled: true },
    ];
    mockData.llmResponse = LONG_SUMMARY;

    await maybeCompact("c1", makeMessages(20));

    const call = vi.mocked(streamChat).mock.calls[0][0] as { modelId?: string; request: { model: string } };
    expect(call.request.model).toBe("fallback-model");
    expect(call.modelId).toBe("fallback-id");
  });

  it("配置后优先用配置模型", async () => {
    mockData.snapshots = [];
    mockData.compactModelSetting = "configured-compact-model";
    mockData.llmResponse = LONG_SUMMARY;

    await maybeCompact("c1", makeMessages(20));

    const call = vi.mocked(streamChat).mock.calls[0][0] as { request: { model: string } };
    expect(call.request.model).toBe("configured-compact-model");
  });

  it("modelId 配置优先于旧模型名", async () => {
    mockData.compactModelIdSetting = "configured-id";
    mockData.compactModelSetting = "legacy-model";
    mockData.models = [{
      id: "configured-id",
      name: "configured-by-id",
      visibility: "public",
      enabled: true,
    }];
    mockData.llmResponse = LONG_SUMMARY;

    await maybeCompact("c1", makeMessages(20));

    const call = vi.mocked(streamChat).mock.calls[0][0] as { modelId?: string; request: { model: string } };
    expect(call.modelId).toBe("configured-id");
    expect(call.request.model).toBe("configured-by-id");
  });
});
