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
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";
import BasicSettingsSection from "./BasicSettingsSection";
import GovernanceSettingsSection from "./GovernanceSettingsSection";
import ModelConfigSection from "./ModelConfigSection";
import OutputModesSection from "./OutputModesSection";
import RenderStylesSection from "./RenderStylesSection";
import { getSettingsControlView, listSettingsHistory } from "@/lib/settings-control/service";
import SettingsChangeControl from "./SettingsChangeControl";
import type { GovernanceHistoryRange } from "@/lib/gateway-governance/analytics";

export const dynamic = "force-dynamic";

const SETTINGS_TAB_ALIASES: Record<string, SettingsTab> = {
  basic: "protocol",
  model: "models",
  "output-modes": "output",
  "render-styles": "output",
  governance: "governance",
  models: "models",
  output: "output",
  protocol: "protocol",
};

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
  const tab: SettingsTab = SETTINGS_TAB_ALIASES[tabParam] ?? "models";
  const rangeParam = typeof sp.range === "string" ? Number(sp.range) : 7;
  const governanceRange: GovernanceHistoryRange = rangeParam === 30 || rangeParam === 90
    ? rangeParam
    : 7;

  return (
    <div className="space-y-8">
      <PageHeader icon={Settings} title={tn("settings")} desc={t("desc")} />

      <SettingsTabs current={tab} />

      {tab === "models" && (
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
          }}
        />
      )}
      {tab === "protocol" && <BasicSettingsSection control={control} />}
      {tab === "output" && (
        <div className="space-y-12">
          <OutputModesSection control={control} />
          <RenderStylesSection control={control} />
        </div>
      )}
      {tab === "governance" && (
        <GovernanceSettingsSection control={control} range={governanceRange} />
      )}

      <SettingsChangeControl
        revision={control.currentRevision}
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
        labels={{
          draftSummary: t("control.draftSummary"),
          currentRevision: t("control.currentRevision"),
          draftPersisted: t("control.draftPersisted"),
          noDraft: t("control.noDraft"),
          history: t("control.history"),
          historyEmpty: t("control.historyEmpty"),
          rollback: t("control.rollback"),
          release: t("control.release"),
          changes: t("control.changes"),
          reverseRelease: t("control.reverseRelease"),
          working: t("control.working"),
          abandon: t("control.abandon"),
          applying: t("control.applying"),
          reviewApply: t("control.reviewApply"),
          reviewChanges: t("control.reviewChanges"),
          created: t("control.created"),
          deleted: t("control.deleted"),
          updated: t("control.updated"),
          applied: t("control.applied"),
          applied_cache_warning: t("control.appliedCacheWarning"),
          abandoned: t("control.abandoned"),
          rollback_created: t("control.rollbackCreated"),
          stale: t("control.stale"),
          rollback_conflict: t("control.rollbackConflict"),
          invalid: t("control.invalid"),
          failed: t("control.failed"),
        }}
      />
    </div>
  );
}
