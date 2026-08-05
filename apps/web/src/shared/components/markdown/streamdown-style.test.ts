import { describe, expect, it } from "vitest";
import { sanitizeHTMLStyle } from "./streamdown-style";

describe("sanitizeHTMLStyle color 纯黑/纯白 -> currentColor", () => {
  const mapped: Array<[string, string]> = [
    ["black", "currentColor"],
    ["white", "currentColor"],
    ["#000", "currentColor"],
    ["#000000", "currentColor"],
    ["#fff", "currentColor"],
    ["#ffffff", "currentColor"],
    ["#000000ff", "currentColor"],
    ["rgb(0, 0, 0)", "currentColor"],
    ["rgb(255,255,255)", "currentColor"],
    ["rgba(0, 0, 0, 1)", "currentColor"],
    ["hsl(0, 0%, 0%)", "currentColor"],
    ["hsl(200, 50%, 100%)", "currentColor"],
  ];
  for (const [input, expected] of mapped) {
    it(`color:${input} -> ${expected}`, () => {
      expect(sanitizeHTMLStyle({ color: input })?.color).toBe(expected);
    });
  }

  const kept = ["red", "#333", "rgb(0, 0, 128)", "rgba(0,0,0,0.5)", "hsl(120, 50%, 50%)", "currentColor"];
  for (const input of kept) {
    it(`color:${input} 原样保留`, () => {
      expect(sanitizeHTMLStyle({ color: input })?.color).toBe(input);
    });
  }

  it("无 color 属性原样返回同一对象", () => {
    const style = { background: "black", fontSize: 14 };
    expect(sanitizeHTMLStyle(style)).toBe(style);
  });

  it("color 映射时其他属性原样保留(background 不映射)", () => {
    const out = sanitizeHTMLStyle({ color: "black", background: "white", fontSize: 14 });
    expect(out?.color).toBe("currentColor");
    expect(out?.background).toBe("white");
    expect(out?.fontSize).toBe(14);
  });

  it("undefined 入参返回 undefined", () => {
    expect(sanitizeHTMLStyle(undefined)).toBeUndefined();
  });
});
