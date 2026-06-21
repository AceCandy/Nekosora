/**
 * crypto.ts 冒烟测试 —— 验证 AES-256-GCM 加解密往返 + 认证失败检测。
 * 运行:pnpm tsx scripts/smoke/crypto.smoke.ts
 */
import assert from "node:assert";
import { decrypt, encrypt, hashSecret, safeEqual } from "@/lib/infra/crypto";

// 测试环境:dev + 使用一个固定的非弱 key(避开生产弱 key 拦截)。
(process.env as Record<string, string>).NODE_ENV = "development";
process.env.DATA_ENCRYPTION_KEY = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

function run() {
  // 1. 加解密往返
  const cases = ["", "sk-abc123", "中文密钥测试 🔑", "a".repeat(1000)];
  for (const c of cases) {
    const enc = encrypt(c);
    assert.notStrictEqual(enc, c, "密文不应等于明文");
    assert.strictEqual(decrypt(enc), c, "解密结果应等于明文");
  }
  console.log("✓ 加解密往返(空/ASCII/Unicode/长串)通过");

  // 2. 相同明文每次密文不同(IV 随机)
  const a = encrypt("same");
  const b = encrypt("same");
  assert.notStrictEqual(a, b, "随机 IV 应使密文不同");
  assert.strictEqual(decrypt(a), decrypt(b));
  console.log("✓ 随机 IV 通过(同明文不同密文)");

  // 3. 篡改密文 → 认证失败
  const enc = encrypt("secret");
  const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-1);
  assert.throws(() => decrypt(tampered), /auth|unsupported|length/i, "篡改密文应抛错");
  console.log("✓ 篡改检测通过(GCM 认证)");

  // 4. hashSecret 稳定 + safeEqual
  const h1 = hashSecret("sk-test");
  const h2 = hashSecret("sk-test");
  assert.strictEqual(h1, h2);
  assert.strictEqual(h1.length, 64);
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  console.log("✓ hashSecret + safeEqual 通过");

  console.log("\n全部通过 ✅");
}

run();
