import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelControlMenu, type ChatToolbarProps } from "./ChatToolbar";

let panel: React.ReactNode;
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/shared/ui/Popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => { panel = children; return children; },
}));
const noop = () => {};
const props: ChatToolbarProps = {
  models: [
    { modelId: "a", name: "Alpha", source: "global", capabilities: { vision: true, reasoning: true, thinkingFormat: "anthropic" } },
    { modelId: "b", name: "Beta", source: "byo", capabilities: { tools: true } },
  ],
  model: "a", onModelChange: noop, modelPickerOpen: true, onModelPickerToggle: noop, onModelPickerClose: noop,
  attached: [], onUploadFiles: noop, onRemoveAttachment: noop, onPreviewFile: noop,
  cards: [], selectedCardIds: [], onCardToggle: noop,
  outputModes: [], outputModeId: null, outputModePickerOpen: false, onOutputModePickerToggle: noop, onOutputModePickerClose: noop, onOutputModeToggle: noop, onOutputModeClear: noop,
  renderStyles: [], renderStyleId: null, renderStylePickerOpen: false, onRenderStylePickerToggle: noop, onRenderStylePickerClose: noop, onRenderStyleToggle: noop, onRenderStyleClear: noop,
  webSearchAvailable: false, webSearch: false, onWebSearchToggle: noop, reasoning: "off", onReasoningChange: noop,
};

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}

afterEach(() => vi.unstubAllGlobals());

describe("模型选择", () => {
  it("按真实来源分组，能力由目录提供，档位使用离散控件", () => {
    const html = renderToStaticMarkup(<ModelControlMenu {...props} />);
    expect(html).toContain('role="group" aria-label="globalLabel"');
    expect(html).toContain('role="group" aria-label="personalModels"');
    expect(html).toContain("modelVision");
    expect(html).toContain("modelTools");
    expect(html).toContain('type="range"');
    expect(html).toContain('step="1"');
    expect(html).not.toContain('reasoningHelp');
  });

  it("上下方向键与首尾键只移动焦点，Enter 的点击才选择模型", () => {
    const onModelChange = vi.fn();
    renderToStaticMarkup(<ModelControlMenu {...props} onModelChange={onModelChange} />);
    const list = elements(panel).find((el) => el.props.role === "listbox")!;
    const doc = { activeElement: null as unknown };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("HTMLInputElement", class {});
    const options = [0, 1].map(() => ({ focus() { doc.activeElement = this; } }));
    (list.props.ref as { current: unknown }).current = { querySelectorAll: () => options };
    const keyDown = list.props.onKeyDown as (event: unknown) => void;
    const key = (key: string) => keyDown({ key, target: options[0], preventDefault: noop });
    key("ArrowDown"); expect(doc.activeElement).toBe(options[0]);
    key("ArrowDown"); expect(doc.activeElement).toBe(options[1]);
    key("ArrowDown"); expect(doc.activeElement).toBe(options[0]);
    key("ArrowUp"); expect(doc.activeElement).toBe(options[1]);
    key("Home"); expect(doc.activeElement).toBe(options[0]);
    key("End"); expect(doc.activeElement).toBe(options[1]);
    expect(onModelChange).not.toHaveBeenCalled();
    const option = elements(panel).find((el) => el.props.role === "option")!;
    (option.props.onClick as () => void)();
    expect(onModelChange).toHaveBeenCalledWith("a");
  });

  it("无推理模型不显示档位，固定推理不可关闭", () => {
    const noReasoning = renderToStaticMarkup(<ModelControlMenu {...props} model="b" />);
    expect(noReasoning).not.toContain('type="range"');
    const fixed = renderToStaticMarkup(<ModelControlMenu {...props} models={[{ modelId: "a", name: "Fixed", capabilities: { reasoning: true, thinkingFormat: "fixed", thinkingLevelMap: { low: "enabled" } } }]} />);
    expect(fixed).toContain("reasoningFixedShort");
    expect(fixed).not.toContain('type="range"');
  });

  it("滑动索引映射到目录档位，不生成不存在的中间档", () => {
    const onReasoningChange = vi.fn();
    renderToStaticMarkup(<ModelControlMenu {...props} onReasoningChange={onReasoningChange} models={[{ modelId: "a", name: "Toggle", capabilities: { reasoning: true, thinkingFormat: "deepseek", thinkingLevelMap: { minimal: null, low: null, medium: null } } }]} />);
    const slider = elements(panel).find((el) => el.props.type === "range")!;
    expect(slider.props.max).toBe(1);
    (slider.props.onChange as (event: unknown) => void)({ target: { value: "1" } });
    expect(onReasoningChange).toHaveBeenCalledWith("high");
  });
});
