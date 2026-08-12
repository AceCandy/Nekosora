import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../../../messages/en.json";
import zhMessages from "../../../../../messages/zh-CN.json";
import {
  DEFAULT_GATEWAY_GOVERNANCE_POLICY,
  GATEWAY_GOVERNANCE_POLICY_BOUNDS,
} from "@/lib/gateway-governance/policy";
import GovernanceSettingsForm from "./GovernanceSettingsForm";
import type { GovernanceSettingsActionState } from "./governance-actions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const action = async (): Promise<GovernanceSettingsActionState> => ({
  status: "success",
  error: null,
});

describe("GovernanceSettingsForm", () => {
  it("回显推荐策略并为全部字段声明原生整数边界", () => {
    const html = renderToStaticMarkup(
      <GovernanceSettingsForm
        policy={DEFAULT_GATEWAY_GOVERNANCE_POLICY}
        bounds={GATEWAY_GOVERNANCE_POLICY_BOUNDS}
        action={action}
      />,
    );

    const expected = [
      ["key_rpm", "120", "1000000"],
      ["user_rpm", "600", "1000000"],
      ["key_burst", "30", "1000000"],
      ["user_burst", "120", "1000000"],
      ["key_concurrency", "8", "100000"],
      ["user_concurrency", "32", "100000"],
      ["key_chat_tokens_per_month", "10000000", "1000000000000"],
      ["user_chat_tokens_per_month", "50000000", "1000000000000"],
      ["key_image_count_per_month", "1000", "1000000000000"],
      ["user_image_count_per_month", "5000", "1000000000000"],
      ["key_tts_code_points_per_month", "1000000", "1000000000000"],
      ["user_tts_code_points_per_month", "5000000", "1000000000000"],
      ["key_stt_seconds_per_month", "36000", "1000000000000"],
      ["user_stt_seconds_per_month", "180000", "1000000000000"],
    ] as const;

    for (const [name, value, max] of expected) {
      const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
      expect(input).toContain('type="number"');
      expect(input).toContain('min="1"');
      expect(input).toContain(`max="${max}"`);
      expect(input).toContain('step="1"');
      expect(input).toContain('required=""');
      expect(input).toContain(`value="${value}"`);
    }

    expect(html).toContain("lg:grid-cols-[minmax(12rem,1fr)_minmax(0,12rem)_minmax(0,12rem)]");
    expect(html).toContain("save");
  });

  it("中英文目录包含相同的治理表单文案", () => {
    const zh = zhMessages.admin.settings.governance as Record<string, string>;
    const en = enMessages.admin.settings.governance as Record<string, string>;
    const keys = [
      "title",
      "desc",
      "usingDefaults",
      "invalidStored",
      "throughputTitle",
      "quotaTitle",
      "metricColumn",
      "keyScope",
      "userScope",
      "rpm",
      "rpmUnit",
      "burst",
      "burstUnit",
      "concurrency",
      "concurrencyUnit",
      "chatTokens",
      "chatTokensUnit",
      "imageCount",
      "imageCountUnit",
      "ttsCodePoints",
      "ttsCodePointsUnit",
      "sttSeconds",
      "sttSecondsUnit",
      "save",
      "saving",
      "saved",
      "invalid",
      "saveFailed",
    ];

    for (const key of keys) {
      expect(zh[key]).toEqual(expect.any(String));
      expect(en[key]).toEqual(expect.any(String));
    }
  });
});
