import { describe, expect, it } from "vitest";
import { MARKDOWN_CONTROLS, shouldCollapseCodeBlock } from "./markdownControls";

describe("Markdown code block controls", () => {
  it("禁用 Streamdown 原生代码块 actions,由 Nekosora 自定义紧凑按钮接管", () => {
    expect(MARKDOWN_CONTROLS).toMatchObject({
      table: false,
      code: false,
    });
  });

  it("流式期间保持长代码展开,结束后才允许折叠", () => {
    expect(shouldCollapseCodeBlock(17, true)).toBe(false);
    expect(shouldCollapseCodeBlock(17, false)).toBe(true);
    expect(shouldCollapseCodeBlock(16, false)).toBe(false);
  });
});
