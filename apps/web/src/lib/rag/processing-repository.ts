import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";
import {
  FileProcessingLeaseLostError,
  buildFileProcessingTransition,
  type ActiveFileProcessingStatus,
  type StageFileProcessingTransitionCommand,
  type TerminalFileProcessingTransitionCommand,
  type RetryableFileProcessingReason,
  type DegradedFileProcessingReason,
} from "./processing-state";

const ACTIVE_PROCESSING_STATUSES: ActiveFileProcessingStatus[] = [
  "extracting",
  "embedding",
];
const FILE_PROCESSING_LEASE_EXPIRES_AT = sql`now() + interval '2 minutes'`;
const DATABASE_NOW = sql`now()`;
const STATEMENT_TIMESTAMP = sql`statement_timestamp()`;
const STATEMENT_LEASE_EXPIRES_AT = sql`statement_timestamp() + interval '2 minutes'`;
const RECOVERABLE_FILE_SCAN_LIMIT = 25;
const CHUNK_INSERT_BATCH_SIZE = 50;

export interface FileProcessingLease {
  fileId: string;
  token: string;
}

export interface ClaimedFileProcessing {
  lease: FileProcessingLease;
  storagePath: string;
  mime: string;
}

export interface FileProcessingChunk {
  chunkIndex: number;
  pageNum: number | null;
  charOffset: number;
  content: string;
  tokenCount: number;
  embedding: number[] | null;
}

export interface CompleteFileProcessingInput {
  chunks: FileProcessingChunk[];
  ragReady: boolean;
  ragReason: DegradedFileProcessingReason | null;
}

type ProcessingSchema = ReturnType<typeof getSchema>;

async function databaseContext() {
  const db = await getDb();
  const schema = getSchema();
  return { db, schema };
}

function ownedWhere(
  schema: ProcessingSchema,
  lease: FileProcessingLease,
  statuses: readonly ActiveFileProcessingStatus[],
  clock: unknown,
) {
  return and(
    eq(schema.fileObjects.id, lease.fileId),
    eq(schema.fileObjects.processingLeaseId, lease.token),
    inArray(schema.fileObjects.processingStatus, [...statuses]),
    gt(schema.fileObjects.processingLeaseExpiresAt, clock),
  );
}

function assertOwned(rows: unknown[]): void {
  if (rows.length === 0) throw new FileProcessingLeaseLostError();
}

/** 原子抢占文件，并返回数据库中的权威存储元数据。 */
export async function claimFileProcessing(
  fileId: string,
): Promise<ClaimedFileProcessing | null> {
  const { db, schema } = await databaseContext();
  const token = randomUUID();
  const [claimed] = await db
    .update(schema.fileObjects)
    .set({
      processingStatus: "extracting",
      processingLeaseId: token,
      processingLeaseExpiresAt: FILE_PROCESSING_LEASE_EXPIRES_AT,
      extractStatus: "running",
    })
    .where(
      and(
        eq(schema.fileObjects.id, fileId),
        or(
          inArray(schema.fileObjects.processingStatus, ["pending", "error"]),
          and(
            inArray(schema.fileObjects.processingStatus, ACTIVE_PROCESSING_STATUSES),
            or(
              isNull(schema.fileObjects.processingLeaseExpiresAt),
              lte(schema.fileObjects.processingLeaseExpiresAt, DATABASE_NOW),
            ),
          ),
        ),
      ),
    )
    .returning({
      id: schema.fileObjects.id,
      storagePath: schema.fileObjects.storagePath,
      mime: schema.fileObjects.mime,
    });

  if (!claimed) return null;
  return {
    lease: { fileId: claimed.id as string, token },
    storagePath: claimed.storagePath as string,
    mime: claimed.mime as string,
  };
}

/** 使用数据库时钟延长租约；未命中即失去所有权。 */
export async function renewFileProcessingLease(
  lease: FileProcessingLease,
): Promise<void> {
  const { db, schema } = await databaseContext();
  const rows = await db
    .update(schema.fileObjects)
    .set({ processingLeaseExpiresAt: FILE_PROCESSING_LEASE_EXPIRES_AT })
    .where(ownedWhere(schema, lease, ACTIVE_PROCESSING_STATUSES, DATABASE_NOW))
    .returning({ id: schema.fileObjects.id });
  assertOwned(rows);
}

/** 执行有限状态命令；调用方不能提交任意数据库 patch。 */
export async function transitionFileProcessing(
  lease: FileProcessingLease,
  current: ActiveFileProcessingStatus,
  command: StageFileProcessingTransitionCommand,
): Promise<void> {
  const patch = buildFileProcessingTransition(current, command);
  const { db, schema } = await databaseContext();
  const rows = await db
    .update(schema.fileObjects)
    .set(patch)
    .where(ownedWhere(schema, lease, [current], DATABASE_NOW))
    .returning({ id: schema.fileObjects.id });
  assertOwned(rows);
}

/** 仅允许稳定 retryable code 写入 error 终态。 */
export async function failFileProcessing(
  lease: FileProcessingLease,
  reason: RetryableFileProcessingReason,
): Promise<void> {
  const { db, schema } = await databaseContext();
  const rows = await db
    .update(schema.fileObjects)
    .set({
      processingStatus: "error",
      ragReady: false,
      ragReason: reason,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    })
    .where(ownedWhere(schema, lease, ACTIVE_PROCESSING_STATUSES, DATABASE_NOW))
    .returning({ id: schema.fileObjects.id });
  assertOwned(rows);
}

/** 查询 pending 或 stale active 候选；error 由有界队列重投处理。 */
export async function findRecoverableFileIds(): Promise<string[]> {
  const { db, schema } = await databaseContext();
  const rows = await db
    .select({ id: schema.fileObjects.id })
    .from(schema.fileObjects)
    .where(
      or(
        eq(schema.fileObjects.processingStatus, "pending"),
        and(
          inArray(schema.fileObjects.processingStatus, ACTIVE_PROCESSING_STATUSES),
          or(
            isNull(schema.fileObjects.processingLeaseExpiresAt),
            lte(schema.fileObjects.processingLeaseExpiresAt, DATABASE_NOW),
          ),
        ),
      ),
    )
    .orderBy(asc(schema.fileObjects.createdAt), asc(schema.fileObjects.id))
    .limit(RECOVERABLE_FILE_SCAN_LIMIT);
  return rows.map((row: { id: string }) => row.id);
}

/** 原子替换 chunks，并在 statement-time freshness gate 后提交终态。 */
export async function replaceFileChunksAndComplete(
  lease: FileProcessingLease,
  input: CompleteFileProcessingInput,
): Promise<void> {
  await replaceChunksAndComplete(
    lease,
    "embedding",
    {
      processingStatus: "done",
      ragReady: input.ragReady,
      ragReason: input.ragReason,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    },
    input.chunks,
  );
}

/** unsupported/empty 终态以空 replacement 原子清理历史 chunks。 */
export async function completeFileProcessingWithoutChunks(
  lease: FileProcessingLease,
  current: ActiveFileProcessingStatus,
  command: TerminalFileProcessingTransitionCommand,
): Promise<void> {
  await replaceChunksAndComplete(
    lease,
    current,
    buildFileProcessingTransition(current, command),
    [],
  );
}

async function replaceChunksAndComplete(
  lease: FileProcessingLease,
  current: ActiveFileProcessingStatus,
  terminalPatch: Record<string, unknown>,
  chunks: FileProcessingChunk[],
): Promise<void> {
  const { db, schema } = await databaseContext();
  await db.transaction(async (tx: typeof db) => {
    const [locked] = await tx
      .select({ id: schema.fileObjects.id })
      .from(schema.fileObjects)
      .where(
        and(
          eq(schema.fileObjects.id, lease.fileId),
          eq(schema.fileObjects.processingLeaseId, lease.token),
          eq(schema.fileObjects.processingStatus, current),
        ),
      )
      .limit(1)
      .for("update");
    if (!locked) throw new FileProcessingLeaseLostError();

    const renewed = await tx
      .update(schema.fileObjects)
      .set({ processingLeaseExpiresAt: STATEMENT_LEASE_EXPIRES_AT })
      .where(ownedWhere(schema, lease, [current], STATEMENT_TIMESTAMP))
      .returning({ id: schema.fileObjects.id });
    assertOwned(renewed);

    await tx.delete(schema.fileChunks).where(eq(schema.fileChunks.fileId, lease.fileId));
    const rows = chunks.map((chunk) => ({
      fileId: lease.fileId,
      chunkIndex: chunk.chunkIndex,
      pageNum: chunk.pageNum,
      charOffset: chunk.charOffset,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      embedding: chunk.embedding,
    }));
    for (let index = 0; index < rows.length; index += CHUNK_INSERT_BATCH_SIZE) {
      await tx.insert(schema.fileChunks).values(
        rows.slice(index, index + CHUNK_INSERT_BATCH_SIZE),
      );
    }

    const completed = await tx
      .update(schema.fileObjects)
      .set(terminalPatch)
      .where(ownedWhere(schema, lease, [current], STATEMENT_TIMESTAMP))
      .returning({ id: schema.fileObjects.id });
    assertOwned(completed);
  });
}
