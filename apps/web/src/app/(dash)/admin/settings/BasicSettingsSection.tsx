import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSettings } from "@/lib/system-settings/service";
import { DEFAULT_UA, getChatUA, getGatewayUA } from "@/lib/system-settings/ua";
import { requireAdmin } from "@/lib/session";
import {
  projectSystemSettings,
  stageSystemSettings,
  type SettingsControlView,
} from "@/lib/settings-control/service";
import BasicSettingsForm from "./BasicSettingsForm";

/**
 * 基础设置区 -- 聊天 UA / 转发 UA 配置。
 *
 * 嵌入 admin/settings 页。提交后写入活动草稿，整批发布后生效。
 * 未配置时 getChatUA/getGatewayUA 回退 Nekusora/{version};placeholder 显当前生效值(含默认)。
 */
export default async function BasicSettingsSection({ control }: { control: SettingsControlView }) {
  await requireAdmin();
  const t = await getTranslations("admin.settings");
  const ua = projectSystemSettings(
    "gateway",
    await getSettings("gateway"),
    control.draft?.changes ?? [],
  );
  // 当前生效 UA(配置值或默认),placeholder 提示用户留空时会用什么。
  const effectiveChatUA = await getChatUA();
  const effectiveGatewayUA = await getGatewayUA();

  async function saveUA(formData: FormData) {
    "use server";
    const admin = await requireAdmin();
    const chatUa = String(formData.get("chat_ua") ?? "").trim();
    const gatewayUa = String(formData.get("gateway_ua") ?? "").trim();
    await stageSystemSettings({
      actorId: admin.id,
      expected: {
        changeSetId: control.draft?.id ?? null,
        version: control.draft?.version ?? null,
      },
      namespace: "gateway",
      values: { chat_ua: chatUa, gateway_ua: gatewayUa },
    });
    revalidatePath("/admin/settings");
  }

  return (
    <div id="gateway-user-agent" className="space-y-6 max-w-3xl scroll-mt-40">
      <div>
        <h2 className="text-ui-title font-semibold text-neutral-900 ">{t("basicTitle")}</h2>
        <p className="mt-1 text-ui-body text-neutral-500">{t("basicDesc")}</p>
      </div>

      <BasicSettingsForm
        action={saveUA}
        chatUa={ua.chat_ua ?? ""}
        gatewayUa={ua.gateway_ua ?? ""}
        defaultUa={DEFAULT_UA}
        chatSummary={t("uaValueSummary", {
          saved: ua.chat_ua || t("inheritDefault"),
          default: DEFAULT_UA,
          effective: effectiveChatUA,
        })}
        gatewaySummary={t("uaValueSummary", {
          saved: ua.gateway_ua || t("inheritDefault"),
          default: DEFAULT_UA,
          effective: effectiveGatewayUA,
        })}
        labels={{
          chat: t("chatUaLabel"),
          chatHint: t("chatUaHint"),
          gateway: t("gatewayUaLabel"),
          gatewayHint: t("gatewayUaHint"),
          save: t("configSave"),
          saving: t("configSaving"),
          saved: t("configSaved"),
          failed: t("configSaveFailed"),
        }}
      />
    </div>
  );
}
