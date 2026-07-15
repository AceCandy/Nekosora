#!/usr/bin/env node
/**
 * 同步 pi 模型配置到 model_catalog(运行入口 + IO)。
 * 纯逻辑见 src/lib/sync-pi-models.ts。三不变量见该文件头部。
 *
 * 用法:
 *   pnpm tsx scripts/sync-pi-models.ts            # dry-run,仅打印差异报告
 *   pnpm tsx scripts/sync-pi-models.ts --write    # 生成 drizzle 迁移 0001_sync_pi_models.sql
 */
import { eq } from "drizzle-orm";
import { getDb, getSchema, closeDb } from "@/lib/infra/db";
import {
  match, translate, passesInvariants, diffCaps, buildUpsert,
  type PiModel, type CatalogRow,
} from "@/lib/sync-pi-models";
import { writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WRITE = process.argv.includes("--write");

async function main(): Promise<void> {
  // pi 参考项目位于 docs/(tsconfig 已 exclude),用变量路径动态 import,
  // tsc 不静态解析其类型链,运行时由 tsx 解析。
  const piModelsPath = "../docs/cankao/pi/packages/ai/src/models.generated.ts";
  const PI = ((await import(piModelsPath)) as { MODELS: unknown })
    .MODELS as Record<string, Record<string, PiModel>>;
  const db = await getDb();
  const tbl = getSchema().modelCatalog;
  const rows = await db.select({
    id: tbl.id,
    canonicalModelId: tbl.canonicalModelId,
    aliases: tbl.aliases,
    capabilities: tbl.capabilities,
    contextWindow: tbl.contextWindow,
    maxOutputTokens: tbl.maxOutputTokens,
  }).from(tbl).where(eq(tbl.modelType, "chat"));
  await closeDb();

  const lines: string[] = [];
  const stmts: string[] = [];
  let matched = 0, unchanged = 0, unmatched = 0;

  for (const row of rows as CatalogRow[]) {
    const m = match(row.canonicalModelId, row.aliases ?? [], PI);
    if (!m) { lines.push(`• ${row.canonicalModelId} — 未匹配,跳过`); unmatched++; continue; }
    matched++;
    const cur = row.capabilities ?? {};
    const next = translate(cur, m.pi);
    if (!passesInvariants(next)) {
      lines.push(`• ${row.canonicalModelId} (${m.via}) — ⚠ 闸门拦截:刷后无可显档,回退 thinkingLevelMap`);
      next.thinkingLevelMap = cur.thinkingLevelMap;
    }
    const capCh = diffCaps(cur, next);
    const ctxNew = m.pi.contextWindow ?? null;
    const maxNew = m.pi.maxTokens ?? null;
    const ctxCh = ctxNew != null && ctxNew !== row.contextWindow ? `${row.contextWindow} → ${ctxNew}` : null;
    const maxCh = maxNew != null && maxNew !== row.maxOutputTokens ? `${row.maxOutputTokens} → ${maxNew}` : null;
    // 迁移对所有匹配模型全量 upsert(保证新库重放也达目标态,非仅运行库差异)。
    if (WRITE) stmts.push(buildUpsert(row.canonicalModelId, next, ctxNew, maxNew));
    if (capCh.length === 0 && !ctxCh && !maxCh) { unchanged++; continue; }
    const seg = [`• ${row.canonicalModelId} (${m.via})`];
    if (capCh.length) seg.push(`    cap  ${capCh.join("; ")}`);
    if (ctxCh) seg.push(`    ctx  ${ctxCh}`);
    if (maxCh) seg.push(`    max  ${maxCh}`);
    lines.push(seg.join("\n"));
  }

  console.log(lines.join("\n"));
  console.log(`\n合计:匹配 ${matched}(其中已一致 ${unchanged},需改 ${matched - unchanged}),未匹配 ${unmatched}`);

  if (WRITE && stmts.length) {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const migDir = join(root, "drizzle", "pg");
    const sql =
      "-- 同步 pi 模型配置到 model_catalog(由 scripts/sync-pi-models.ts 生成,幂等 upsert)\n" +
      "-- 不改 schema;仅对齐主流 chat 模型的 reasoning/thinkingLevelMap/reasoningEffort/vision/context_window/max_output_tokens\n\n" +
      stmts.join("\n--> statement-breakpoint\n") + "\n";
    writeFileSync(join(migDir, "0001_sync_pi_models.sql"), sql);
    const jp = join(migDir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(jp, "utf8")) as { entries: Array<Record<string, unknown>> };
    if (!journal.entries.some((e) => e.tag === "0001_sync_pi_models")) {
      journal.entries.push({
        idx: 1, version: "7", when: Date.now(),
        tag: "0001_sync_pi_models", breakpoints: true,
      });
      writeFileSync(jp, JSON.stringify(journal, null, 2));
    }
    copyFileSync(join(migDir, "meta", "0000_snapshot.json"), join(migDir, "meta", "0001_snapshot.json"));
    console.log(`\n已写入 ${stmts.length} 条 upsert → drizzle/pg/0001_sync_pi_models.sql(已更新 _journal.json、复制 0001_snapshot.json)`);
  }
  if (WRITE && stmts.length === 0) console.log("\n--write 模式但无改动需落盘。");
}

main().catch((e) => { console.error(e); process.exit(1); });
