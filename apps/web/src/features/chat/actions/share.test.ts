import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDb: vi.fn(),
  getSchema: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  headers: vi.fn(),
  hashSharePassword: vi.fn(),
  verifySharePassword: vi.fn(),
  verifyShareUnlockToken: vi.fn(),
  createShareUnlockToken: vi.fn(),
  fingerprintShareClient: vi.fn(),
  getShareUnlockRetryAfter: vi.fn(),
  recordShareUnlockFailure: vi.fn(),
  clearShareUnlockClientFailures: vi.fn(),
  loadRunMetadataByRunIds: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet, set: mocks.cookieSet })),
  headers: mocks.headers,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/infra/db", () => ({ getDb: mocks.getDb, getSchema: mocks.getSchema }));
vi.mock("@/features/chat/lib/share-security", () => ({
  hashSharePassword: mocks.hashSharePassword,
  verifySharePassword: mocks.verifySharePassword,
  verifyShareUnlockToken: mocks.verifyShareUnlockToken,
  createShareUnlockToken: mocks.createShareUnlockToken,
  fingerprintShareClient: mocks.fingerprintShareClient,
  getShareUnlockCookieName: (shareId: string) => `unlock_${shareId}`,
}));
vi.mock("@/features/chat/lib/share-rate-limit", () => ({
  getShareUnlockRetryAfter: mocks.getShareUnlockRetryAfter,
  recordShareUnlockFailure: mocks.recordShareUnlockFailure,
  clearShareUnlockClientFailures: mocks.clearShareUnlockClientFailures,
}));
vi.mock("@/lib/chat/run-metadata", () => ({
  loadRunMetadataByRunIds: mocks.loadRunMetadataByRunIds,
}));

import { createShare, getShare, listConversationShares, revokeShare, unlockShare } from "./share";

const schema = {
  conversations: {
    id: "conversations.id", userId: "conversations.userId", messageVersionSelections: "conversations.selections",
  },
  conversationShares: {
    shareId: "shares.shareId", conversationId: "shares.conversationId", createdAt: "shares.createdAt",
    mode: "shares.mode", status: "shares.status", expiresAt: "shares.expiresAt",
    passwordVerifier: "shares.passwordVerifier", revokedAt: "shares.revokedAt",
  },
  messages: {
    publicId: "messages.publicId", conversationId: "messages.conversationId", deletedAt: "messages.deletedAt",
    role: "messages.role", content: "messages.content", createdAt: "messages.createdAt", runId: "messages.runId",
  },
  renderStyles: { id: "styles.id", enabled: "styles.enabled" },
};

function queryReturning(rows: Record<string, unknown>[]) {
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: Record<string, unknown>[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

function dbWithRows(selectedRows: Record<string, unknown>[][]) {
  const values = vi.fn().mockResolvedValue(undefined);
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => queryReturning(selectedRows.shift() ?? [])) })),
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set: updateSet })),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
  const transaction = vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  return { db: { ...db, transaction }, values, updateSet, updateWhere, transaction };
}

describe("conversation share actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ id: "user-1" });
    mocks.getSchema.mockReturnValue(schema);
    mocks.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "203.0.113.8" }));
    mocks.hashSharePassword.mockResolvedValue("scrypt$v1$verifier");
    mocks.verifySharePassword.mockResolvedValue(true);
    mocks.verifyShareUnlockToken.mockReturnValue(false);
    mocks.createShareUnlockToken.mockReturnValue({ token: "signed-token", expiresAt: new Date("2026-07-28T00:00:00Z") });
    mocks.fingerprintShareClient.mockReturnValue("fingerprint");
    mocks.getShareUnlockRetryAfter.mockResolvedValue(null);
    mocks.loadRunMetadataByRunIds.mockResolvedValue(new Map());
  });

  it("快照由服务端可见分支和启用样式生成", async () => {
    const { db, values, transaction } = dbWithRows([
      [{ id: "conversation-1", userId: "user-1", title: "Title", modelName: "model", renderStyleId: "style-1", messageVersionSelections: null }],
      [
        { id: "u1", publicId: "u1-public", parentId: null, role: "user", content: "Question", createdAt: new Date("2026-01-01T00:00:00Z") },
        { id: "a1", publicId: "a1-public", parentId: "u1", runId: "run-1", role: "assistant", content: "Answer", createdAt: new Date("2026-01-01T00:01:00Z") },
      ],
      [{ id: "style-1", name: "Paper", cssClass: "paper", css: ".rs-paper{}", renderer: "custom" }],
    ]);
    mocks.getDb.mockResolvedValue(db);
    mocks.loadRunMetadataByRunIds.mockResolvedValue(new Map([[
      "run-1",
      {
        model: "actual-model",
        tokenUsage: { promptTokens: 120, completionTokens: 40, reasoningTokens: 12 },
        durationMs: 1500,
      },
    ]]));

    const result = await createShare({ conversationId: "conversation-1", mode: "snapshot", expiration: { kind: "days", days: 7 } });

    expect(result.mode).toBe("snapshot");
    expect(transaction).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      mode: "snapshot",
      titleSnapshot: "Title",
      messageSnapshotsJson: [
        {
          publicId: "u1-public",
          role: "user",
          content: "Question",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          publicId: "a1-public",
          role: "assistant",
          content: "Answer",
          createdAt: "2026-01-01T00:01:00.000Z",
          model: "actual-model",
          tokenUsage: { promptTokens: 120, completionTokens: 40 },
          durationMs: 1500,
        },
      ],
      renderStyleSnapshot: expect.objectContaining({ sourceId: "style-1", cssClass: "paper", renderer: "custom" }),
    }));
  });

  it("快照可显式选择默认输出样式", async () => {
    const { db, values } = dbWithRows([
      [{ id: "conversation-1", userId: "user-1", title: "Title", modelName: "model", renderStyleId: "style-1", messageVersionSelections: null }],
      [
        { id: "u1", publicId: "u1-public", parentId: null, role: "user", content: "Question", createdAt: new Date("2026-01-01T00:00:00Z") },
        { id: "a1", publicId: "a1-public", parentId: "u1", role: "assistant", content: "Answer", createdAt: new Date("2026-01-01T00:01:00Z") },
      ],
    ]);
    mocks.getDb.mockResolvedValue(db);

    await createShare({
      conversationId: "conversation-1",
      mode: "snapshot",
      expiration: { kind: "forever" },
      renderStyleId: null,
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ renderStyleSnapshot: null }));
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("实时分享拒绝独立输出样式", async () => {
    await expect(createShare({ conversationId: "conversation-1", mode: "live", expiration: { kind: "forever" }, renderStyleId: "style-1" }))
      .rejects.toThrow("实时同步必须跟随会话样式");
    expect(mocks.requireSession).not.toHaveBeenCalled();
  });

  it("拒绝其他用户会话且不写分享", async () => {
    const { db, values } = dbWithRows([[{ id: "conversation-2", userId: "user-2" }]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(createShare({ conversationId: "conversation-2", mode: "snapshot", expiration: { kind: "forever" } }))
      .rejects.toThrow("无权操作");
    expect(values).not.toHaveBeenCalled();
  });

  it("新快照严格读取冻结正文且不查询实时消息", async () => {
    const { db } = dbWithRows([ [{
      shareId: "share-1", conversationId: "conversation-1", mode: "snapshot", status: "active",
      revokedAt: null, expiresAt: null, passwordVerifier: null, titleSnapshot: "Title", modelSnapshot: "model",
      messageSnapshotsJson: [{
        publicId: "deleted-later",
        role: "assistant",
        content: "Frozen",
        createdAt: "2026-01-01T00:01:00.000Z",
        model: "actual-model",
        tokenUsage: { promptTokens: 120, completionTokens: 40 },
        durationMs: 1500,
      }],
    }] ]);
    mocks.getDb.mockResolvedValue(db);

    await expect(getShare("share-1")).resolves.toEqual({
      status: "ready", title: "Title", renderStyle: null,
      messages: [{
        role: "assistant",
        content: "Frozen",
        createdAt: "2026-01-01T00:01:00.000Z",
        runMetadata: {
          model: "actual-model",
          tokenUsage: { promptTokens: 120, completionTokens: 40 },
          durationMs: 1500,
        },
      }],
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("旧快照缺少消息时间时不回查原会话", async () => {
    const { db } = dbWithRows([[{
      shareId: "share-old-snapshot",
      conversationId: "conversation-1",
      mode: "snapshot",
      status: "active",
      revokedAt: null,
      expiresAt: null,
      passwordVerifier: null,
      titleSnapshot: "Old snapshot",
      modelSnapshot: "model",
      messageSnapshotsJson: [{
        publicId: "message-1",
        role: "assistant",
        content: "Still readable",
      }],
    }]]);
    mocks.getDb.mockResolvedValue(db);

    await expect(getShare("share-old-snapshot")).resolves.toEqual({
      status: "ready",
      title: "Old snapshot",
      renderStyle: null,
      messages: [{ role: "assistant", content: "Still readable" }],
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("实时分享读取当前标题、分支和样式", async () => {
    const { db } = dbWithRows([
      [{ shareId: "share-live", conversationId: "conversation-1", mode: "live", status: "active", revokedAt: null, expiresAt: null, passwordVerifier: null }],
      [{ id: "conversation-1", title: "Current", modelName: "new-model", renderStyleId: "style-2", messageVersionSelections: { u1: "a-old-public" } }],
      [
        { id: "u1", publicId: "u1-public", parentId: null, role: "user", content: "Q", createdAt: new Date("2026-01-01T00:00:00Z") },
        {
          id: "a-old",
          publicId: "a-old-public",
          parentId: "u1",
          runId: "run-live",
          role: "assistant",
          content: "Chosen",
          createdAt: new Date("2026-01-01T00:01:00Z"),
          processTrace: {
            version: 1,
            runs: [{
              runId: "run-live",
              phase: "completed",
              startedAt: "2026-01-01T00:00:00.000Z",
              steps: [{
                id: "rag",
                kind: "rag",
                status: "completed",
                data: {
                  fileCount: 1,
                  sources: [{
                    fileId: "PRIVATE_FILE_ID_SENTINEL",
                    filename: "PRIVATE_FILENAME_SENTINEL",
                    mime: "PRIVATE_MIME_SENTINEL",
                  }],
                },
              }],
            }],
          },
        },
        { id: "a-new", publicId: "a-new-public", parentId: "u1", role: "assistant", content: "Latest", createdAt: new Date("2026-01-01T00:02:00Z") },
      ],
      [{ id: "style-2", name: "Compact", cssClass: "compact", css: ".rs-compact{}", renderer: "streamdown" }],
    ]);
    mocks.getDb.mockResolvedValue(db);
    mocks.loadRunMetadataByRunIds.mockResolvedValue(new Map([[
      "run-live",
      { model: "actual-model", tokenUsage: { promptTokens: 12, completionTokens: 4 }, durationMs: 500 },
    ]]));

    const result = await getShare("share-live");
    expect(result).toEqual(expect.objectContaining({
      status: "ready", title: "Current",
      messages: [
        { role: "user", content: "Q", createdAt: "2026-01-01T00:00:00.000Z" },
        {
          role: "assistant",
          content: "Chosen",
          createdAt: "2026-01-01T00:01:00.000Z",
          runMetadata: {
            model: "actual-model",
            tokenUsage: { promptTokens: 12, completionTokens: 4 },
            durationMs: 500,
          },
        },
      ],
      renderStyle: expect.objectContaining({ sourceId: "style-2", cssClass: "compact" }),
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("PRIVATE_FILE_ID_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_FILENAME_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_MIME_SENTINEL");
  });

  it("实时分享的当前样式不可用时回退默认渲染", async () => {
    const { db } = dbWithRows([
      [{ shareId: "share-live", conversationId: "conversation-1", mode: "live", status: "active", revokedAt: null, expiresAt: null, passwordVerifier: null }],
      [{ id: "conversation-1", title: "Current", modelName: "model", renderStyleId: "disabled-style", messageVersionSelections: null }],
      [{ id: "u1", publicId: "u1-public", parentId: null, role: "user", content: "Q", createdAt: new Date("2026-01-01T00:00:00Z") }],
      [],
    ]);
    mocks.getDb.mockResolvedValue(db);

    await expect(getShare("share-live")).resolves.toEqual({
      status: "ready",
      title: "Current",
      messages: [{ role: "user", content: "Q", createdAt: "2026-01-01T00:00:00.000Z" }],
      renderStyle: null,
    });
  });

  it("历史分享保持软删除过滤语义", async () => {
    const { db } = dbWithRows([
      [{ shareId: "legacy", conversationId: "conversation-1", mode: null, status: "active", revokedAt: null, expiresAt: null, passwordVerifier: null, titleSnapshot: "Legacy", messageIdsJson: ["kept", "deleted"], messageSnapshotsJson: [{ publicId: "kept", role: "user", content: "Keep" }, { publicId: "deleted", role: "assistant", content: "Hide" }] }],
      [{ publicId: "kept", deletedAt: null }, { publicId: "deleted", deletedAt: new Date() }],
    ]);
    mocks.getDb.mockResolvedValue(db);
    await expect(getShare("legacy")).resolves.toEqual(expect.objectContaining({
      status: "ready", messages: [{ role: "user", content: "Keep" }], renderStyle: null,
    }));
  });

  it("未解锁只返回 locked，不泄露元数据", async () => {
    const { db } = dbWithRows([[{ shareId: "locked", status: "active", revokedAt: null, expiresAt: null, passwordVerifier: "secret", titleSnapshot: "Private", messageSnapshotsJson: [{ content: "Private" }] }]]);
    mocks.getDb.mockResolvedValue(db);
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(getShare("locked")).resolves.toEqual({ status: "locked" });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("过期、撤销和不存在统一返回 unavailable", async () => {
    for (const row of [undefined, { status: "revoked", revokedAt: new Date() }, { status: "active", revokedAt: null, expiresAt: new Date("2000-01-01") }]) {
      const { db } = dbWithRows([row ? [row] : []]);
      mocks.getDb.mockResolvedValue(db);
      await expect(getShare("share-x")).resolves.toEqual({ status: "unavailable" });
    }
  });

  it("列表只返回安全 DTO 并派生到期状态", async () => {
    const { db } = dbWithRows([
      [{ id: "conversation-1", userId: "user-1" }],
      [{ shareId: "share-1", mode: "snapshot", status: "active", revokedAt: null, expiresAt: new Date("2000-01-01"), passwordVerifier: "hidden", createdAt: new Date("1999-01-01") }],
    ]);
    mocks.getDb.mockResolvedValue(db);
    await expect(listConversationShares("conversation-1")).resolves.toEqual([{
      shareId: "share-1", mode: "snapshot", status: "expired", hasPassword: true,
      expiresAt: new Date("2000-01-01"), createdAt: new Date("1999-01-01"),
    }]);
  });

  it("正确密码签发仅限当前分享路径的 Cookie", async () => {
    const { db } = dbWithRows([[{ shareId: "share-1", status: "active", revokedAt: null, expiresAt: null, passwordVerifier: "verifier" }]]);
    mocks.getDb.mockResolvedValue(db);
    await expect(unlockShare("share-1", "password123")).resolves.toEqual({ ok: true });
    expect(mocks.clearShareUnlockClientFailures).toHaveBeenCalledWith(db, "share-1", "fingerprint");
    expect(mocks.cookieSet).toHaveBeenCalledWith("unlock_share-1", "signed-token", expect.objectContaining({
      httpOnly: true, sameSite: "lax", path: "/share/share-1",
    }));
  });

  it("解锁密码长度无效时不查库也不执行 KDF", async () => {
    await expect(unlockShare("share-1", "short")).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(unlockShare("share-1", "x".repeat(129))).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.verifySharePassword).not.toHaveBeenCalled();
  });

  it("撤销分享鉴权并对已撤销记录幂等", async () => {
    const { db, updateSet } = dbWithRows([
      [{ shareId: "share-1", conversationId: "conversation-1", status: "active", revokedAt: null }],
      [{ id: "conversation-1", userId: "user-1" }],
    ]);
    mocks.getDb.mockResolvedValue(db);
    await revokeShare("share-1");
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "revoked", revokedAt: expect.any(Date) }));

    const existing = dbWithRows([
      [{ shareId: "share-1", conversationId: "conversation-1", status: "revoked", revokedAt: new Date() }],
      [{ id: "conversation-1", userId: "user-1" }],
    ]);
    mocks.getDb.mockResolvedValue(existing.db);
    await revokeShare("share-1");
    expect(existing.updateSet).not.toHaveBeenCalled();
  });
});
