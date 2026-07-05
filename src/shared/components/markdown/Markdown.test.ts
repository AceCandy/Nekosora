import { describe, expect, it } from "vitest";
import { MARKDOWN_CONTROLS } from "./markdownControls";

describe("Markdown code block controls", () => {
  it("禁用 Streamdown 原生代码块 actions,由 Nekosora 自定义紧凑按钮接管", () => {
    expect(MARKDOWN_CONTROLS).toMatchObject({
      table: false,
      code: false,
    });
  });
});
