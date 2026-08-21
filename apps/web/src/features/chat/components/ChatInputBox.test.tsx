import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh-CN.json";
import { ChatInputBox } from "./ChatInputBox";
import {
  ChatToolbar,
  ComposerPlusMenu,
  ModelControlMenu,
  RenderStyleMenu,
  type ChatToolbarProps,
} from "./ChatToolbar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => ({
    attachPreview: "预览附件",
    attachRemove: "移除附件",
    attachPending: "待发送",
    attachUploading: "上传中",
    attachError: "上传失败",
    placeholder: "输入消息",
    send: "发送",
    voicePlaceholder: "语音输入",
    uploadAttachment: "上传文件",
    outputMode: "输出模式",
    renderStyle: "输出样式",
    webSearch: "联网搜索",
  })[key] ?? key,
}));

const noop = () => {};

function collectElements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(collectElements)];
}

const toolbarProps: ChatToolbarProps = {
  models: [],
  model: "",
  onModelChange: noop,
  modelPickerOpen: false,
  onModelPickerToggle: noop,
  onModelPickerClose: noop,
  attached: [{
    id: "attachment-1",
    fileId: "file-1",
    filename: "screenshot-2026-07-28.png",
    file: { size: 2 * 1024 * 1024, type: "image/png" } as File,
    status: "uploaded",
    isImage: true,
    previewUrl: "blob:preview",
  }],
  onUploadFiles: noop,
  onRemoveAttachment: noop,
  onPreviewFile: noop,
  cards: [],
  selectedCardIds: [],
  onCardToggle: noop,
  outputModes: [],
  outputModeId: null,
  outputModePickerOpen: false,
  onOutputModePickerToggle: noop,
  onOutputModePickerClose: noop,
  onOutputModeToggle: noop,
  onOutputModeClear: noop,
  renderStyles: [],
  renderStyleId: null,
  renderStylePickerOpen: false,
  onRenderStylePickerToggle: noop,
  onRenderStylePickerClose: noop,
  onRenderStyleToggle: noop,
  onRenderStyleClear: noop,
  webSearchAvailable: false,
  webSearch: false,
  onWebSearchToggle: noop,
  reasoning: "off",
  onReasoningChange: noop,
};

describe("ChatInputBox attachments", () => {
  it("联网搜索控件在所有 locale 都有 chat 文案", () => {
    expect(zhMessages.chat.webSearch).toBe("联网搜索");
    expect(enMessages.chat.webSearch).toBe("Web Search");
  });

  it("renders attachment details inside the input surface before the textarea", () => {
    const html = renderToStaticMarkup(
      <ChatInputBox
        value=""
        onChange={noop}
        onSend={noop}
        disabled={false}
        onStop={noop}
        onPasteFiles={noop}
        onDropFiles={noop}
        topContent={<ChatToolbar {...toolbarProps} />}
      />,
    );

    expect(html).toContain("screenshot-2026-07-28.png");
    expect(html).toContain("PNG · 2.0 MB");
    expect(html).toContain('aria-label="移除附件"');
    expect(html.indexOf("screenshot-2026-07-28.png")).toBeLessThan(html.indexOf("<textarea"));
  });

  it("uses the original MIME when a pasted image has no filename extension", () => {
    const onPreviewFile = vi.fn();
    const root = ChatToolbar({
      ...toolbarProps,
      attached: [{
        ...toolbarProps.attached[0],
        filename: "clipboard-image",
        file: { size: 1024, type: "image/png" } as File,
      }],
      onPreviewFile,
    });
    const previewButton = collectElements(root).find((element) =>
      element.type === "button" && element.props.title === "预览附件");

    (previewButton?.props.onClick as (() => void) | undefined)?.();

    expect(previewButton).toBeDefined();
    expect(onPreviewFile).toHaveBeenCalledWith({
      fileId: "file-1",
      filename: "clipboard-image",
      mime: "image/png",
    });
  });

  it("keeps pending, uploading, and failed attachment states visible", () => {
    const html = renderToStaticMarkup(
      <ChatToolbar
        {...toolbarProps}
        attached={[
          { id: "pending", filename: "pending.png", status: "pending" },
          { id: "uploading", filename: "uploading.png", status: "uploading" },
          { id: "error", filename: "error.png", status: "error" },
        ]}
      />,
    );

    expect(html).toContain("PNG · 待发送");
    expect(html).toContain("PNG · 上传中");
    expect(html).toContain("PNG · 上传失败");
  });
});

describe("RenderStyleMenu", () => {
  it("renders only the output style icon in the conversation header", () => {
    const html = renderToStaticMarkup(
      <RenderStyleMenu
        {...toolbarProps}
        outputModes={[{ id: "mode-html", name: "HTML" }]}
        renderStyles={[{ id: "style-default", name: "默认", cssClass: "default", renderer: "streamdown" }]}
      />,
    );

    expect(html).toContain('aria-label="输出样式"');
    expect(html).toContain('title="输出样式"');
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("HTML");
  });
});

describe("composer controls", () => {
  it("keeps the plus button and file selector without the previous option entries", () => {
    const html = renderToStaticMarkup(
      <ComposerPlusMenu
        {...toolbarProps}
        cards={[{ id: "card-1", title: "指令卡", trigger: "card" }]}
        outputModes={[{ id: "mode-html", name: "HTML" }]}
      />,
    );

    expect(html).toContain('aria-label="更多设置"');
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple=""');
    expect(html).not.toContain("指令卡");
    expect(html).not.toContain("HTML");
  });

  it("renders the output mode icon before web search and hides search when unavailable", () => {
    const availableHtml = renderToStaticMarkup(
      <ModelControlMenu
        {...toolbarProps}
        outputModes={[{ id: "mode-html", name: "HTML" }]}
        outputModeId="mode-html"
        webSearchAvailable
        webSearch
      />,
    );
    const unavailableHtml = renderToStaticMarkup(
      <ModelControlMenu
        {...toolbarProps}
        outputModes={[{ id: "mode-html", name: "HTML" }]}
      />,
    );

    expect(availableHtml).toContain('aria-label="输出模式"');
    expect(availableHtml).toContain('title="输出模式"');
    expect(availableHtml).not.toContain("HTML");
    expect(availableHtml.indexOf('aria-label="输出模式"')).toBeLessThan(
      availableHtml.indexOf('aria-label="联网搜索"'),
    );
    expect(unavailableHtml).not.toContain('aria-label="联网搜索"');
  });
});
