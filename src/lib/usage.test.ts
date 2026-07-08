import { describe, it, expect } from "vitest";
import { maskKey } from "@/lib/usage";

describe("maskKey", () => {
  it("空值返回 null(绝不存明文)", () => {
    expect(maskKey(undefined)).toBeNull();
    expect(maskKey(null)).toBeNull();
    expect(maskKey("")).toBeNull();
  });

  it("长 key 取前3后3,中间用 * 连接", () => {
    expect(maskKey("sk-abcdefxyz123")).toBe("sk-***123");
  });

  it("恰好 7 位也走长 key 分支(前3后3)", () => {
    expect(maskKey("abcdefg")).toBe("abc***efg");
  });

  it("短 key(length <= 6)兜底:前2 + ***,不暴露全量", () => {
    expect(maskKey("abcdef")).toBe("ab***");
    expect(maskKey("abc")).toBe("ab***");
    expect(maskKey("ab")).toBe("ab***");
  });

  it("典型 OpenAI 风格 key 脱敏正确", () => {
    expect(maskKey("sk-proj-TzX4m9Q8s2Kp7vR3")).toBe("sk-***vR3");
  });
});
