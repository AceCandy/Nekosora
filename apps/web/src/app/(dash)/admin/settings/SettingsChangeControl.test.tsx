import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SettingsChange } from "@/lib/settings-control/changes";

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));

import SettingsChangeControl, { presentSettingsChanges } from "./SettingsChangeControl";

describe("presentSettingsChanges", () => {
  it("按领域归组并标记确定性的重点变更", () => {
    const changes: SettingsChange[] = [
      {
        resource: "system_setting",
        resourceKey: "gateway:chat_ua",
        before: { namespace: "gateway", key: "chat_ua", value: "old-agent" },
        after: { namespace: "gateway", key: "chat_ua", value: "new-agent" },
      },
      {
        resource: "output_mode",
        resourceKey: "output-mode:mode-1",
        before: null,
        after: {
          id: "mode-1",
          name: "Structured",
          description: null,
          systemPrompt: "Return structured output",
          icon: null,
          enabled: true,
          sortOrder: 0,
        },
      },
      {
        resource: "render_style",
        resourceKey: "render-style:style-1",
        before: {
          id: "style-1",
          name: "Custom",
          description: null,
          cssClass: "custom-style",
          css: ".custom-style { color: red; }",
          icon: null,
          renderer: "custom",
          builtin: false,
          enabled: true,
          sortOrder: 0,
        },
        after: null,
      },
      {
        resource: "system_setting",
        resourceKey: "gateway:request_governance_v1",
        before: { namespace: "gateway", key: "request_governance_v1", value: "{}" },
        after: {
          namespace: "gateway",
          key: "request_governance_v1",
          value: JSON.stringify({ key: { rpm: 100 }, user: { rpm: 200 }, note: "x".repeat(100) }),
        },
      },
    ];

    const groups = presentSettingsChanges(changes);

    expect(groups.map((group) => group.domain)).toEqual([
      "outputModes",
      "renderStyles",
      "governance",
      "protocol",
    ]);
    expect(groups[0]?.items[0]).toMatchObject({
      resourceName: "Structured",
      operation: "created",
      attention: false,
    });
    expect(groups[1]?.items[0]).toMatchObject({ operation: "deleted", attention: true });
    expect(groups[2]?.items[0]).toMatchObject({
      resourceLabelKey: "governancePolicy",
      operation: "updated",
      attention: true,
    });
    expect(groups[2]?.items[0]?.fields).toEqual([
      expect.objectContaining({ key: "value", long: true }),
    ]);
    expect(groups[3]?.items[0]).toMatchObject({
      resourceLabelKey: "gatewayChatUa",
      attention: false,
    });
  });
});

describe("SettingsChangeControl", () => {
  it("无草稿时只保留发布记录入口且不显示 revision", () => {
    const html = renderToStaticMarkup(<SettingsChangeControl draft={null} history={[]} />);

    expect(html).toContain("history");
    expect(html).not.toContain("currentRevision");
    expect(html).not.toContain("draftSummary");
    expect(html).not.toMatch(/r\d+/);
  });

  it("有草稿时显示轻量待发布状态和必要操作", () => {
    const change: SettingsChange = {
      resource: "system_setting",
      resourceKey: "gateway:chat_ua",
      before: { namespace: "gateway", key: "chat_ua", value: "old-agent" },
      after: { namespace: "gateway", key: "chat_ua", value: "new-agent" },
    };
    const html = renderToStaticMarkup(
      <SettingsChangeControl
        draft={{ id: "draft-1", kind: "edit", version: 1, changes: [change] }}
        history={[]}
      />,
    );

    expect(html).toContain("draftSummary");
    expect(html).toContain("draftPersisted");
    expect(html).toContain("reviewApply");
    expect(html).toContain("abandon");
    expect(html).toContain("history");
    expect(html).not.toContain("currentRevision");
  });
});
