/**
 * Seed 脚本 —— 创建首个管理员账号(若数据库无任何用户)。
 * 运行:pnpm seed
 *
 * 幂等:已有用户则跳过。
 */
import { eq } from "drizzle-orm";
import { getDb, getSchema, closeDb } from "@/lib/infra/db";
import { getAuth } from "@/auth";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@nekusora.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change-me-on-first-login";
  const name = process.env.SEED_ADMIN_NAME ?? "Administrator";

  const db = await getDb();
  const auth = await getAuth();
  if (!auth) throw new Error("auth 初始化失败");

  const schema = getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userTable = (schema as any).user;

  const existing = await db.select().from(userTable).limit(1);
  if (existing.length > 0) {
    console.log(`[seed] 数据库已有用户(${existing.length} 个),跳过管理员创建。`);
    console.log(`[seed] 如需置管理员:UPDATE "user" SET role='admin' WHERE email='${email}'`);
    return;
  }

  console.log(`[seed] 创建管理员 ${email} ...`);
  await auth.api.signUpEmail({ body: { email, password, name } });

  // signUpEmail 后按 email 查回并置 admin。
  const [row] = await db.select().from(userTable).where(eq(userTable.email, email)).limit(1);
  if (!row) throw new Error("管理员账号创建后未能查回");

  await db
    .update(userTable)
    .set({ role: "admin", status: "active" })
    .where(eq(userTable.id, row.id));

  console.log(`[seed] ✅ 管理员创建成功:id=${row.id} email=${email} role=admin`);
  console.log(`[seed] 请尽快登录并修改密码。`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("[seed] 失败:", e);
    await closeDb();
    process.exit(1);
  });
