/**
 * 系统设置页 —— /admin/settings
 *
 * 集中管理系统级配置:embedding 模型、联网搜索、标题生成模型等。
 * 与「运维监控」(/admin/operations)分离:本页只放可配置项,监控页只放只读状态。
 */
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/lib/session";
import ModelConfigSection from "./ModelConfigSection";
import { Settings } from "lucide-react";
import { PageHeader } from "@/shared/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const t = await getTranslations("admin.settings");
  const tn = await getTranslations("nav");

  return (
    <div className="space-y-10">
      <PageHeader icon={Settings} title={tn("settings")} desc={t("desc")} />

      <ModelConfigSection
        labels={{
          title: t("configTitle"),
          desc: t("configDesc"),
          embeddingTitle: t("embeddingTitle"),
          embeddingProvider: t("embeddingProvider"),
          embeddingModel: t("embeddingModel"),
          embeddingHint: t("embeddingHint"),
          webSearchTitle: t("webSearchTitle"),
          webSearchProvider: t("webSearchProvider"),
          webSearchApiKey: t("webSearchApiKey"),
          webSearchModel: t("webSearchModel"),
          webSearchHint: t("webSearchHint"),
          titleTaskTitle: t("titleTaskTitle"),
          titleTaskModel: t("titleTaskModel"),
          titleTaskHint: t("titleTaskHint"),
          compactTaskTitle: t("compactTaskTitle"),
          compactTaskModel: t("compactTaskModel"),
          compactTaskHint: t("compactTaskHint"),
          save: t("configSave"),
          saved: t("configSaved"),
          selectProvider: t("configSelectProvider"),
          noProviders: t("configNoProviders"),
        }}
      />
    </div>
  );
}
