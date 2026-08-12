import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh-CN.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  closestCenter: () => null,
  PointerSensor: class PointerSensor {},
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: () => null,
  arrayMove: (items: string[]) => items,
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

import RenderStyleFormDialog from "./RenderStyleFormDialog";
import RenderStylesManager from "./RenderStylesManager";

const formAction = vi.fn<(formData: FormData) => void>();
const buttonAction = vi.fn<() => void>();
const noop = () => {};

const baseStyle = {
  id: "style-1",
  name: "Paper",
  description: "Editorial style",
  cssClass: "paper",
  css: ".rs-paper .nekusora-md { color: black; }",
  icon: null,
  renderer: "streamdown" as const,
  builtin: false,
  enabled: true,
  sortOrder: 0,
};

function renderManager(renderer: "streamdown" | "custom") {
  const style = { ...baseStyle, renderer };
  return renderToStaticMarkup(
    <RenderStylesManager
      styles={[style]}
      createAction={formAction}
      updateActions={{ [style.id]: formAction }}
      toggleActions={{ [style.id]: buttonAction }}
      deleteActions={{ [style.id]: buttonAction }}
      reorderAction={noop}
    />,
  );
}

describe("render style trust warning", () => {
  it("在 custom 样式列表中持续显示高信任标识", () => {
    const html = renderManager("custom");

    expect(html).toContain("customRendererBadge");
    expect(html).toContain('title="customRendererBadgeTitle"');
  });

  it("不为 streamdown 样式显示 custom 风险标识", () => {
    const html = renderManager("streamdown");

    expect(html).not.toContain("customRendererBadge");
    expect(html).not.toContain("customRendererBadgeTitle");
  });

  it("仅在编辑 custom 样式时显示非阻断提醒", () => {
    const customHtml = renderToStaticMarkup(
      <RenderStyleFormDialog
        open
        mode="edit"
        onClose={noop}
        action={formAction}
        initial={{ ...baseStyle, renderer: "custom" }}
      />,
    );
    const streamdownHtml = renderToStaticMarkup(
      <RenderStyleFormDialog
        open
        mode="edit"
        onClose={noop}
        action={formAction}
        initial={baseStyle}
      />,
    );

    expect(customHtml).toContain('role="note"');
    expect(customHtml).toContain("customRendererWarning");
    expect(customHtml).toContain('type="submit"');
    expect(streamdownHtml).not.toContain("customRendererWarning");
  });

  it("中英文目录同步提供风险说明", () => {
    const zh = zhMessages.admin.renderStyles as Record<string, string>;
    const en = enMessages.admin.renderStyles as Record<string, string>;

    expect(zh.customRendererBadge).toBe("高信任渲染");
    expect(en.customRendererBadge).toBe("High-trust rendering");
    expect(zh.customRendererWarning).toContain("公开分享");
    expect(en.customRendererWarning).toContain("public shares");
  });
});
