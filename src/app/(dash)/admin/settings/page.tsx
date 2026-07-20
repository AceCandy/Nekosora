/**
 * 系统设置页 —— /admin/settings
 *
 * 集中管理系统级配置:模型配置 / 输出模式 / 输出样式,以二级 tab 呈现。
 * tab 走 ?tab= 切换(纯 Link,服务端渲染),默认「模型配置」。
 * 与「运维监控」(/admin/operations)分离:本页只放可配置项,监控页只放只读状态。
 */
import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";
import BasicSettingsSection from "./BasicSettingsSection";
import ModelConfigSection from "./ModelConfigSection";
import OutputModesSection from "./OutputModesSection";
import RenderStylesSection from "./RenderStylesSection";

export const dynamic = "force-dynamic";

const VALID_TABS: SettingsTab[] = ["basic", "model", "output-modes", "render-styles"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.settings");
  const tn = await getTranslations("nav");

  const sp = await searchParams;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "";
  const tab: SettingsTab = VALID_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "model";

  return (
    <div className="space-y-8">
      <PageHeader icon={Settings} title={tn("settings")} desc={t("desc")} />

      <SettingsTabs current={tab} />

      {tab === "model" && (
        <ModelConfigSection
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
            compactTaskTitle: t("compactTaskTitle"),
            compactTaskModel: t("compactTaskModel"),
            compactTaskHint: t("compactTaskHint"),
            mem0LlmTitle: t("mem0LlmTitle"),
            mem0LlmModel: t("mem0LlmModel"),
            mem0LlmHint: t("mem0LlmHint"),
            save: t("configSave"),
            saved: t("configSaved"),
            selectProvider: t("configSelectProvider"),
            noProviders: t("configNoProviders"),
          }}
        />
      )}
      {tab === "basic" && <BasicSettingsSection />}
      {tab === "output-modes" && <OutputModesSection />}
      {tab === "render-styles" && <RenderStylesSection />}
    </div>
  );
}
