import { describe, expect, it, vi } from "vitest";
import {
  ComposerStateMachine,
  createComposerSelectionState,
  resolveComposerSnapshot,
} from "./composerState";
import type { ModelOption } from "./types";

const models: ModelOption[] = [
  {
    modelId: "model-a",
    name: "provider/model-a",
    capabilities: {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingLevelMap: { off: "none", low: "low", high: "high" },
    },
  },
  { modelId: "model-b", name: "provider/model-b" },
];

describe("Composer state machine", () => {
  it("builds one selection snapshot from SSR inputs", () => {
    const state = createComposerSelectionState({
      models,
      initialModelName: "provider/model-a",
      initialCardIds: ["card-a"],
      initialKbIds: ["kb-a"],
      initialWebSearch: true,
      initialOutputModeId: "mode-a",
      initialRenderStyleId: "style-a",
      initialReasoningByModelId: { "model-a": "high" },
    });

    expect(state).toEqual({
      modelId: "model-a",
      cardIds: ["card-a"],
      kbIds: ["kb-a"],
      webSearch: true,
      outputModeId: "mode-a",
      renderStyleId: "style-a",
      reasoningByModelId: { "model-a": "high" },
    });
  });

  it("applies interleaved transitions against the latest synchronous snapshot", () => {
    const machine = new ComposerStateMachine(createComposerSelectionState({ models }));
    const listener = vi.fn();
    machine.subscribe(listener);

    machine.dispatch({ type: "toggleCard", id: "card-a" });
    machine.dispatch({ type: "toggleKnowledgeBase", id: "kb-b" });
    machine.dispatch({ type: "toggleCard", id: "card-c" });

    expect(machine.getSnapshot()).toMatchObject({
      cardIds: ["card-a", "card-c"],
      kbIds: ["kb-b"],
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps reasoning per model and resolves the selected model snapshot", () => {
    const machine = new ComposerStateMachine(createComposerSelectionState({ models }));

    machine.dispatch({ type: "setModelReasoning", modelId: "model-a", reasoning: "high" });
    machine.dispatch({ type: "selectModel", modelId: "model-b" });
    machine.dispatch({ type: "setModelReasoning", modelId: "model-b", reasoning: "off" });
    machine.dispatch({ type: "selectModel", modelId: "model-a" });

    expect(resolveComposerSnapshot(machine.getSnapshot(), models)).toEqual({
      modelId: "model-a",
      modelName: "provider/model-a",
      cardIds: [],
      kbIds: [],
      webSearch: false,
      outputModeId: null,
      renderStyleId: null,
      reasoningByModelId: { "model-a": "high", "model-b": "off" },
      reasoning: "high",
    });
  });

  it("clamps stale reasoning through the model catalog instead of persisting a second rule", () => {
    const state = createComposerSelectionState({
      models,
      initialModelName: "provider/model-a",
      initialReasoningByModelId: { "model-a": "xhigh" },
    });

    expect(resolveComposerSnapshot(state, models).reasoning).toBe("high");
  });
});
