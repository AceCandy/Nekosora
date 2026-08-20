import type { ChatMessage } from "@/features/chat/model/types";

export interface RenderStyleSemantics {
  cssClass?: string | null;
  renderer?: "streamdown" | "custom";
  isPaper?: boolean;
}

export interface RenderStyleRollout {
  conversationId?: string;
  target: RenderStyleSemantics;
  applied: Map<number, RenderStyleSemantics> | null;
  generation: number;
}

export function sameRenderStyle(
  left: RenderStyleSemantics,
  right: RenderStyleSemantics,
): boolean {
  return left.cssClass === right.cssClass
    && left.renderer === right.renderer
    && left.isPaper === right.isPaper;
}

export function resolveViewportAnchorDelta(
  previousViewportTop: number,
  currentViewportTop: number,
  previousScrollTop: number,
  currentScrollTop: number,
): number {
  if (Math.abs(currentScrollTop - previousScrollTop) > 0.5) return 0;
  const delta = currentViewportTop - previousViewportTop;
  return Math.abs(delta) > 0.5 ? delta : 0;
}

export function resolveRenderStyle(
  rollout: RenderStyleRollout,
  index: number,
): RenderStyleSemantics {
  return rollout.applied?.get(index) ?? rollout.target;
}

export function startRenderStyleRollout(
  previous: RenderStyleRollout,
  target: RenderStyleSemantics,
  messages: ChatMessage[],
  visibleIndices: ReadonlySet<number>,
  generation: number,
  conversationId?: string,
): RenderStyleRollout {
  const applied = new Map<number, RenderStyleSemantics>();
  messages.forEach((message, index) => {
    if (message.role !== "assistant") return;
    applied.set(
      index,
      visibleIndices.has(index) ? target : resolveRenderStyle(previous, index),
    );
  });
  return { conversationId, target, applied, generation };
}

export function applyRenderStyleBatch(
  rollout: RenderStyleRollout,
  indices: readonly number[],
  generation: number,
): RenderStyleRollout {
  if (!rollout.applied || rollout.generation !== generation || indices.length === 0) {
    return rollout;
  }
  const applied = new Map(rollout.applied);
  let changed = false;
  indices.forEach((index) => {
    if (sameRenderStyle(applied.get(index) ?? rollout.target, rollout.target)) return;
    applied.set(index, rollout.target);
    changed = true;
  });
  if (!changed) return rollout;
  return { ...rollout, applied };
}

export function settleRenderStyleRollout(
  rollout: RenderStyleRollout,
  generation: number,
): RenderStyleRollout {
  if (rollout.generation !== generation) return rollout;
  return { ...rollout, applied: null };
}
