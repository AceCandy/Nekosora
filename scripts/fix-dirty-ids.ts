/**
 * 修复脚本 —— 把 5 行 bug 脏数据的 id 改为新生成的真 UUID,保留业务数据。
 *
 * 脏数据成因:pgSchema .default("(gen_random_uuid())") 被当字符串常量,
 * 导致 id 全部撞成同一字面量 "(gen_random_uuid())"。
 *
 * 运行(先 dry-run 确认):
 *   pnpm tsx --env-file-if-exists=.env.local scripts/fix-dirty-ids.ts            # dry-run,只打印
 *   pnpm tsx --env-file-if-exists=.env.local scripts/fix-dirty-ids.ts --apply    # 真实执行(单事务)
 *
 * 修复逻辑(单事务):
 *   - messages:同时改 id + conversation_id(它的 conversation_id 指向脏 conversations.id,
 *     必须同步更新,否则外键违规)。
 *   - conversations:改 id(其外键引用方 messages 的 conversation_id 已在上一步同步改好)。
 *   - global_models / global_providers / usage_logs:无外键引用,独立改 id。
 *   新 UUID 在 TS 侧用 crypto.randomUUID() 生成,不依赖 DB。
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "@/lib/infra/db";

const DIRTY = "(gen_random_uuid())";
const APPLY = process.argv.includes("--apply");

async function main() {
  const db = await getDb();
  const apply = APPLY;

  console.log(apply ? "=== 真实执行(单事务) ===" : "=== DRY-RUN(只打印,加 --apply 真实执行) ===\n");

  // 为 5 张表各生成一个新 id 映射。
  const newIds = {
    conversations: crypto.randomUUID(),
    messages: crypto.randomUUID(),
    global_models: crypto.randomUUID(),
    global_providers: crypto.randomUUID(),
    usage_logs: crypto.randomUUID(),
  };

  console.log("新 id 映射:");
  for (const [t, id] of Object.entries(newIds)) {
    console.log(`  ${t}: ${DIRTY} → ${id}`);
  }
  console.log("");

  if (!apply) {
    console.log("将执行的 SQL(单事务内):");
    console.log(`  UPDATE conversations SET id='${newIds.conversations}' WHERE id='${DIRTY}';`);
    console.log(`  UPDATE messages SET id='${newIds.messages}', conversation_id='${newIds.conversations}' WHERE id='${DIRTY}';`);
    console.log(`  UPDATE global_models SET id='${newIds.global_models}' WHERE id='${DIRTY}';`);
    console.log(`  UPDATE global_providers SET id='${newIds.global_providers}' WHERE id='${DIRTY}';`);
    console.log(`  UPDATE usage_logs SET id='${newIds.usage_logs}' WHERE id='${DIRTY}';`);
    console.log("\n确认无误后,加 --apply 参数真实执行。");
    await closeDb();
    return;
  }

  // 真实执行:单事务,任一步失败全回滚。
  // conversations ↔ messages 互相外键引用脏值,无法用语句顺序解决
  // (改父则子还指旧值,改子则新值在父不存在)。故事务内把该外键临时设为
  // deferrable 并 SET CONSTRAINTS DEFERRED,检查推迟到 commit 时,两步都满足。
  await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`ALTER TABLE messages
          ALTER CONSTRAINT messages_conversation_id_conversations_id_fk
          DEFERRABLE INITIALLY IMMEDIATE`,
    );
    await tx.execute(sql`SET CONSTRAINTS messages_conversation_id_conversations_id_fk DEFERRED`);

    const r2 = await tx.execute(
      sql`UPDATE conversations SET id = ${newIds.conversations} WHERE id = ${DIRTY}`,
    );
    console.log(`  conversations 更新:${(r2 as any).rowCount ?? "?"} 行`);

    const r1 = await tx.execute(
      sql`UPDATE messages SET id = ${newIds.messages}, conversation_id = ${newIds.conversations}
          WHERE id = ${DIRTY}`,
    );
    console.log(`  messages 更新:${(r1 as any).rowCount ?? "?"} 行`);

    // 其余 3 张表无外键引用,独立改。
    for (const [table, newId] of Object.entries(newIds)) {
      if (table === "conversations" || table === "messages") continue;
      const r = await tx.execute(
        sql`UPDATE "${sql.raw(table)}" SET id = ${newId} WHERE id = ${DIRTY}`,
      );
      console.log(`  ${table} 更新:${(r as any).rowCount ?? "?"} 行`);
    }
  });

  // 修复后校验:脏行数应为 0。
  const tables = ["conversations", "messages", "global_models", "global_providers", "usage_logs"];
  let remaining = 0;
  for (const t of tables) {
    const res = (await db.execute(
      sql.raw(`select count(*)::int as c from "${t}" where "id" = '${DIRTY}'`),
    )) as { rows?: { c: number }[] };
    const c = res.rows?.[0]?.c ?? 0;
    if (c > 0) {
      console.log(`  ⚠️ ${t} 仍有 ${c} 行脏数据`);
      remaining += c;
    }
  }
  console.log(remaining === 0 ? "\n✅ 修复完成,剩余脏行: 0" : `\n❌ 仍有 ${remaining} 行未修复`);

  await closeDb();
}

main().catch((e) => {
  console.error("修复失败(已回滚):", e);
  process.exit(1);
});
