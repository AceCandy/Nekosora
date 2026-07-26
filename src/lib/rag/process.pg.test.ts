import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractText: vi.fn(),
  chunkText: vi.fn(),
  embedTexts: vi.fn(),
  isEmbeddingAvailable: vi.fn(),
}));

vi.mock("@/lib/rag/extract", () => ({ extractText: mocks.extractText }));
vi.mock("@/lib/rag/chunk", () => ({ chunkText: mocks.chunkText }));
vi.mock("@/lib/rag/embedding", () => ({
  embedTexts: mocks.embedTexts,
  isEmbeddingAvailable: mocks.isEmbeddingAvailable,
}));

import { closeDb } from "@/lib/infra/db";
import { processFile } from "@/lib/rag/process";
import { recoverStaleFileProcessing } from "@/lib/rag/recovery";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.FILE_PROCESSING_PG_TEST_DATABASE;

function isIsolatedTestDatabase(): boolean {
  if (!databaseUrl || !expectedDatabase) return false;
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return (
      databaseName === expectedDatabase
      && /^nekusora_file_lease_test_[0-9a-f]{16}$/.test(databaseName)
    );
  } catch {
    return false;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const describePg = isIsolatedTestDatabase() ? describe : describe.skip;

describePg("processFile PostgreSQL lease", () => {
  const userId = `file-lease-test-${randomUUID()}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query(
      'INSERT INTO "user" ("id", "name", "email") VALUES ($1, $2, $3)',
      [userId, "File lease test", `${userId}@example.test`],
    );
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.extractText.mockResolvedValue({ supported: false, reason: "unsupported" });
  });

  afterAll(async () => {
    await closeDb();
    await pool.query('DELETE FROM "user" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  it("重新接管已过期的 extracting 文件并完成状态收敛", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'extracting', 'expired-owner', now() - interval '1 minute', 'running')`,
      [fileId, userId, "stale.txt", "text/plain", `${userId}/stale.txt`, 12],
    );

    await processFile(fileId, `${userId}/stale.txt`, "text/plain");

    const result = await pool.query<{
      processing_status: string;
      extract_status: string | null;
      processing_lease_id: string | null;
      processing_lease_expires_at: Date | null;
    }>(
      `SELECT "processing_status", "extract_status", "processing_lease_id", "processing_lease_expires_at"
       FROM "file_objects" WHERE "id" = $1`,
      [fileId],
    );
    expect(result.rows[0]).toEqual({
      processing_status: "done",
      extract_status: "skipped",
      processing_lease_id: null,
      processing_lease_expires_at: null,
    });
  });

  it("不抢占仍持有有效租约的活动文件", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'extracting', 'fresh-owner', now() + interval '1 minute', 'running')`,
      [fileId, userId, "fresh.txt", "text/plain", `${userId}/fresh.txt`, 12],
    );

    await processFile(fileId, `${userId}/fresh.txt`, "text/plain");

    const result = await pool.query<{ processing_status: string; processing_lease_id: string }>(
      'SELECT "processing_status", "processing_lease_id" FROM "file_objects" WHERE "id" = $1',
      [fileId],
    );
    expect(result.rows[0]).toEqual({
      processing_status: "extracting",
      processing_lease_id: "fresh-owner",
    });
    expect(mocks.extractText).not.toHaveBeenCalled();
  });

  it("并发恢复同一 stale 文件时只有一个执行者进入提取", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'embedding', 'stale-owner', now() - interval '1 minute', 'done')`,
      [fileId, userId, "concurrent.txt", "text/plain", `${userId}/concurrent.txt`, 12],
    );
    const extraction = deferred<{ supported: false; reason: string }>();
    mocks.extractText.mockReturnValue(extraction.promise);

    const first = processFile(fileId, `${userId}/concurrent.txt`, "text/plain");
    const second = processFile(fileId, `${userId}/concurrent.txt`, "text/plain");
    await vi.waitFor(() => expect(mocks.extractText).toHaveBeenCalledOnce());
    extraction.resolve({ supported: false, reason: "unsupported" });
    await Promise.all([first, second]);

    expect(mocks.extractText).toHaveBeenCalledOnce();
    const result = await pool.query<{ processing_status: string }>(
      'SELECT "processing_status" FROM "file_objects" WHERE "id" = $1',
      [fileId],
    );
    expect(result.rows[0]?.processing_status).toBe("done");
  });

  it("stale claim 等待父行锁并在释放后重判租约谓词", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'extracting', 'locked-owner', now() - interval '1 minute', 'running')`,
      [fileId, userId, "locked.txt", "text/plain", `${userId}/locked.txt`, 12],
    );
    const locker = await pool.connect();
    let processing: Promise<void> | undefined;

    try {
      await locker.query("BEGIN");
      await locker.query(
        `UPDATE "file_objects"
         SET "processing_lease_expires_at" = now() + interval '2 minutes'
         WHERE "id" = $1`,
        [fileId],
      );

      let settled = false;
      processing = processFile(fileId, `${userId}/locked.txt`, "text/plain").finally(() => {
        settled = true;
      });
      await vi.waitFor(async () => {
        const blocked = await pool.query<{ blocked: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND state = 'active'
               AND wait_event_type = 'Lock'
               AND query LIKE 'update "file_objects"%'
           ) AS "blocked"`,
        );
        expect(blocked.rows[0]?.blocked).toBe(true);
      }, { timeout: 2_000, interval: 20 });
      expect(settled).toBe(false);

      await locker.query("COMMIT");
      await processing;

      const result = await pool.query<{
        processing_status: string;
        processing_lease_id: string;
      }>(
        `SELECT "processing_status", "processing_lease_id"
         FROM "file_objects" WHERE "id" = $1`,
        [fileId],
      );
      expect(result.rows[0]).toEqual({
        processing_status: "extracting",
        processing_lease_id: "locked-owner",
      });
      expect(mocks.extractText).not.toHaveBeenCalled();
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
      await processing?.catch(() => undefined);
    }
  });

  it("接管后拒绝旧 token 的条件写", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'extracting', 'old-owner', now() - interval '1 minute', 'running')`,
      [fileId, userId, "fenced.txt", "text/plain", `${userId}/fenced.txt`, 12],
    );
    const extraction = deferred<{ supported: false; reason: string }>();
    mocks.extractText.mockReturnValue(extraction.promise);
    const processing = processFile(fileId, `${userId}/fenced.txt`, "text/plain");
    await vi.waitFor(() => expect(mocks.extractText).toHaveBeenCalledOnce());

    const lateWrite = await pool.query(
      `UPDATE "file_objects" SET "rag_reason" = 'old owner late write'
       WHERE "id" = $1
         AND "processing_lease_id" = 'old-owner'
         AND "processing_status" IN ('extracting', 'embedding')
         AND "processing_lease_expires_at" > now()
       RETURNING "id"`,
      [fileId],
    );
    expect(lateWrite.rowCount).toBe(0);

    extraction.resolve({ supported: false, reason: "unsupported" });
    await processing;
    const result = await pool.query<{ processing_status: string; rag_reason: string }>(
      'SELECT "processing_status", "rag_reason" FROM "file_objects" WHERE "id" = $1',
      [fileId],
    );
    expect(result.rows[0]).toEqual({
      processing_status: "done",
      rag_reason: "unsupported",
    });
  });

  it("新 chunk 插入失败时保留旧 chunk 并回滚半成品", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size", "processing_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [fileId, userId, "atomic.txt", "text/plain", `${userId}/atomic.txt`, 12],
    );
    await pool.query(
      `INSERT INTO "file_chunks" ("file_id", "chunk_index", "content", "token_count")
       VALUES ($1, 0, 'old chunk', 2)`,
      [fileId],
    );
    await pool.query('CREATE TABLE "file_processing_insert_failures" ("id" text PRIMARY KEY)');
    await pool.query('INSERT INTO "file_processing_insert_failures" ("id") VALUES ($1)', [fileId]);
    await pool.query(`
      CREATE FUNCTION "fail_selected_file_chunk_insert"() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "file_processing_insert_failures" WHERE "id" = NEW."file_id"
        ) THEN
          RAISE EXCEPTION 'forced file chunk insert failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER "fail_selected_file_chunk_insert_trigger"
      BEFORE INSERT ON "file_chunks"
      FOR EACH ROW EXECUTE FUNCTION "fail_selected_file_chunk_insert"()
    `);
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "new chunk",
      chars: 9,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, content: "new chunk", tokenCount: 2, charOffset: 0 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await processFile(fileId, `${userId}/atomic.txt`, "text/plain");

      const file = await pool.query<{ processing_status: string }>(
        'SELECT "processing_status" FROM "file_objects" WHERE "id" = $1',
        [fileId],
      );
      const chunks = await pool.query<{ content: string }>(
        'SELECT "content" FROM "file_chunks" WHERE "file_id" = $1 ORDER BY "chunk_index"',
        [fileId],
      );
      expect(file.rows[0]?.processing_status).toBe("error");
      expect(chunks.rows).toEqual([{ content: "old chunk" }]);
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      await pool.query('DROP TRIGGER "fail_selected_file_chunk_insert_trigger" ON "file_chunks"');
      await pool.query('DROP FUNCTION "fail_selected_file_chunk_insert"()');
      await pool.query('DROP TABLE "file_processing_insert_failures"');
      await pool.query('DELETE FROM "file_objects" WHERE "id" = $1', [fileId]);
    }
  });

  it("最终 statement time 租约校验失败时回滚 chunk 替换", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size", "processing_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [fileId, userId, "freshness.txt", "text/plain", `${userId}/freshness.txt`, 12],
    );
    await pool.query(
      `INSERT INTO "file_chunks" ("file_id", "chunk_index", "content", "token_count")
       VALUES ($1, 0, 'old chunk', 2)`,
      [fileId],
    );
    await pool.query('CREATE TABLE "file_processing_freshness_failures" ("id" text PRIMARY KEY)');
    await pool.query('INSERT INTO "file_processing_freshness_failures" ("id") VALUES ($1)', [fileId]);
    await pool.query(`
      CREATE FUNCTION "expire_file_processing_lease_on_chunk"() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "file_processing_freshness_failures" WHERE "id" = NEW."file_id"
        ) THEN
          UPDATE "file_objects"
          SET "processing_lease_expires_at" = transaction_timestamp() + interval '100 milliseconds'
          WHERE "id" = NEW."file_id";
          PERFORM pg_sleep(0.25);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER "expire_file_processing_lease_on_chunk_trigger"
      BEFORE INSERT ON "file_chunks"
      FOR EACH ROW EXECUTE FUNCTION "expire_file_processing_lease_on_chunk"()
    `);
    mocks.extractText.mockResolvedValue({
      supported: true,
      text: "new chunk",
      chars: 9,
      pages: 1,
    });
    mocks.chunkText.mockReturnValue([
      { index: 0, content: "new chunk", tokenCount: 2, charOffset: 0 },
    ]);
    mocks.isEmbeddingAvailable.mockResolvedValue(false);

    try {
      await processFile(fileId, `${userId}/freshness.txt`, "text/plain");

      const file = await pool.query<{
        processing_status: string;
        processing_lease_id: string | null;
      }>(
        `SELECT "processing_status", "processing_lease_id"
         FROM "file_objects" WHERE "id" = $1`,
        [fileId],
      );
      const chunks = await pool.query<{ content: string }>(
        `SELECT "content" FROM "file_chunks"
         WHERE "file_id" = $1 ORDER BY "chunk_index"`,
        [fileId],
      );
      expect(file.rows[0]?.processing_status).toBe("embedding");
      expect(file.rows[0]?.processing_lease_id).not.toBeNull();
      expect(chunks.rows).toEqual([{ content: "old chunk" }]);
    } finally {
      await pool.query('DROP TRIGGER "expire_file_processing_lease_on_chunk_trigger" ON "file_chunks"');
      await pool.query('DROP FUNCTION "expire_file_processing_lease_on_chunk"()');
      await pool.query('DROP TABLE "file_processing_freshness_failures"');
      await pool.query('DELETE FROM "file_objects" WHERE "id" = $1', [fileId]);
    }
  });

  it("扫描并恢复遗留的活动文件", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'embedding', 'abandoned-owner', now() - interval '1 minute', 'done')`,
      [fileId, userId, "recover.txt", "text/plain", `${userId}/recover.txt`, 12],
    );

    await recoverStaleFileProcessing();

    const result = await pool.query<{ processing_status: string; extract_status: string | null }>(
      'SELECT "processing_status", "extract_status" FROM "file_objects" WHERE "id" = $1',
      [fileId],
    );
    expect(result.rows[0]).toEqual({
      processing_status: "done",
      extract_status: "skipped",
    });
  });

  it("扫描并恢复尚未被 queue 或 Web fallback claim 的 pending 文件", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size", "processing_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [fileId, userId, "pending.txt", "text/plain", `${userId}/pending.txt`, 12],
    );

    await recoverStaleFileProcessing();

    const result = await pool.query<{ processing_status: string; extract_status: string | null }>(
      'SELECT "processing_status", "extract_status" FROM "file_objects" WHERE "id" = $1',
      [fileId],
    );
    expect(result.rows[0]).toEqual({
      processing_status: "done",
      extract_status: "skipped",
    });
  });

  it("scanner 与直接处理并发时只有一个调用者进入提取", async () => {
    const fileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size", "processing_status"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [fileId, userId, "concurrent-pending.txt", "text/plain", `${userId}/concurrent-pending.txt`, 12],
    );
    const extraction = deferred<{ supported: false; reason: string }>();
    mocks.extractText.mockReturnValue(extraction.promise);

    const direct = processFile(fileId, `${userId}/concurrent-pending.txt`, "text/plain");
    const recovery = recoverStaleFileProcessing();
    await vi.waitFor(() => expect(mocks.extractText).toHaveBeenCalledOnce());
    extraction.resolve({ supported: false, reason: "unsupported" });
    await Promise.all([direct, recovery]);

    expect(mocks.extractText).toHaveBeenCalledOnce();
    const result = await pool.query<{ processing_status: string }>(
      'SELECT "processing_status" FROM "file_objects" WHERE "id" = $1',
      [fileId],
    );
    expect(result.rows[0]?.processing_status).toBe("done");
  });

  it("单个 stale 文件 claim 失败时继续恢复后续文件", async () => {
    const failedFileId = randomUUID();
    const recoverableFileId = randomUUID();
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size",
        "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status"
      ) VALUES
        ($1, $3, 'failed.txt', 'text/plain', $4, 12, 'extracting', 'failed-owner', now() - interval '2 minutes', 'running'),
        ($2, $3, 'recoverable.txt', 'text/plain', $5, 12, 'extracting', 'recoverable-owner', now() - interval '1 minute', 'running')`,
      [
        failedFileId,
        recoverableFileId,
        userId,
        `${userId}/failed.txt`,
        `${userId}/recoverable.txt`,
      ],
    );
    await pool.query('CREATE TABLE "file_processing_test_failures" ("id" text PRIMARY KEY)');
    await pool.query('INSERT INTO "file_processing_test_failures" ("id") VALUES ($1)', [failedFileId]);
    await pool.query(`
      CREATE FUNCTION "fail_selected_file_claim"() RETURNS trigger AS $$
      BEGIN
        IF NEW."processing_lease_id" IS DISTINCT FROM OLD."processing_lease_id"
          AND EXISTS (
            SELECT 1 FROM "file_processing_test_failures" WHERE "id" = NEW."id"
          ) THEN
          RAISE EXCEPTION 'forced file claim failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER "fail_selected_file_claim_trigger"
      BEFORE UPDATE ON "file_objects"
      FOR EACH ROW EXECUTE FUNCTION "fail_selected_file_claim"()
    `);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(recoverStaleFileProcessing()).resolves.toBeUndefined();
      const result = await pool.query<{ id: string; processing_status: string }>(
        `SELECT "id", "processing_status" FROM "file_objects"
         WHERE "id" IN ($1, $2) ORDER BY "id"`,
        [failedFileId, recoverableFileId],
      );
      expect(result.rows).toEqual([
        { id: failedFileId, processing_status: "extracting" },
        { id: recoverableFileId, processing_status: "done" },
      ].sort((left, right) => left.id.localeCompare(right.id)));
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]?.join(" ")).not.toContain("postgres://");
    } finally {
      await pool.query('DROP TRIGGER "fail_selected_file_claim_trigger" ON "file_objects"');
      await pool.query('DROP FUNCTION "fail_selected_file_claim"()');
      await pool.query('DROP TABLE "file_processing_test_failures"');
      await pool.query('DELETE FROM "file_objects" WHERE "id" IN ($1, $2)', [
        failedFileId,
        recoverableFileId,
      ]);
    }
  });

  it("单轮扫描最多恢复 25 个混合候选且排除 error 和 done", async () => {
    const fileIds = Array.from({ length: 26 }, () => randomUUID()).sort();
    for (const [index, fileId] of fileIds.entries()) {
      const status = index % 2 === 0 ? "pending" : "extracting";
      await pool.query(
        `INSERT INTO "file_objects" (
          "id", "user_id", "filename", "mime", "storage_path", "size",
          "processing_status", "processing_lease_id", "processing_lease_expires_at", "extract_status",
          "created_at"
        ) VALUES ($1, $2, $3, 'text/plain', $4, 12, $5,
          CASE WHEN $5 = 'extracting' THEN 'stale-owner' END,
          CASE WHEN $5 = 'extracting' THEN now() - interval '1 minute' END,
          CASE WHEN $5 = 'extracting' THEN 'running' END,
          '2026-01-01 00:00:00+00')`,
        [fileId, userId, `limit-${index}.txt`, `${userId}/limit-${index}.txt`, status],
      );
    }
    const excludedIds = [randomUUID(), randomUUID()];
    await pool.query(
      `INSERT INTO "file_objects" (
        "id", "user_id", "filename", "mime", "storage_path", "size", "processing_status"
      ) VALUES
        ($1, $3, 'error.txt', 'text/plain', $4, 12, 'error'),
        ($2, $3, 'done.txt', 'text/plain', $5, 12, 'done')`,
      [excludedIds[0], excludedIds[1], userId, `${userId}/error.txt`, `${userId}/done.txt`],
    );

    await recoverStaleFileProcessing();

    const result = await pool.query<{ processing_status: string; count: string }>(
      `SELECT "processing_status", count(*)::text AS "count"
       FROM "file_objects" WHERE "id" = ANY($1::text[])
       GROUP BY "processing_status"`,
      [fileIds],
    );
    expect(result.rows).toEqual(expect.arrayContaining([
      { processing_status: "done", count: "25" },
    ]));
    expect(result.rows.reduce((total, row) => total + Number(row.count), 0)).toBe(26);
    expect(mocks.extractText).toHaveBeenCalledTimes(25);
    const remaining = await pool.query<{ id: string; processing_status: string }>(
      `SELECT "id", "processing_status" FROM "file_objects"
       WHERE "id" = ANY($1::text[]) AND "processing_status" <> 'done'`,
      [fileIds],
    );
    expect(remaining.rows).toEqual([
      { id: fileIds[25], processing_status: "extracting" },
    ]);
    const excluded = await pool.query<{ processing_status: string }>(
      `SELECT "processing_status" FROM "file_objects"
       WHERE "id" = ANY($1::text[]) ORDER BY "processing_status"`,
      [excludedIds],
    );
    expect(excluded.rows).toEqual([
      { processing_status: "done" },
      { processing_status: "error" },
    ]);
    await pool.query('DELETE FROM "file_objects" WHERE "id" = ANY($1::text[])', [fileIds]);
    await pool.query('DELETE FROM "file_objects" WHERE "id" = ANY($1::text[])', [excludedIds]);
  });
});
