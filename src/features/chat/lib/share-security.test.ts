import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createShareUnlockToken,
  fingerprintShareClient,
  getShareUnlockCookieName,
  hashSharePassword,
  verifySharePassword,
  verifyShareUnlockToken,
} from "./share-security";

describe("conversation share security", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-with-enough-entropy";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
  });

  it("使用随机盐 scrypt verifier 校验密码", async () => {
    const first = await hashSharePassword("correct horse battery staple");
    const second = await hashSharePassword("correct horse battery staple");

    expect(first).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
    expect(first).not.toBe(second);
    await expect(verifySharePassword("correct horse battery staple", first)).resolves.toBe(true);
    await expect(verifySharePassword("wrong password", first)).resolves.toBe(false);
    await expect(verifySharePassword("correct horse battery staple", "sha256$legacy")).resolves.toBe(false);
  });

  it("解锁票据绑定分享并以 24 小时为上限", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const { token, expiresAt } = createShareUnlockToken("share-1", null, now);

    expect(expiresAt.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(verifyShareUnlockToken(token, "share-1", now)).toBe(true);
    expect(verifyShareUnlockToken(token, "share-2", now)).toBe(false);
    expect(verifyShareUnlockToken(`${token}x`, "share-1", now)).toBe(false);
    expect(verifyShareUnlockToken(token, "share-1", expiresAt)).toBe(false);
  });

  it("票据到期不超过分享剩余有效期", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const shareExpiresAt = new Date("2026-07-27T02:00:00.000Z");
    const result = createShareUnlockToken("share-1", shareExpiresAt, now);

    expect(result.expiresAt).toEqual(shareExpiresAt);
  });

  it("Cookie 与来源指纹按分享安全域生成", () => {
    expect(getShareUnlockCookieName("share-1")).toBe("nekusora_share_unlock_share-1");
    expect(fingerprintShareClient("203.0.113.10")).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintShareClient("203.0.113.10")).not.toBe(fingerprintShareClient("203.0.113.11"));
  });
});
