import { describe, expect, it } from "vitest";
import { isPublicIp, resolvePublicHttpUrl } from "./public-http";

describe("SearXNG 公网地址校验", () => {
  it.each([
    "127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254",
    "172.16.0.1", "192.168.1.1", "::1", "fc00::1", "fe80::1",
  ])("拒绝非公网 IP: %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])(
    "接受公网 IP: %s",
    (address) => expect(isPublicIp(address)).toBe(true),
  );

  it.each([
    "http://localhost:8080",
    "http://searxng:8080",
    "http://service.local",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])("拒绝本地或非法地址: %s", async (url) => {
    await expect(resolvePublicHttpUrl(url)).rejects.toThrow();
  });

  it("任一 DNS 结果为私网时拒绝，避免地址轮换绕过", async () => {
    await expect(resolvePublicHttpUrl("https://search.example.com", async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])).rejects.toThrow("非公网 IP");
  });

  it("返回实际已校验的连接地址", async () => {
    await expect(resolvePublicHttpUrl("https://search.example.com", async () => [
      { address: "1.1.1.1", family: 4 },
    ])).resolves.toMatchObject({
      url: expect.objectContaining({ hostname: "search.example.com" }),
      address: { address: "1.1.1.1", family: 4 },
    });
  });
});
