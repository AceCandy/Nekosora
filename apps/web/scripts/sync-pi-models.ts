#!/usr/bin/env node
/** Audit pi model data and optionally write a versioned PostgreSQL migration. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { closeDb, getDb, getSchema } from "@/lib/infra/db";
import {
  buildCatalogSyncSql,
  CatalogSyncInputError,
  nextDataMigrationSnapshot,
  nextSyncMigrationSlot,
  planCatalogSync,
  type CatalogOperation,
  type CatalogRow,
  type DrizzleSnapshot,
  type JournalEntry,
  type SyncPlan,
} from "@/lib/sync-pi-models";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PI_MODELS_URL = "https://pi.dev/api/models";

export interface SyncCliOptions {
  write: boolean;
}

export interface SyncEnvironment {
  DATABASE_URL?: string;
  PI_MODELS_FILE?: string;
  PI_MODELS_URL?: string;
}

export type SyncSource =
  | { kind: "live" }
  | { kind: "file"; path: string };

export class SyncCliError extends Error {
  constructor(
    public readonly stage: string,
    public readonly reason: string,
  ) {
    super("model catalog sync failed");
    this.name = "SyncCliError";
  }
}

export function parseSyncArgs(args: string[]): SyncCliOptions {
  const forwardedArgs = args[0] === "--" ? args.slice(1) : args;
  if (forwardedArgs.some((argument) => argument !== "--write")) {
    throw new SyncCliError("arguments", "unsupported_argument");
  }
  if (forwardedArgs.filter((argument) => argument === "--write").length > 1) {
    throw new SyncCliError("arguments", "duplicate_argument");
  }
  return { write: forwardedArgs.includes("--write") };
}

export function resolveSyncSource(
  options: SyncCliOptions,
  env: SyncEnvironment,
): SyncSource {
  const snapshotPath = env.PI_MODELS_FILE?.trim();
  if (options.write && !snapshotPath) {
    throw new SyncCliError("arguments", "write_requires_snapshot");
  }
  return snapshotPath ? { kind: "file", path: snapshotPath } : { kind: "live" };
}

export function renderSyncFailure(error: unknown): string {
  const failure = error instanceof SyncCliError
    ? error
    : new SyncCliError("internal", "unexpected_failure");
  return `model catalog sync failed: stage=${failure.stage} reason=${failure.reason}`;
}

function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

interface LoadedSource {
  payload: unknown;
  digest?: string;
}

async function loadSource(source: SyncSource, env: SyncEnvironment): Promise<LoadedSource> {
  if (source.kind === "file") {
    let text: string;
    try {
      text = readFileSync(source.path, "utf8");
    } catch {
      throw new SyncCliError("source", "snapshot_read_failed");
    }
    try {
      return {
        payload: JSON.parse(text) as unknown,
        digest: createHash("sha256").update(text).digest("hex"),
      };
    } catch {
      throw new SyncCliError("source", "snapshot_invalid");
    }
  }

  let response: Response;
  try {
    response = await fetch(env.PI_MODELS_URL ?? DEFAULT_PI_MODELS_URL, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new SyncCliError("source", "fetch_failed");
  }
  if (!response.ok) throw new SyncCliError("source", "fetch_failed");
  try {
    return { payload: await response.json() as unknown };
  } catch {
    throw new SyncCliError("source", "payload_invalid");
  }
}

function renderOperation(operation: CatalogOperation): string {
  if (operation.target === "column") {
    return `${operation.column}=set:${operation.value}`;
  }
  return operation.action === "delete"
    ? `capability.${operation.key}=delete`
    : `capability.${operation.key}=set`;
}

function auditIdentifier(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:@~/-]{0,199}$/.test(value) && !value.includes("://")
    ? value
    : "redacted-model";
}

export function renderSyncPlan(plan: SyncPlan): string {
  const lines: string[] = [];
  for (const id of plan.unmatched.generic) lines.push(`unmatched generic ${auditIdentifier(id)}`);
  for (const id of plan.unmatched.catalog) lines.push(`unmatched catalog ${auditIdentifier(id)}`);
  for (const rejection of plan.rejections) {
    const subject = rejection.canonicalModelId
      ? auditIdentifier(rejection.canonicalModelId)
      : "external-model";
    lines.push(`rejected ${subject} ${rejection.scope}:${rejection.code}`);
  }
  for (const reference of plan.references) {
    lines.push(
      `reference ${auditIdentifier(reference.canonicalModelId)} ${reference.match.kind} `
      + reference.operations.map(renderOperation).join(","),
    );
  }
  for (const addition of plan.additions) {
    lines.push(
      `new ${auditIdentifier(addition.canonicalModelId)} ${addition.match.kind}`,
    );
  }
  for (const change of plan.changes) {
    lines.push(
      `accepted ${auditIdentifier(change.canonicalModelId)} `
      + change.operations.map(renderOperation).join(","),
    );
  }
  lines.push(
    `summary matched=${plan.matched} unchanged=${plan.unchanged} `
    + `additions=${plan.additions.length} accepted=${plan.changes.length} `
    + `references=${plan.references.length} `
    + `rejected=${plan.rejections.length}`,
  );
  return lines.join("\n");
}

function writeMigration(statements: string[], digest: string): { tag: string; count: number } {
  const migrationDir = join(ROOT, "drizzle", "pg");
  const journalPath = join(migrationDir, "meta", "_journal.json");
  let journal: { entries: JournalEntry[] };
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
  } catch {
    throw new SyncCliError("migration", "journal_invalid");
  }

  const { idx, tag } = nextSyncMigrationSlot(journal.entries, "model_catalog_sync");
  const previousIndex = String(idx - 1).padStart(4, "0");
  const nextIndex = String(idx).padStart(4, "0");
  const previousSnapshotPath = join(migrationDir, "meta", `${previousIndex}_snapshot.json`);
  const nextSnapshotPath = join(migrationDir, "meta", `${nextIndex}_snapshot.json`);
  const sqlPath = join(migrationDir, `${tag}.sql`);
  if (!existsSync(previousSnapshotPath)) {
    throw new SyncCliError("migration", "previous_snapshot_missing");
  }
  if (existsSync(sqlPath) || existsSync(nextSnapshotPath)) {
    throw new SyncCliError("migration", "target_exists");
  }

  let previousSnapshot: DrizzleSnapshot;
  try {
    previousSnapshot = JSON.parse(readFileSync(previousSnapshotPath, "utf8")) as DrizzleSnapshot;
  } catch {
    throw new SyncCliError("migration", "previous_snapshot_invalid");
  }
  const nextSnapshot = nextDataMigrationSnapshot(previousSnapshot, randomUUID());
  const lastWhen = journal.entries.at(-1)?.when ?? 0;
  journal.entries.push({
    idx,
    version: "7",
    when: Math.max(Date.now(), lastWhen + 1),
    tag,
    breakpoints: true,
  });
  const sql = [
    "-- Model catalog sync generated from a reviewed local snapshot.",
    `-- source-sha256: ${digest}`,
    "",
    statements.join("\n--> statement-breakpoint\n"),
    "",
  ].join("\n");

  const temporarySuffix = `${process.pid}-${randomUUID()}.tmp`;
  const temporarySqlPath = `${sqlPath}.${temporarySuffix}`;
  const temporaryJournalPath = `${journalPath}.${temporarySuffix}`;
  const temporarySnapshotPath = `${nextSnapshotPath}.${temporarySuffix}`;
  let sqlCommitted = false;
  let snapshotCommitted = false;
  const cleanup = (path: string): void => {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Preserve the stable write_failed contract; the caller will inspect the worktree.
    }
  };

  try {
    writeFileSync(temporarySqlPath, sql);
    writeFileSync(temporaryJournalPath, `${JSON.stringify(journal, null, 2)}\n`);
    writeFileSync(temporarySnapshotPath, `${JSON.stringify(nextSnapshot, null, 2)}\n`);
    renameSync(temporarySqlPath, sqlPath);
    sqlCommitted = true;
    renameSync(temporarySnapshotPath, nextSnapshotPath);
    snapshotCommitted = true;
    renameSync(temporaryJournalPath, journalPath);
  } catch {
    cleanup(temporarySqlPath);
    cleanup(temporaryJournalPath);
    cleanup(temporarySnapshotPath);
    if (sqlCommitted) cleanup(sqlPath);
    if (snapshotCommitted) cleanup(nextSnapshotPath);
    throw new SyncCliError("migration", "write_failed");
  }
  return { tag, count: statements.length };
}

async function readCatalogRows(): Promise<CatalogRow[]> {
  let db: Awaited<ReturnType<typeof getDb>>;
  try {
    db = await getDb();
    const table = getSchema().modelCatalog;
    return await db.select({
      canonicalModelId: table.canonicalModelId,
      name: table.name,
      aliases: table.aliases,
      capabilities: table.capabilities,
      contextWindow: table.contextWindow,
      maxOutputTokens: table.maxOutputTokens,
    }).from(table).where(eq(table.modelType, "chat")) as CatalogRow[];
  } catch {
    throw new SyncCliError("database", "catalog_read_failed");
  }
}

async function executeSync(options: SyncCliOptions, env: SyncEnvironment): Promise<void> {
  let primaryError: unknown;
  try {
    const source = resolveSyncSource(options, env);
    const loaded = await loadSource(source, env);
    if (!env.DATABASE_URL) throw new SyncCliError("configuration", "database_url_missing");
    const rows = await readCatalogRows();
    let plan: SyncPlan;
    try {
      plan = planCatalogSync(rows, loaded.payload);
    } catch (error) {
      if (error instanceof CatalogSyncInputError) {
        throw new SyncCliError("decode", error.code);
      }
      throw error;
    }
    console.log(renderSyncPlan(plan));

    if (options.write) {
      const statements = buildCatalogSyncSql(plan);
      if (statements.length === 0) {
        console.log("migration skipped: no accepted changes");
      } else if (!loaded.digest) {
        throw new SyncCliError("migration", "source_digest_missing");
      } else {
        const result = writeMigration(statements, loaded.digest);
        console.log(`migration written: tag=${result.tag} statements=${result.count}`);
      }
    }
  } catch (error) {
    primaryError = error;
  }

  try {
    await closeDb();
  } catch {
    primaryError ??= new SyncCliError("database", "close_failed");
  }
  if (primaryError) throw primaryError;
}

async function main(): Promise<void> {
  const options = parseSyncArgs(process.argv.slice(2));
  loadEnvFiles();
  await executeSync(options, {
    DATABASE_URL: process.env.DATABASE_URL,
    PI_MODELS_FILE: process.env.PI_MODELS_FILE,
    PI_MODELS_URL: process.env.PI_MODELS_URL,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(renderSyncFailure(error));
    process.exitCode = 1;
  });
}
