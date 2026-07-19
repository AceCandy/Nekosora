import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSettings, upsertSettings } from "@/lib/system-settings/service";
import { resetUAConfig, getChatUA, getGatewayUA } from "@/lib/system-settings/ua";
import { requireAdmin } from "@/lib/session";

/**
 * 基础设置区 -- 聊天 UA / 转发 UA 配置。
 *
 * 嵌入 admin/settings 页。提交后 upsert system_settings(gateway) 并清 UA 缓存即时生效。
 * 未配置时 getChatUA/getGatewayUA 回退 Nekusora/{version};placeholder 显当前生效值(含默认)。
 */
export default async function BasicSettingsSection() {
  await requireAdmin();
  const t = await getTranslations("admin.settings");
  const ua = await getSettings("gateway");
  // 当前生效 UA(配置值或默认),placeholder 提示用户留空时会用什么。
  const defaultChatUA = await getChatUA();
  const defaultGatewayUA = await getGatewayUA();

  async function saveUA(formData: FormData) {
    "use server";
    const chatUa = String(formData.get("chat_ua") ?? "").trim();
    const gatewayUa = String(formData.get("gateway_ua") ?? "").trim();
    await upsertSettings("gateway", {
      chat_ua: chatUa,
      gateway_ua: gatewayUa,
    });
    resetUAConfig();
    revalidatePath("/admin/settings");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">{t("basicTitle")}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t("basicDesc")}</p>
      </div>

      <form action={saveUA} className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-[#12141a] p-5 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{t("chatUaLabel")}</label>
          <input
            name="chat_ua"
            defaultValue={ua.chat_ua ?? ""}
            placeholder={defaultChatUA}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-[11px] text-neutral-400">{t("chatUaHint")}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-500">{t("gatewayUaLabel")}</label>
          <input
            name="gateway_ua"
            defaultValue={ua.gateway_ua ?? ""}
            placeholder={defaultGatewayUA}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-[11px] text-neutral-400">{t("gatewayUaHint")}</p>
        </div>
        <button type="submit" className="rounded-md bg-sora-blue hover:bg-sora-blue-hover text-white px-4 py-2 text-sm font-semibold cursor-pointer">
          {t("configSave")}
        </button>
      </form>
    </div>
  );
}
