import { describe, expect, it } from "vitest";
import { GATEWAY_PROXY_ROUTES } from "@nekusora/contracts/routes";
import { buildGatewayRewrites } from "./gateway-rewrites";

describe("Gateway rewrites", () => {
  it("未配置内部地址时保留 Web 原路由作为回滚路径", () => {
    expect(buildGatewayRewrites(undefined)).toEqual([]);
    expect(buildGatewayRewrites("")).toEqual([]);
  });

  it("在 beforeFiles 中代理完整矩阵并保留公开路径", () => {
    const rewrites = buildGatewayRewrites("http://gateway.internal:4000///");
    expect(rewrites).not.toEqual([]);
    if (Array.isArray(rewrites)) throw new Error("rewrites unexpectedly disabled");

    expect(rewrites.beforeFiles).toEqual(
      GATEWAY_PROXY_ROUTES.map((source) => ({
        source,
        destination: `http://gateway.internal:4000${source}`,
      })),
    );
    expect(rewrites.afterFiles).toEqual([]);
    expect(rewrites.fallback).toEqual([]);
  });
});
