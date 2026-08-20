import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSettings, upsertSettings } from "@/lib/system-settings/service";
import { resetUAConfig, getChatUA, getGatewayUA } from "@/lib/system-settings/ua";
import { requireAdmin } from "@/lib/session";
import { Button } from "@/shared/ui/Button";

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
        <h2 className="text-ui-title font-semibold text-neutral-900 ">{t("basicTitle")}</h2>
        <p className="mt-1 text-ui-body text-neutral-500">{t("basicDesc")}</p>
      </div>

      <form action={saveUA} className="rounded-lg border border-neutral-200 bg-white   p-5 space-y-3">
        <label className="block space-y-1">
          <span className="text-ui-caption font-medium text-neutral-500">{t("chatUaLabel")}</span>
          <input
            name="chat_ua"
            defaultValue={ua.chat_ua ?? ""}
            placeholder={defaultChatUA}
            className="w-full rounded-md border border-neutral-200  bg-transparent px-3 py-2 text-ui-body font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-ui-caption text-neutral-400">{t("chatUaHint")}</p>
        </label>
        <label className="block space-y-1">
          <span className="text-ui-caption font-medium text-neutral-500">{t("gatewayUaLabel")}</span>
          <input
            name="gateway_ua"
            defaultValue={ua.gateway_ua ?? ""}
            placeholder={defaultGatewayUA}
            className="w-full rounded-md border border-neutral-200  bg-transparent px-3 py-2 text-ui-body font-mono focus:outline-none focus:border-sora-blue"
          />
          <p className="text-ui-caption text-neutral-400">{t("gatewayUaHint")}</p>
        </label>
        <Button type="submit" variant="primary" className="px-4 py-2 font-semibold">
          {t("configSave")}
        </Button>
      </form>
    </div>
  );
}
