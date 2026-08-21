import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSchema: vi.fn(),
}));

vi.mock("@/lib/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: mocks.getSchema,
}));

import * as schema from "@/db/schema/pg";
import { persistChatCompletion } from "@/lib/chat/completion-repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.CHAT_COMPLETION_PG_TEST_DATABASE;

function isIsolatedTestDatabase(): boolean {
  if (!databaseUrl || !expectedDatabase) return false;
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return databaseName === expectedDatabase
      && /^nekusora_core_pg_test_[0-9a-f]{16}$/.test(databaseName);
  } catch {
    return false;
  }
}

const describePg = isIsolatedTestDatabase() ? describe : describe.skip;

describePg("chat completion PostgreSQL transaction", () => {
  const userId = `chat-completion-${randomUUID()}`;
  const conversationId = randomUUID();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const runIds = [`run_${randomUUID()}`, `run_${randomUUID()}`];
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    const { drizzle } = await import("drizzle-orm/node-postgres");
    mocks.getDb.mockResolvedValue(drizzle(pool, { schema }));
    mocks.getSchema.mockReturnValue(schema);

    await pool.query(
      'INSERT INTO "user" ("id", "name", "email") VALUES ($1, $2, $3)',
      [userId, "Chat completion test", `${userId}@example.test`],
    );
    await pool.query(
      'INSERT INTO "conversations" ("id", "user_id") VALUES ($1, $2)',
      [conversationId, userId],
    );
    await pool.query(
      `INSERT INTO "messages" (
        "id", "conversation_id", "public_id", "role", "content", "status"
      ) VALUES ($1, $2, $3, 'user', $4::jsonb, 'success')`,
      [userMessageId, conversationId, randomUUID(), JSON.stringify("question")],
    );
    await pool.query(
      `INSERT INTO "messages" (
        "id", "conversation_id", "public_id", "parent_id", "role", "content", "status"
      ) VALUES ($1, $2, $3, $4, 'assistant', $5::jsonb, 'success')`,
      [assistantMessageId, conversationId, randomUUID(), userMessageId, JSON.stringify("prefix")],
    );
    for (const runId of runIds) {
      await pool.query(
        `INSERT INTO "runs" ("run_id", "conversation_id", "user_id", "status")
         VALUES ($1, $2, $3, 'running')`,
        [runId, conversationId, userId],
      );
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM "user" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  it("并发 continue 仅一方提交 assistant 与 run 终态", async () => {
    const write = (runId: string, suffix: string) => persistChatCompletion({
      conversationId,
      userId,
      runId,
      userMessageInternalId: userMessageId,
      userContent: "question",
      assistant: {
        kind: "continue",
        internalId: assistantMessageId,
        publicId: "unused-in-continue",
        prefixText: "prefix",
      },
      assistantText: suffix,
      assistantReasoning: "",
      processTrace: { mode: "integration" },
      terminalStatus: "success",
      tokenUsage: { totalTokens: 1 },
      durationMs: 10,
      completedAt: new Date(),
      memoryJob: null,
    });

    const results = await Promise.allSettled([
      write(runIds[0], "-first"),
      write(runIds[1], "-second"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const message = await pool.query<{ content: string }>(
      'SELECT "content" FROM "messages" WHERE "id" = $1',
      [assistantMessageId],
    );
    expect(["prefix-first", "prefix-second"]).toContain(message.rows[0]?.content);

    const runs = await pool.query<{ run_id: string; status: string }>(
      'SELECT "run_id", "status" FROM "runs" WHERE "run_id" = ANY($1::text[])',
      [runIds],
    );
    expect(runs.rows.filter((run) => run.status === "success")).toHaveLength(1);
    expect(runs.rows.filter((run) => run.status === "running")).toHaveLength(1);

    const intents = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS "count" FROM "memory_extraction_jobs" WHERE "run_id" = ANY($1::text[])',
      [runIds],
    );
    expect(intents.rows[0]?.count).toBe("0");
  });

  it("memory intent 主键冲突时回滚 assistant、conversation 与 run", async () => {
    const blockerRunId = `run_${randomUUID()}`;
    const runId = `run_${randomUUID()}`;
    const jobId = randomUUID();
    const assistantPublicId = randomUUID();
    await pool.query(
      `INSERT INTO "runs" ("run_id", "conversation_id", "user_id", "status")
       VALUES ($1, $2, $3, 'running'), ($4, $2, $3, 'running')`,
      [blockerRunId, conversationId, userId, runId],
    );
    await pool.query(
      `INSERT INTO "memory_extraction_jobs" (
        "id", "run_id", "conversation_id", "user_id", "messages"
      ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        jobId,
        blockerRunId,
        conversationId,
        userId,
        JSON.stringify([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]),
      ],
    );
    const before = await pool.query<{ updated_at: Date }>(
      'SELECT "updated_at" FROM "conversations" WHERE "id" = $1',
      [conversationId],
    );

    await expect(persistChatCompletion({
      conversationId,
      userId,
      runId,
      userMessageInternalId: userMessageId,
      userContent: "question",
      assistant: { kind: "insert", publicId: assistantPublicId, createdAt: new Date() },
      assistantText: "answer",
      assistantReasoning: "",
      processTrace: { mode: "integration" },
      terminalStatus: "success",
      tokenUsage: { totalTokens: 2 },
      durationMs: 10,
      completedAt: new Date(before.rows[0]!.updated_at.getTime() + 60_000),
      memoryJob: {
        id: jobId,
        runId,
        conversationId,
        userId,
        messages: [{ role: "user", content: "question" }, { role: "assistant", content: "answer" }],
      },
    })).rejects.toBeTruthy();

    const assistant = await pool.query(
      'SELECT "id" FROM "messages" WHERE "public_id" = $1',
      [assistantPublicId],
    );
    const conversation = await pool.query<{ updated_at: Date }>(
      'SELECT "updated_at" FROM "conversations" WHERE "id" = $1',
      [conversationId],
    );
    const run = await pool.query<{ status: string }>(
      'SELECT "status" FROM "runs" WHERE "run_id" = $1',
      [runId],
    );
    expect(assistant.rowCount).toBe(0);
    expect(conversation.rows[0]?.updated_at).toEqual(before.rows[0]?.updated_at);
    expect(run.rows[0]?.status).toBe("running");
  });

  it("run 已非 running 时回滚普通 assistant insert", async () => {
    const runId = `run_${randomUUID()}`;
    const assistantPublicId = randomUUID();
    await pool.query(
      `INSERT INTO "runs" ("run_id", "conversation_id", "user_id", "status")
       VALUES ($1, $2, $3, 'failed')`,
      [runId, conversationId, userId],
    );

    await expect(persistChatCompletion({
      conversationId,
      userId,
      runId,
      userMessageInternalId: userMessageId,
      userContent: "question",
      assistant: { kind: "insert", publicId: assistantPublicId, createdAt: new Date() },
      assistantText: "should rollback",
      assistantReasoning: "",
      processTrace: { mode: "integration" },
      terminalStatus: "success",
      tokenUsage: null,
      durationMs: 10,
      completedAt: new Date(),
      memoryJob: null,
    })).rejects.toBeTruthy();

    const assistant = await pool.query(
      'SELECT "id" FROM "messages" WHERE "public_id" = $1',
      [assistantPublicId],
    );
    const run = await pool.query<{ status: string }>(
      'SELECT "status" FROM "runs" WHERE "run_id" = $1',
      [runId],
    );
    expect(assistant.rowCount).toBe(0);
    expect(run.rows[0]?.status).toBe("failed");
  });
});
