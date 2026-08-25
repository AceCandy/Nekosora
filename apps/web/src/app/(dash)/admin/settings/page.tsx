/**
 * 系统设置页 —— /admin/settings
 *
 * 集中管理系统级配置:模型配置 / 输出模式 / 输出样式 / 请求治理,以二级 tab 呈现。
 * tab 走 ?tab= 切换(纯 Link,服务端渲染),默认「模型配置」。
 * 与「运维监控」(/admin/operations)分离:本页只放可配置项,监控页只放只读状态。
 */
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";
import { SettingsTabs } from "./SettingsTabs";
import { resolveSettingsSelection } from "./settings-selection";
import BasicSettingsSection from "./BasicSettingsSection";
import GovernanceSettingsSection from "./GovernanceSettingsSection";
import ModelConfigSection from "./ModelConfigSection";
import OutputModesSection from "./OutputModesSection";
import RenderStylesSection from "./RenderStylesSection";
import { getSettingsControlView, listSettingsHistory } from "@/lib/settings-control/service";
import SettingsChangeControl from "./SettingsChangeControl";
import type { GovernanceHistoryRange } from "@/lib/gateway-governance/analytics";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.settings");
  const tn = await getTranslations("nav");
  const [control, history] = await Promise.all([
    getSettingsControlView(),
    listSettingsHistory(20),
  ]);

  const sp = await searchParams;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "";
  const viewParam = typeof sp.view === "string" ? sp.view : "";
  const selection = resolveSettingsSelection(tabParam, viewParam);
  const rangeParam = typeof sp.range === "string" ? Number(sp.range) : 7;
  const governanceRange: GovernanceHistoryRange = rangeParam === 30 || rangeParam === 90
    ? rangeParam
    : 7;

  return (
    <div className="space-y-8">
      <PageHeader icon={Settings} title={tn("settings")} desc={t("desc")} />

      <SettingsTabs {...selection} />

      <div className="min-w-0 space-y-8">
        {selection.tab === "models" && (
          <ModelConfigSection
            control={control}
            labels={{
              title: t("configTitle"),
              desc: t("configDesc"),
              embeddingTitle: t("embeddingTitle"),
              embeddingProvider: t("embeddingProvider"),
              embeddingModel: t("embeddingModel"),
              embeddingHint: t("embeddingHint"),
              titleTaskTitle: t("titleTaskTitle"),
              titleTaskModel: t("titleTaskModel"),
              titleTaskHint: t("titleTaskHint"),
              titleTaskAuto: t("titleTaskAuto"),
              compactTaskTitle: t("compactTaskTitle"),
              compactTaskModel: t("compactTaskModel"),
              compactTaskHint: t("compactTaskHint"),
              compactTaskAuto: t("compactTaskAuto"),
              mem0LlmTitle: t("mem0LlmTitle"),
              mem0LlmModel: t("mem0LlmModel"),
              mem0LlmHint: t("mem0LlmHint"),
              mem0LlmAuto: t("mem0LlmAuto"),
              save: t("configSave"),
              saving: t("configSaving"),
              saved: t("configSaved"),
              saveFailed: t("configSaveFailed"),
              selectProvider: t("configSelectProvider"),
              noProviders: t("configNoProviders"),
              backgroundTasksTitle: t("backgroundTasksTitle"),
              backgroundTasksDesc: t("backgroundTasksDesc"),
            }}
          />
        )}
        {selection.tab === "protocol" && <BasicSettingsSection control={control} />}
        {selection.tab === "output" && selection.view === "modes" && <OutputModesSection control={control} />}
        {selection.tab === "output" && selection.view === "styles" && <RenderStylesSection control={control} />}
        {selection.tab === "governance" && (
          <GovernanceSettingsSection
            control={control}
            range={governanceRange}
            view={selection.view === "history" ? "history" : "policy"}
          />
        )}

        <SettingsChangeControl
          key={control.draft?.id ?? `revision-${control.currentRevision}`}
          draft={control.draft ? {
            id: control.draft.id,
            kind: control.draft.kind,
            version: control.draft.version,
            changes: control.draft.changes,
          } : null}
          history={history.map((item) => ({
            id: item.id,
            kind: item.kind,
            rollbackOf: item.rollbackOf,
            appliedRevision: item.appliedRevision,
            appliedAt: item.appliedAt.toISOString(),
            changes: item.changes,
          }))}
        />
      </div>
    </div>
  );
}
