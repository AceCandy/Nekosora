import type { ReasoningLevel } from "@/db/types";
import { resolveReasoningForModel } from "@/lib/reasoning";
import type { ModelOption } from "./types";

export interface ComposerSelectionState {
  modelId: string;
  cardIds: string[];
  webSearch: boolean;
  outputModeId: string | null;
  renderStyleId: string | null;
  reasoningByModelId: Record<string, ReasoningLevel>;
}

export interface ComposerSelectionInput {
  models: ModelOption[];
  initialModelName?: string | null;
  initialCardIds?: string[];
  initialWebSearch?: boolean;
  initialOutputModeId?: string | null;
  initialRenderStyleId?: string | null;
  initialReasoningByModelId?: Record<string, ReasoningLevel>;
}

export type ComposerTransition =
  | { type: "selectModel"; modelId: string }
  | { type: "toggleCard"; id: string }
  | { type: "toggleWebSearch" }
  | { type: "selectOutputMode"; id: string | null }
  | { type: "selectRenderStyle"; id: string | null }
  | { type: "setModelReasoning"; modelId: string; reasoning: ReasoningLevel };

export interface ResolvedComposerSnapshot extends ComposerSelectionState {
  modelName: string;
  reasoning: ReasoningLevel;
}

type Listener = () => void;

function toggleId(values: string[], id: string): string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

export function createComposerSelectionState(input: ComposerSelectionInput): ComposerSelectionState {
  const modelId = input.initialModelName
    ? input.models.find((model) => model.name === input.initialModelName)?.modelId
    : undefined;
  return {
    modelId: modelId ?? input.models[0]?.modelId ?? "",
    cardIds: [...(input.initialCardIds ?? [])],
    webSearch: input.initialWebSearch ?? false,
    outputModeId: input.initialOutputModeId ?? null,
    renderStyleId: input.initialRenderStyleId ?? null,
    reasoningByModelId: { ...(input.initialReasoningByModelId ?? {}) },
  };
}

export function reduceComposerSelection(
  state: ComposerSelectionState,
  transition: ComposerTransition,
): ComposerSelectionState {
  switch (transition.type) {
    case "selectModel":
      return transition.modelId === state.modelId
        ? state
        : { ...state, modelId: transition.modelId };
    case "toggleCard":
      return { ...state, cardIds: toggleId(state.cardIds, transition.id) };
    case "toggleWebSearch":
      return { ...state, webSearch: !state.webSearch };
    case "selectOutputMode":
      return transition.id === state.outputModeId
        ? state
        : { ...state, outputModeId: transition.id };
    case "selectRenderStyle":
      return transition.id === state.renderStyleId
        ? state
        : { ...state, renderStyleId: transition.id };
    case "setModelReasoning":
      return state.reasoningByModelId[transition.modelId] === transition.reasoning
        ? state
        : {
            ...state,
            reasoningByModelId: {
              ...state.reasoningByModelId,
              [transition.modelId]: transition.reasoning,
            },
          };
  }
}

export function resolveComposerSnapshot(
  state: ComposerSelectionState,
  models: ModelOption[],
): ResolvedComposerSnapshot {
  const model = models.find((candidate) => candidate.modelId === state.modelId);
  return {
    ...state,
    modelName: model?.name ?? "",
    reasoning: resolveReasoningForModel(
      model?.capabilities,
      state.modelId,
      state.reasoningByModelId,
    ),
  };
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameReasoningMap(
  left: Record<string, ReasoningLevel>,
  right: Record<string, ReasoningLevel>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key]);
}

export function composerSelectionsEqual(
  left: ComposerSelectionState,
  right: ComposerSelectionState,
): boolean {
  return left.modelId === right.modelId
    && sameArray(left.cardIds, right.cardIds)
    && left.webSearch === right.webSearch
    && left.outputModeId === right.outputModeId
    && left.renderStyleId === right.renderStyleId
    && sameReasoningMap(left.reasoningByModelId, right.reasoningByModelId);
}

export class ComposerStateMachine {
  private snapshot: ComposerSelectionState;
  private readonly listeners = new Set<Listener>();

  constructor(initialState: ComposerSelectionState) {
    this.snapshot = initialState;
  }

  readonly getSnapshot = (): ComposerSelectionState => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  dispatch(transition: ComposerTransition): ComposerSelectionState {
    const next = reduceComposerSelection(this.snapshot, transition);
    if (next === this.snapshot) return this.snapshot;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
    return next;
  }
}
