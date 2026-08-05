/**
 * 将 user_settings.web_search V1 明文密钥转换为 V2 密文配置。
 * 默认 dry-run；仅显式传入 --apply 时在单事务中写库。
 */
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, getSchema } from "@/lib/infra/db";
import { planWebSearchConfigBackfill } from "@/lib/web-search/registry";

const APPLY = process.argv.includes("--apply");
const WEB_SEARCH_KEY = "web_search";

interface BackfillRow {
  userId: string;
  value: string;
}

interface PlannedUpdate {
  userId: string;
  value: string;
}

function parseStoredValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

async function loadRows(db: Awaited<ReturnType<typeof getDb>>): Promise<BackfillRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  return db
    .select({ userId: s.userSettings.userId, value: s.userSettings.value })
    .from(s.userSettings)
    .where(eq(s.userSettings.key, WEB_SEARCH_KEY));
}

async function main(): Promise<void> {
  const db = await getDb();
  const rows = await loadRows(db);
  const updates: PlannedUpdate[] = [];
  let upToDate = 0;
  let invalid = 0;
  let legacyInvalid = 0;
  let encryptedProviders = 0;

  for (const row of rows) {
    const plan = planWebSearchConfigBackfill(parseStoredValue(row.value));
    if (plan.status === "up-to-date") {
      upToDate += 1;
    } else if (plan.status === "invalid") {
      invalid += 1;
      if (plan.legacy) legacyInvalid += 1;
    } else {
      updates.push({ userId: row.userId, value: JSON.stringify(plan.stored) });
      encryptedProviders += plan.providerCount;
    }
  }

  console.log(APPLY ? "=== Web Search Key 回填 ===" : "=== Web Search Key 回填 DRY-RUN ===");
  console.log(`扫描配置: ${rows.length}`);
  console.log(`待转换 V1: ${updates.length}`);
  console.log(`待加密密钥: ${encryptedProviders}`);
  console.log(`已是 V2: ${upToDate}`);
  console.log(`无效配置: ${invalid}`);

  if (!APPLY) {
    console.log("未写入数据库；确认后加 --apply 执行。");
    if (legacyInvalid > 0) console.log(`仍需人工处理的无效 V1: ${legacyInvalid}`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  await db.transaction(async (tx: typeof db) => {
    for (const update of updates) {
      await tx
        .update(s.userSettings)
        .set({ value: update.value, updatedAt: new Date() })
        .where(and(
          eq(s.userSettings.userId, update.userId),
          eq(s.userSettings.key, WEB_SEARCH_KEY),
        ));
    }
  });

  const remainingLegacy = (await loadRows(db)).filter((row) => {
    const value = parseStoredValue(row.value);
    return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 1);
  }).length;
  console.log(`已更新配置: ${updates.length}`);
  console.log(`剩余 V1: ${remainingLegacy}`);
  if (remainingLegacy > 0) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("Web Search Key 回填失败");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
