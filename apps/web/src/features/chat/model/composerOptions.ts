import type { getVisibleModels } from "@/features/chat/actions/conversations";
import type { ModelOption, OutputModeOption, RenderStyleOption } from "./types";

type VisibleModel = Pick<Awaited<ReturnType<typeof getVisibleModels>>[number],
  "id" | "name" | "displayName" | "capabilities" | "visibility">;

/** 两个聊天入口共用显式投影，避免把服务端配置带入选项。 */
export function toComposerOptions(
  visibleModels: VisibleModel[],
  outputModes: OutputModeOption[],
  renderStyles: RenderStyleOption[],
): { models: ModelOption[]; modes: OutputModeOption[]; styles: RenderStyleOption[] } {
  return {
    models: visibleModels.map((model) => ({
      modelId: model.id,
      name: model.name,
      displayName: model.displayName ?? undefined,
      capabilities: model.capabilities ?? undefined,
      source: model.visibility === "public" ? "global" : "byo",
    })),
    modes: outputModes.map(({ id, name, description, icon }) => ({ id, name, description, icon })),
    styles: renderStyles.map(({ id, cssClass, renderer, name, description, icon }) => ({
      id, cssClass, renderer, name, description, icon,
    })),
  };
}
