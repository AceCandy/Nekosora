import { getTranslations } from "next-intl/server";
import { getImageModels } from "@/features/chat/actions/conversations";
import ImageStudio from "@/features/image/ImageStudio";

export default async function ImagePage() {
  const t = await getTranslations("image");
  // getImageModels 已返回扁平数组且 private 排序在前,直接映射为 ImageModel[]。
  // modelId 用于 WebChat byId 路由解析(避免 public/private 同名歧义)。
  const imageModels = await getImageModels();
  const models = (imageModels as Record<string, unknown>[]).map((m) => ({
    modelId: m.id as string,
    name: m.name as string,
    displayName: (m.displayName as string | undefined) ?? undefined,
  }));

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full p-6 md:p-8">
      <div className="shrink-0 mb-6">
        <h1 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white">{t("title")}</h1>
        <p className="text-xs text-neutral-450 dark:text-neutral-500 mt-1">{t("subtitle")}</p>
      </div>
      <div className="flex-1 min-h-0">
        <ImageStudio models={models} />
      </div>
    </div>
  );
}
