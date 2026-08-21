/**
 * storage.ts 冒烟测试 —— 验证 LocalDriver 的 put/get/delete 往返 +
 * driver 工厂选择(STORAGE_DRIVER 未配 → local;显式远端配置错误 → 报错)。
 *
 * 运行:pnpm tsx scripts/smoke/storage.smoke.ts
 *
 * 仅覆盖 LocalDriver(S3 需真实凭证,不在冒烟范围;S3Driver 的逻辑由
 * 单元测试或集成环境验证)。用临时目录隔离,测试结束清理。
 */
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getStorage,
  getStorageKind,
  resolveStorageKind,
  __resetStorageForTest,
} from "@/lib/infra/storage";
import { getEnvInfo } from "@/lib/infra/env";

async function run() {
  // 强制 Local 模式:清空 STORAGE_DRIVER + S3_* 并重置单例。
  (process.env as Record<string, string>).NODE_ENV = "development";
  delete (process.env as Record<string, string>).STORAGE_DRIVER;
  __resetStorageForTest();

  // 1. resolveStorageKind 配置解析
  assert.strictEqual(resolveStorageKind(), null, "未配 STORAGE_DRIVER 应返回 null");
  process.env.STORAGE_DRIVER = "r2";
  assert.strictEqual(resolveStorageKind(), "r2");
  process.env.STORAGE_DRIVER = "invalid";
  assert.throws(
    () => resolveStorageKind(),
    /STORAGE_DRIVER 仅允许 local、s3、r2 或 minio/,
    "非法值应被拒绝",
  );
  delete process.env.STORAGE_DRIVER;
  console.log("✓ resolveStorageKind 配置解析通过");

  // 2. env.ts 的 storageDriver 字段
  const env = getEnvInfo();
  assert.strictEqual(env.storageDriver, "local", "默认应为 local");
  console.log("✓ getEnvInfo().storageDriver 通过");

  // 3. 缺 S3 凭证时明确失败,不改写为 local
  process.env.STORAGE_DRIVER = "s3";
  // 故意不配 S3_BUCKET,触发 buildS3Driver 抛错。
  delete process.env.S3_BUCKET;
  __resetStorageForTest();
  await assert.rejects(
    () => getStorage(),
    /S3_BUCKET\/S3_ACCESS_KEY_ID\/S3_SECRET_ACCESS_KEY/,
    "S3 配置缺失应明确失败",
  );
  assert.strictEqual(getStorageKind(), "local");
  delete process.env.STORAGE_DRIVER;
  console.log("✓ S3 配置缺失明确失败通过");

  // 4. LocalDriver put/get/delete 往返(隔离临时目录)
  const tmpRoot = await mkdtemp(join(tmpdir(), "nekusora-storage-"));
  process.env.LOCAL_STORAGE_DIR = tmpRoot;
  __resetStorageForTest();
  const storage = await getStorage();
  assert.strictEqual(storage.kind, "local");
  assert.strictEqual(storage.publicReadable, false, "local 无公网直链");

  const key = "user-1/file-abc-notes.md";
  const payload = Buffer.from("# 标题\n中文内容 test 🔑", "utf-8");
  const result = await storage.put(key, payload, "text/markdown");
  assert.strictEqual(result.key, key);
  assert.strictEqual(result.size, payload.byteLength);
  assert.strictEqual(result.url, null, "local 的 url 应为 null");
  console.log("✓ put 通过");

  const got = await storage.get(key);
  assert.ok(got.equals(payload), "get 往返应与写入一致");
  console.log("✓ get 往返通过");

  // 5. signedUrl 在 local 下返回 null
  const signed = await storage.signedUrl(key, 3600);
  assert.strictEqual(signed, null);
  console.log("✓ local signedUrl 返回 null 通过");

  // 6. delete 后 get 应抛 ENOENT
  await storage.delete(key);
  await assert.rejects(() => storage.get(key), /ENOENT/i, "删除后 get 应抛 ENOENT");
  console.log("✓ delete 后 get 抛错通过");

  // 7. 删除不存在的 key 不抛错(幂等)
  await storage.delete(key);
  console.log("✓ delete 幂等通过(删不存在的 key 不抛错)");

  // 8. 向后兼容:绝对路径 key(LocalDriver 应直接读)
  // 模拟旧记录:storagePath 存的是绝对路径。
  const absKey = join(tmpRoot, "legacy.txt");
  await storage.put(absKey, Buffer.from("legacy"), "text/plain");
  const legacyGot = await storage.get(absKey);
  assert.strictEqual(legacyGot.toString("utf-8"), "legacy");
  console.log("✓ 绝对路径 key 向后兼容通过");

  // 清理临时目录
  await rm(tmpRoot, { recursive: true, force: true });
  delete process.env.LOCAL_STORAGE_DIR;
  __resetStorageForTest();

  console.log("\n全部通过 ✅(LocalDriver 模式)");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
