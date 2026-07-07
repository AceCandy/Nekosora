import { describe, expect, it } from "vitest";
import { resolveStructuredKind } from "./structured";

describe("resolveStructuredKind", () => {
  it("识别 chart / metric / table", () => {
    expect(resolveStructuredKind("chart")).toBe("chart");
    expect(resolveStructuredKind("metric")).toBe("metric");
    expect(resolveStructuredKind("table")).toBe("table");
  });

  it("大小写无关", () => {
    expect(resolveStructuredKind("CHART")).toBe("chart");
    expect(resolveStructuredKind("Table")).toBe("table");
  });

  it("非结构化语言返回 null（不与 html/svg/mermaid 预览冲突）", () => {
    expect(resolveStructuredKind("html")).toBeNull();
    expect(resolveStructuredKind("svg")).toBeNull();
    expect(resolveStructuredKind("mermaid")).toBeNull();
    expect(resolveStructuredKind("js")).toBeNull();
    expect(resolveStructuredKind("")).toBeNull();
  });
});
