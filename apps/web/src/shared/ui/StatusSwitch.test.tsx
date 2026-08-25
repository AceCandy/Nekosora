import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatusSwitch from "./StatusSwitch";

describe("StatusSwitch", () => {
  it("通过原生 switch 语义表达当前状态和切换动作", () => {
    const html = renderToStaticMarkup(
      <StatusSwitch checked label="禁用" type="submit" />,
    );

    expect(html).toContain('type="submit"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="禁用"');
    expect(html).toContain("touch-target");
  });
});
