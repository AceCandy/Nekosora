/**
 * 只读探查脚本 —— 统计各表 id 为 bug 字面量的脏数据。
 *
 * 只 SELECT,不写入。运行:
 *   pnpm tsx --env-file-if-exists=.env.local scripts/inspect-dirty-ids.ts
 *
 * 直接查 information_schema 列举"含 id 列的表",不依赖 drizzle 内部结构,
 * 避免对象字段读取问题。脏数据判定:id = bug 产生的字面量。
 */
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "@/lib/infra/db";

const DIRTY = "(gen_random_uuid())";

async function main() {
  const db = await getDb();

  // 列举所有 public schema 下、名为 id 的列所在表。
  const tablesRes = (await db.execute(
    sql`select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'id'
        order by table_name`,
  )) as { rows?: { table_name: string }[] };
  const tables = (tablesRes.rows ?? []).map((r) => r.table_name);

  console.log(`\n=== 探查 ${tables.length} 张表的脏数据(id = '${DIRTY}') ===\n`);

  let totalDirty = 0;
  const hit: { table: string; count: number }[] = [];
  for (const table of tables) {
    const res = (await db.execute(
      sql.raw(`select count(*)::int as c from "${table}" where "id" = '${DIRTY}'`),
    )) as { rows?: { c: number }[] };
    const count = res.rows?.[0]?.c ?? 0;
    if (count > 0) {
      console.log(`  [脏] ${table}: ${count} 行`);
      hit.push({ table, count });
      totalDirty += count;
    }
  }

  if (totalDirty === 0) {
    console.log("  (无脏数据)");
  }
  console.log(`\n合计脏行: ${totalDirty}`);

  // 对每张有脏行的表,探查其有哪些列被其他表外键引用(级联影响面)。
  if (hit.length > 0) {
    console.log(`\n=== 受外键引用的脏主键(级联面) ===\n`);
    for (const { table } of hit) {
      // 用 referenced 列匹配父表 id,避免把 child 自身列名误判为引用列。
      const fkRes = (await db.execute(
        sql`select kcu.table_name as child_table, kcu.column_name as child_col
            from information_schema.referential_constraints rc
            join information_schema.key_column_usage kcu
              on kcu.constraint_name = rc.constraint_name
            join information_schema.constraint_column_usage ccu
              on ccu.constraint_name = rc.unique_constraint_name
            where ccu.table_name = ${table} and ccu.column_name = 'id'`,
      )) as { rows?: { child_table: string; child_col: string }[] };
      const refs = fkRes.rows ?? [];
      if (refs.length > 0) {
        console.log(`  ${table} 被引用:`);
        for (const r of refs) {
          const cRes = (await db.execute(
            sql.raw(
              `select count(*)::int as c from "${r.child_table}" where "${r.child_col}" = '${DIRTY}'`,
            ),
          )) as { rows?: { c: number }[] };
          const c = cRes.rows?.[0]?.c ?? 0;
          console.log(`     └─ ${r.child_table}.${r.child_col}: ${c} 行脏引用`);
        }
      } else {
        console.log(`  ${table}: 无外键被引用`);
      }
    }
  }

  await closeDb();
}

main().catch((e) => {
  console.error("探查失败:", e);
  process.exit(1);
});
