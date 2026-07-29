#!/usr/bin/env node
/**
 * 同步 / 导入 pi 模型配置到 model_catalog(运行入口 + IO)。
 * 纯逻辑见 src/lib/sync-pi-models.ts。
 *
 * 数据源: https://pi.dev/api/models
 *   - PI_MODELS_URL  覆盖 API 地址
 *   - PI_MODELS_FILE 改读本地 JSON 快照(离线/测试)
 *
 * 两种模式:
 *   1) 默认:只对照「已有 catalog 行」做更新(ctx/max/capabilities)
 *   2) --import-missing:把 pi 里我们还没有的型号去重后全量导入
 *
 * 用法(脚本会自动加载 .env.local / .env):
 *   pnpm tsx scripts/sync-pi-models.ts                              # dry-run 已有行差异
 *   pnpm tsx scripts/sync-pi-models.ts --import-missing             # dry-run 缺失导入清单
 *   pnpm tsx scripts/sync-pi-models.ts --import-missing --apply     # 执行全量导入缺失型号
 *   pnpm tsx scripts/sync-pi-models.ts --write --apply              # 更新已有匹配行
 *   pnpm tsx scripts/sync-pi-models.ts --import-missing --write --apply  # 导入+更新
 */
import { eq, sql } from "drizzle-orm";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, getSchema, closeDb } from "@/lib/infra/db";
import {
  parsePiModelsApi,
  planCatalogSync,
  planMissingImports,
  match,
  translate,
  passesInvariants,
  buildUpsert,
  buildImportUpsert,
  nextDataMigrationSnapshot,
  nextSyncMigrationSlot,
  type CatalogRow,
  type DrizzleSnapshot,
  type JournalEntry,
  type PiCatalog,
  type ImportCandidate,
} from "@/lib/sync-pi-models";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

loadEnvFiles();

const WRITE = process.argv.includes("--write");
const APPLY = process.argv.includes("--apply");
const IMPORT_MISSING = process.argv.includes("--import-missing");
const PI_API = process.env.PI_MODELS_URL ?? "https://pi.dev/api/models";
const PI_FILE = process.env.PI_MODELS_FILE;

async function loadPiCatalog(root: string): Promise<PiCatalog> {
  if (PI_FILE) {
    console.error(`pi 数据: 本地文件 ${PI_FILE}`);
    return parsePiModelsApi(JSON.parse(readFileSync(PI_FILE, "utf8")) as unknown);
  }

  const cacheDir = join(root, "scripts", ".cache");
  const cachePath = join(cacheDir, "pi-models.json");
  console.error(`pi 数据: GET ${PI_API}`);

  try {
    const res = await fetch(PI_API, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const raw = (await res.json()) as unknown;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(raw));
    console.error(`已缓存 → ${cachePath}`);
    return parsePiModelsApi(raw);
  } catch (err) {
    if (existsSync(cachePath)) {
      console.error(`拉取失败(${err instanceof Error ? err.message : err}),回退缓存 ${cachePath}`);
      return parsePiModelsApi(JSON.parse(readFileSync(cachePath, "utf8")) as unknown);
    }
    throw err;
  }
}

function buildMatchedUpserts(rows: CatalogRow[], PI: PiCatalog): string[] {
  const stmts: string[] = [];
  for (const row of rows) {
    if (row.canonicalModelId.startsWith("__generic_")) continue;
    const m = match(row.canonicalModelId, row.aliases ?? [], PI);
    if (!m) continue;
    const next = translate(row.capabilities ?? {}, m.pi);
    if (!passesInvariants(next)) {
      next.thinkingLevelMap = row.capabilities?.thinkingLevelMap;
    }
    stmts.push(
      buildUpsert(
        row.canonicalModelId,
        row.name,
        next,
        m.pi.contextWindow ?? null,
        m.pi.maxTokens ?? null,
      ),
    );
  }
  return stmts;
}

function buildImportUpserts(imports: ImportCandidate[], baseSort: number): string[] {
  return imports.map((item, i) =>
    buildImportUpsert(
      item.canonicalModelId,
      item.name,
      item.aliases,
      item.capabilities,
      item.contextWindow,
      item.maxOutputTokens,
      baseSort + i,
    ),
  );
}

function writeMigration(tag: string, idx: number, stmts: string[], kind: string): string {
  const migDir = join(ROOT, "drizzle", "pg");
  const jp = join(migDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(jp, "utf8")) as { entries: JournalEntry[] };
  const sqlPath = join(migDir, `${tag}.sql`);
  const sql =
    `-- ${kind}(由 scripts/sync-pi-models.ts 生成,幂等 upsert)\n` +
    `-- 数据源: https://pi.dev/api/models\n\n` +
    stmts.join("\n--> statement-breakpoint\n") +
    "\n";
  writeFileSync(sqlPath, sql);

  if (!journal.entries.some((e) => e.tag === tag)) {
    journal.entries.push({
      idx,
      version: "7",
      when: Date.now(),
      tag,
      breakpoints: true,
    });
    writeFileSync(jp, `${JSON.stringify(journal, null, 2)}\n`);
  }

  const prevIdx = String(Math.max(0, idx - 1)).padStart(4, "0");
  const nextIdx = String(idx).padStart(4, "0");
  const prevSnap = join(migDir, "meta", `${prevIdx}_snapshot.json`);
  const nextSnap = join(migDir, "meta", `${nextIdx}_snapshot.json`);
  if (existsSync(prevSnap) && !existsSync(nextSnap)) {
    const previous = JSON.parse(readFileSync(prevSnap, "utf8")) as DrizzleSnapshot;
    const next = nextDataMigrationSnapshot(previous, randomUUID());
    writeFileSync(nextSnap, `${JSON.stringify(next, null, 2)}\n`);
  }
  return sqlPath;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "未配置 DATABASE_URL。请在项目根目录提供 .env.local(含 DATABASE_URL),或先 export DATABASE_URL=...",
    );
  }
  const PI = await loadPiCatalog(ROOT);

  const db = await getDb();
  const tbl = getSchema().modelCatalog;
  const rows = (await db.select({
    canonicalModelId: tbl.canonicalModelId,
    name: tbl.name,
    aliases: tbl.aliases,
    capabilities: tbl.capabilities,
    contextWindow: tbl.contextWindow,
    maxOutputTokens: tbl.maxOutputTokens,
  }).from(tbl).where(eq(tbl.modelType, "chat"))) as CatalogRow[];

  const stmts: string[] = [];
  let migrationKind = "";

  // ---- 模式 A: 导入 pi 中缺失的型号 ----
  if (IMPORT_MISSING) {
    const { imports, groupCount, skippedExisting } = planMissingImports(rows, PI);
    console.log("## 缺失导入 (--import-missing)\n");
    for (const item of imports.slice(0, 50)) {
      console.log(
        `+ ${item.canonicalModelId}  (${item.via})  ctx=${item.contextWindow ?? "-"} max=${item.maxOutputTokens ?? "-"}  aliases=${item.aliases.length}`,
      );
    }
    if (imports.length > 50) {
      console.log(`... 另有 ${imports.length - 50} 条未展开`);
    }
    console.log(
      `\n导入候选 ${imports.length}(pi 去重组 ${groupCount},已存在跳过 ${skippedExisting})`,
    );

    if (WRITE || APPLY) {
      const [maxRow] = await db
        .select({ maxSort: sql<number>`coalesce(max(${tbl.sortOrder}), 0)` })
        .from(tbl);
      const baseSort = Math.max(2000, Number(maxRow?.maxSort ?? 0) + 1);
      stmts.push(...buildImportUpserts(imports, baseSort));
      migrationKind = "全量导入 pi 缺失模型到 model_catalog";
    }
  } else {
    // ---- 模式 B: 仅同步已有 catalog 行 ----
    const plan = planCatalogSync(rows, PI);
    const lines: string[] = [];
    for (const id of plan.unmatched) lines.push(`• ${id} — 未匹配,跳过`);
    for (const ch of plan.changes) {
      const seg = [`• ${ch.canonicalModelId} (${ch.via})`];
      if (ch.gateFallback) seg.push("    ⚠ 闸门拦截:刷后无可显档,已回退 thinkingLevelMap");
      if (ch.capChanges.length) seg.push(`    cap  ${ch.capChanges.join("; ")}`);
      if (ch.ctxChange) seg.push(`    ctx  ${ch.ctxChange}`);
      if (ch.maxChange) seg.push(`    max  ${ch.maxChange}`);
      lines.push(seg.join("\n"));
    }
    console.log(lines.join("\n"));
    console.log(
      `\n合计:匹配 ${plan.matched}(其中已一致 ${plan.unchanged},需改 ${plan.changes.length}),未匹配 ${plan.unmatched.length}`,
    );
    console.log(
      `\n提示:若要导入 pi 中「我们还没有」的型号,请加 --import-missing\n` +
        `  例: pnpm tsx scripts/sync-pi-models.ts --import-missing\n` +
        `      pnpm tsx scripts/sync-pi-models.ts --import-missing --apply`,
    );

    if (WRITE || APPLY) {
      stmts.push(...buildMatchedUpserts(rows, PI));
      migrationKind = "同步 pi 配置到已有 model_catalog 行";
    }
  }

  // 同时指定时:在 import 之外再追加已有行更新
  if (IMPORT_MISSING && (WRITE || APPLY) && process.argv.includes("--also-update")) {
    stmts.push(...buildMatchedUpserts(rows, PI));
    migrationKind += " + 更新已有行";
  }

  if (!WRITE && !APPLY) {
    await closeDb();
    return;
  }

  if (stmts.length === 0) {
    console.log("\n无 SQL 需要落盘/执行。");
    await closeDb();
    return;
  }

  if (WRITE) {
    const jp = join(ROOT, "drizzle", "pg", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(jp, "utf8")) as { entries: JournalEntry[] };
    const tagBase = IMPORT_MISSING ? "import_pi_models" : "sync_pi_models";
    const { idx, tag } = nextSyncMigrationSlot(journal.entries, tagBase);
    const sqlPath = writeMigration(tag, idx, stmts, migrationKind);
    console.log(`\n已写入 ${stmts.length} 条 SQL → ${sqlPath}`);
  }

  if (APPLY) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const stmt of stmts) await (db as any).execute(stmt);
    console.log(`--apply:已对当前 DB 执行 ${stmts.length} 条 SQL`);
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
