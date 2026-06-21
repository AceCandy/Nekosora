/** 一次性脚本:给 seed 管理员签发主 key(若已有则打印提示)。 */
import { eq } from "drizzle-orm";
import { getDb, getSchema, closeDb } from "@/lib/infra/db";
import { createMasterKey } from "@/lib/keys";

async function main() {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@nekusora.local";
  const [user] = await db.select().from(s.user).where(eq(s.user.email, email)).limit(1);
  if (!user) throw new Error(`管理员 ${email} 不存在,请先 pnpm seed`);

  try {
    const rawKey = await createMasterKey(user.id, "管理员主密钥");
    console.log("✅ 主密钥已签发(仅此一次显示,请妥善保存):");
    console.log("   " + rawKey);
    console.log("\n用此 key 调用网关:");
    console.log(`   curl http://localhost:3000/v1/models -H "Authorization: Bearer ${rawKey}"`);
  } catch (e) {
    console.log("主密钥已存在。如需重置,先删除 api_keys 表中该用户的记录。");
    console.log("错误:", e instanceof Error ? e.message : e);
  }
}

main().then(() => closeDb()).then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
