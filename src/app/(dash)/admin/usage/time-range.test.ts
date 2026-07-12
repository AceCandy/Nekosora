import { describe, it, expect } from "vitest";
import { resolveEffectiveUserId } from "./time-range";

/**
 * resolveEffectiveUserId 是用量查询合一后的数据隔离收敛点。
 * 语义:admin 空=查全部、选具体用户=查该用户;普通用户强制查自己(防越权)。
 */
describe("resolveEffectiveUserId", () => {
  const selfId = "u-self";

  it("admin 无 user 参数 → 查全部用户(undefined)", () => {
    expect(resolveEffectiveUserId({ isAdmin: true, selfId })).toBeUndefined();
  });

  it("admin user=<指定 id> → 查指定用户", () => {
    expect(
      resolveEffectiveUserId({ isAdmin: true, userParam: "u-other", selfId }),
    ).toBe("u-other");
  });

  it("普通用户强制查自己:忽略任意 userParam(防越权)", () => {
    expect(
      resolveEffectiveUserId({ isAdmin: false, userParam: "u-other", selfId }),
    ).toBe(selfId);
    expect(resolveEffectiveUserId({ isAdmin: false, selfId })).toBe(selfId);
  });
});
