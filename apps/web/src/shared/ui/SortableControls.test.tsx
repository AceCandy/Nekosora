import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SortableControls, { moveItemToTop } from "./SortableControls";

const attributes = {
  role: "button",
  tabIndex: 0,
  "aria-disabled": false,
  "aria-pressed": undefined,
  "aria-roledescription": "sortable",
  "aria-describedby": "sortable-description",
};

describe("SortableControls", () => {
  it("提供统一拖拽与移到顶部操作", () => {
    const html = renderToStaticMarkup(
      <SortableControls
        attributes={attributes}
        listeners={undefined}
        dragLabel="拖动排序"
        moveToTopLabel="移到顶部"
        canMoveToTop
        onMoveToTop={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="拖动排序"');
    expect(html).toContain('aria-label="移到顶部"');
    expect(html).toContain('title="移到顶部"');
  });

  it("首项隐藏且禁用移到顶部操作", () => {
    const html = renderToStaticMarkup(
      <SortableControls
        attributes={attributes}
        listeners={undefined}
        dragLabel="拖动排序"
        moveToTopLabel="移到顶部"
        canMoveToTop={false}
        onMoveToTop={vi.fn()}
      />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("invisible");
  });

  it("只把有效的非首项移动到顶部", () => {
    const items = ["a", "b", "c"];

    expect(moveItemToTop(items, 2)).toEqual(["c", "a", "b"]);
    expect(moveItemToTop(items, 0)).toBe(items);
    expect(moveItemToTop(items, -1)).toBe(items);
  });
});
