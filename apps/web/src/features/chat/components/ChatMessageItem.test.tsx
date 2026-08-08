import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/features/chat/actions/feedback", () => ({
  setMessageFeedback: vi.fn(),
}));

vi.mock("@/shared/components/markdown/Markdown", () => ({
  Markdown: () => null,
}));

vi.mock("@/shared/lib/useClickOutside", () => ({
  useClickOutside: vi.fn(),
}));

import { ChatMessageItem, MessageRunMetadataDisplay } from "./ChatMessageItem";
import { MessageProcessTrace } from "./MessageProcessTrace";
import type { MessageRunMetadata } from "@/features/chat/model/types";
import { formatDateTimeLocal } from "@/shared/lib/format";

function renderMetadata(metadata: MessageRunMetadata, expanded = false) {
  return renderToStaticMarkup(
    <MessageRunMetadataDisplay
      metadata={metadata}
      expanded={expanded}
      panelId="run-metadata-test"
    />,
  );
}

function renderAssistantMessage(metadata: MessageRunMetadata) {
  return renderToStaticMarkup(
    <ChatMessageItem
      message={{
        role: "assistant",
        content: "Answer",
        publicId: "assistant-1",
        status: "success",
        runMetadata: metadata,
      }}
      isLast
      isStreaming={false}
      model="model-a"
      onRegenerate={() => undefined}
      onOpenArtifact={() => undefined}
    />,
  );
}

describe("MessageRunMetadataDisplay", () => {
  it("按固定顺序展示可用字段并保留真实零值", () => {
    const model = "model-with-a-very-long-platform-display-name-that-must-not-overflow";
    const html = renderMetadata({
      model,
      tokenUsage: {
        promptTokens: 1_234,
        cacheReadTokens: 0,
        reasoningTokens: 56,
        completionTokens: 0,
      },
      durationMs: 0,
      completedAt: "2026-07-25T00:00:02.000Z",
    });

    const labels = [
      "responseModel",
      "inputTokens",
      "cacheReadTokens",
      "outputTokens",
      "responseDuration",
    ];
    let previousIndex = -1;
    for (const label of labels) {
      const index = html.indexOf(label);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(html).toContain("1,234");
    expect(html).toContain("0ms");
    expect(html).not.toContain("reasoningTokens");
    expect(html).toContain(`title="${model}"`);
    expect(html).toContain("max-w-[min(18rem,60vw)] truncate");
    expect(html).not.toContain("completedAt");
  });

  it("隐藏未知字段且不把缺失值伪装为零", () => {
    const html = renderMetadata({
      model: "Model A",
      tokenUsage: { completionTokens: 0 },
    });

    expect(html).toContain("responseModel");
    expect(html).toContain("outputTokens");
    expect(html).not.toContain("inputTokens");
    expect(html).not.toContain("cacheReadTokens");
    expect(html).not.toContain("reasoningTokens");
    expect(html).not.toContain("responseDuration");
    expect(html).not.toContain("completedAt");
    expect(html).toMatch(/outputTokens<\/span><\/dt><dd[^>]*>0<\/dd>/);
    expect(renderMetadata({})).toBe("");
    expect(renderMetadata({ completedAt: "2026-07-25T00:00:02.000Z" })).toBe("");
    expect(renderMetadata({ tokenUsage: { reasoningTokens: 56 } })).toBe("");

    const assistantHtml = renderAssistantMessage({
      tokenUsage: { reasoningTokens: 56 },
      completedAt: "2026-07-25T00:00:02.000Z",
    });
    expect(assistantHtml).not.toContain('aria-label="responseDetails"');
  });

  it("仅在粗指针展开时渲染详情面板", () => {
    const collapsed = renderMetadata({ model: "Model A" });
    const expanded = renderMetadata({ model: "Model A" }, true);

    expect(collapsed).toContain("[@media(pointer:coarse)]:hidden");
    expect(collapsed).not.toContain('role="region"');
    expect(expanded).toContain('role="region"');
    expect(expanded).toContain('id="run-metadata-test"');
    expect(expanded).toContain("[@media(pointer:coarse)]:block");
  });

  it("将操作与时间放在详情前，并让两排共同 hover、focus 与粗指针显隐", () => {
    const completedAt = "2026-07-25T00:00:02.000Z";
    const html = renderAssistantMessage({
      model: "Model A",
      tokenUsage: { promptTokens: 12, completionTokens: 34 },
      durationMs: 560,
      completedAt,
    });

    expect(html.indexOf('aria-label="copy"')).toBeLessThan(html.indexOf('aria-label="feedbackUp"'));
    expect(html.indexOf('aria-label="regenerate"')).toBeLessThan(html.indexOf("<time"));
    expect(html.indexOf("<time")).toBeLessThan(html.indexOf("responseModel"));
    expect(html).not.toContain("<span>copy</span>");
    expect(html).not.toContain("<span>regenerate</span>");
    expect(html).toMatch(/<button[^>]*title="copy"[^>]*aria-label="copy"[^>]*><svg/);
    expect(html).toMatch(/<button[^>]*title="regenerate"[^>]*aria-label="regenerate"[^>]*><svg/);
    expect(html).not.toContain("completedAt");
    expect(html).toContain(`dateTime="${completedAt}"`);
    expect(html).toContain(`>${formatDateTimeLocal(completedAt)}</time>`);
    expect(html).toContain("font-mono text-ui-body tabular-nums");
    expect(html).toContain("size-2.5");
    expect(html).toContain("text-space-ink/55 dark:text-nebula-silver/55");
    const timeEndIndex = html.indexOf("</time>") + "</time>".length;
    expect(html.slice(timeEndIndex)).toMatch(/^<\/div>/);
    expect(html).toContain(
      "flex min-w-0 max-w-full flex-col items-start gap-1 opacity-0 pointer-events-none",
    );
    expect(html).toContain("group-hover/message:pointer-events-auto");
    expect(html).toContain("group-hover/message:opacity-100");
    expect(html).toContain("group-focus-within/message:pointer-events-auto");
    expect(html).toContain("group-focus-within/message:opacity-100");
    expect(html).toContain("[@media(pointer:coarse)]:pointer-events-auto");
    expect(html).toContain("[@media(pointer:coarse)]:opacity-100");
    expect(html).toContain("touch-target hidden h-8 w-8");
    expect(html).toContain("[@media(pointer:coarse)]:inline-flex");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="run-metadata-[^"]+"/);

    const timeOnlyHtml = renderAssistantMessage({
      completedAt: "2026-07-25T00:00:02.000Z",
    });
    expect(timeOnlyHtml).toContain("<time");
    expect(timeOnlyHtml).not.toContain("aria-controls");
    expect(timeOnlyHtml).not.toContain('aria-label="responseDetails"');
    expect(timeOnlyHtml).not.toContain('role="region"');
  });
});

describe("ChatMessageItem research process", () => {
  it("完成后折叠为研究摘要并隐藏内部实现步骤", () => {
    const html = renderToStaticMarkup(
      <MessageProcessTrace
        content="Answer"
        processTrace={{
          version: 1,
          runs: [{
            runId: "run-1",
            phase: "completed",
            startedAt: "2026-08-07T00:00:00.000Z",
            endedAt: "2026-08-07T00:00:04.200Z",
            steps: [
              { id: "memory", kind: "memory", status: "completed" },
              {
                id: "prompt",
                kind: "prompt",
                status: "completed",
                data: { fullMessageCount: 2, sentMessageCount: 2, tokenEstimate: 20 },
              },
            ],
          }],
        }}
        isStreaming={false}
        isLast
      />,
    );

    expect(html).toContain("researchCompleted · researchDuration");
    expect(html).not.toContain("research-status-shimmer");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="_R_[^"]+_"/);
    expect(html).toContain("border-0 bg-transparent");
    expect(html).not.toContain("researchStepContext");
    expect(html).not.toContain("researchStepAnswer");
    expect(html).not.toContain("processStepPrompt");
    expect(html).not.toContain("tokenEstimate");
    expect(html).not.toContain("<details");
    expect(html).toContain("min-h-11");
  });

  it("运行中只突出当前搜索，详情使用语义步骤且不暴露推理与工具参数", () => {
    const html = renderToStaticMarkup(
      <MessageProcessTrace
        content=""
        reasoning="PRIVATE_CHAIN_OF_THOUGHT"
        toolCalls={[{
          toolCallId: "search-1",
          toolName: "web_search",
          status: "calling",
          args: { query: "latest", secret: "TOOL_SECRET" },
        }]}
        searchResults={[{ title: "Source", url: "https://www.example.com/report", snippet: "Reliable report" }]}
        isStreaming
        isLast
      />,
    );

    expect(html).toContain('aria-label="processTrace"');
    expect(html).toContain("researchRunningSearch");
    expect(html).toContain("latest");
    expect(html).toContain("research-status-shimmer");
    expect(html).not.toContain("researchDetails");
    expect(html).not.toContain("researchCollapse");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("researchStepReasoning");
    expect(html).not.toContain("researchStepSearch");
    expect(html).not.toContain("researchViewSources");
    expect(html).not.toContain("example.com");
    expect(html).not.toContain("PRIVATE_CHAIN_OF_THOUGHT");
    expect(html).not.toContain("TOOL_SECRET");
    expect(html).not.toContain("tool_call");
  });

  it("首个正文 token 前将研究状态收敛为完成", () => {
    const html = renderToStaticMarkup(
      <MessageProcessTrace
        content="正文已开始"
        searchResults={[{ title: "Source", url: "https://example.com/report" }]}
        processRuntime={{
          runId: "run-answering",
          lastSeq: 5,
          phase: "answering",
          steps: [{ id: "search", kind: "web_search", status: "completed" }],
          startedAt: "2026-08-08T00:00:00.000Z",
          firstContentAt: "2026-08-08T00:00:01.500Z",
        }}
        isStreaming
        isLast
      />,
    );

    expect(html).toContain("researchCompleted · researchSourceCount · researchDuration");
    expect(html).not.toContain("researchRunningRead");
    expect(html).not.toContain("research-status-shimmer");
  });

  it("流式空正文只显示研究状态，不重复显示思考中", () => {
    const html = renderToStaticMarkup(
      <ChatMessageItem
        message={{
          role: "assistant",
          content: "",
          publicId: "assistant-streaming",
        }}
        isLast
        isStreaming
        model="model-a"
        onRegenerate={() => undefined}
        onOpenArtifact={() => undefined}
      />,
    );

    expect(html).toContain("researchRunningUnderstand");
    expect(html).not.toContain("thinking");
    expect(html).not.toContain("animate-spin");
  });

  it("搜索部分失败时只显示轻量 warning，不显示 provider 调试路径", () => {
    const html = renderToStaticMarkup(
      <ChatMessageItem
        message={{
          role: "assistant",
          content: "Answer",
          publicId: "assistant-search-1",
          status: "success",
          toolCalls: [
            {
              toolCallId: "search-failed",
              toolName: "web_search",
              status: "error",
              args: { query: "latest" },
              statusDetail: "模型搜索不支持指定时间范围",
              searchAttempts: [
                {
                  backend: { type: "provider", id: "tavily", name: "Tavily" },
                  outcome: "failed",
                },
                {
                  backend: { type: "model", id: "gpt", name: "GPT" },
                  outcome: "skipped_after_timeout",
                },
                {
                  backend: { type: "current-model", name: "Current model" },
                  outcome: "unsupported",
                },
              ],
            },
            {
              toolCallId: "search-tavily",
              toolName: "web_search",
              status: "done",
              args: { query: "follow-up" },
              searchBackend: { type: "provider", id: "tavily", name: "Tavily" },
              searchAttempts: [{
                backend: { type: "provider", id: "tavily", name: "Tavily" },
                outcome: "success",
              }],
            },
            {
              toolCallId: "search-model",
              toolName: "web_search",
              status: "done",
              args: { query: "verify" },
              searchBackend: { type: "model", id: "grok", name: "Grok" },
            },
            {
              toolCallId: "search-invalid",
              toolName: "web_search",
              status: "error",
              args: { query: "" },
              statusDetail: "搜索查询无效",
            },
          ],
          searchBackends: [
            { type: "provider", id: "tavily", name: "Tavily" },
            { type: "model", id: "grok", name: "Grok" },
          ],
          searchResults: [{ title: "Source", url: "https://example.com" }],
        }}
        isLast
        isStreaming={false}
        model="model-a"
        onRegenerate={() => undefined}
        onOpenArtifact={() => undefined}
      />,
    );

    expect(html).toContain("researchCompleted");
    expect(html).not.toContain("researchPartialSources");
    expect(html).not.toContain("researchStepSearch");
    expect(html).not.toContain("researchStepRead");
    expect(html).not.toContain("Tavily");
    expect(html).not.toContain("Current model");
    expect(html).not.toContain("搜索查询无效");
    expect(html).not.toContain("researchViewSources");
  });
});

describe("ChatMessageItem 用户图片", () => {
  it("图片位于文字之前且仅图片消息不渲染空文本气泡", () => {
    const withText = renderToStaticMarkup(
      <ChatMessageItem
        message={{
          role: "user",
          content: "caption",
          publicId: "user-1",
          attachments: [{ fileId: "image-1", filename: "photo.png", mime: "image/png" }],
        }}
        isLast
        isStreaming={false}
        model="model-a"
        onRegenerate={() => undefined}
        onOpenArtifact={() => undefined}
        onEdit={() => undefined}
        onRequestDelete={() => undefined}
      />,
    );
    const imageIndex = withText.indexOf('/api/files/image-1');
    const actionAnchorIndex = withText.indexOf('class="group relative w-fit max-w-full"');
    expect(imageIndex).toBeLessThan(actionAnchorIndex);
    expect(actionAnchorIndex).toBeLessThan(withText.indexOf("caption"));
    expect(withText).toContain('aria-label="edit"');
    expect(withText).toContain('aria-label="delete"');
    expect(withText).toContain("w-fit max-w-full");
    expect(withText).toContain("max-w-[88%]");
    expect(withText).toContain("sm:max-w-[70%]");

    const imageOnly = renderToStaticMarkup(
      <ChatMessageItem
        message={{
          role: "user",
          content: "",
          publicId: "user-2",
          attachments: [{ fileId: "image-1", filename: "photo.png", mime: "image/png" }],
        }}
        isLast
        isStreaming={false}
        model="model-a"
        onRegenerate={() => undefined}
        onOpenArtifact={() => undefined}
        onEdit={() => undefined}
        onRequestDelete={() => undefined}
      />,
    );
    expect(imageOnly).toContain('/api/files/image-1');
    expect(imageOnly).toContain('aria-label="edit"');
    expect(imageOnly).toContain('aria-label="delete"');
    expect(imageOnly).not.toContain("overflow-hidden whitespace-pre-wrap");
  });
});
