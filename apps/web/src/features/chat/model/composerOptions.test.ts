import { describe, expect, it } from "vitest";
import { toComposerOptions } from "./composerOptions";

describe("toComposerOptions", () => {
  it("保留模型顺序与来源，归一化空值并只投影公开选项字段", () => {
    const models = [
      { id: "private", name: "same", displayName: null, capabilities: {}, visibility: "private" as const, ownerUserId: "secret" },
      { id: "public", name: "same", displayName: "Public", capabilities: { tools: true }, visibility: "public" as const },
    ];
    const modes = [{ id: "mode", name: "Mode", description: null, icon: null, systemPrompt: "secret" }];
    const styles = [{ id: "style", name: "Style", cssClass: "style", renderer: "custom" as const, css: "secret" }];
    expect(toComposerOptions(models, modes, styles)).toEqual({
      models: [
        { modelId: "private", name: "same", displayName: undefined, capabilities: {}, source: "byo" },
        { modelId: "public", name: "same", displayName: "Public", capabilities: { tools: true }, source: "global" },
      ],
      modes: [{ id: "mode", name: "Mode", description: null, icon: null }],
      styles: [{ id: "style", name: "Style", cssClass: "style", renderer: "custom", description: undefined, icon: undefined }],
    });
  });

  it("支持没有可用选项", () => {
    expect(toComposerOptions([], [], [])).toEqual({ models: [], modes: [], styles: [] });
  });
});
