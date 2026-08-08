import type {
  ChatProcessEvent,
  ChatProcessPhase,
  ChatProcessRunSnapshot,
  ChatProcessSnapshot,
  ChatProcessStep,
  ChatProcessTerminalPhase,
} from "@nekusora/contracts/chat";

export interface ChatProcessRuntimeState {
  runId: string;
  lastSeq: number;
  phase: ChatProcessPhase;
  steps: ChatProcessStep[];
  startedAt: string;
  firstContentAt?: string;
  endedAt?: string;
}

export function reduceChatProcessEvent(
  state: ChatProcessRuntimeState | undefined,
  event: ChatProcessEvent,
): ChatProcessRuntimeState {
  if (state && (state.runId !== event.runId || event.seq <= state.lastSeq || isTerminal(state.phase))) {
    return state;
  }

  const next: ChatProcessRuntimeState = state
    ? { ...state, steps: [...state.steps], lastSeq: event.seq }
    : {
        runId: event.runId,
        lastSeq: event.seq,
        phase: event.phase,
        steps: [],
        startedAt: event.at,
      };

  if (phaseRank(event.phase) >= phaseRank(next.phase)) next.phase = event.phase;
  if (event.phase === "answering" && !next.firstContentAt) next.firstContentAt = event.at;
  if (isTerminal(event.phase)) next.endedAt = event.at;

  if (event.action === "step") {
    const index = next.steps.findIndex((step) => step.id === event.step.id);
    if (index >= 0) next.steps[index] = cloneStep(event.step);
    else next.steps.push(cloneStep(event.step));
  }
  return next;
}

export function processRuntimeFromRun(run: ChatProcessRunSnapshot): ChatProcessRuntimeState {
  return {
    runId: run.runId,
    lastSeq: 0,
    phase: run.phase,
    steps: run.steps.map(cloneStep),
    startedAt: run.startedAt,
    firstContentAt: run.firstContentAt,
    endedAt: run.endedAt,
  };
}

export function latestProcessRun(
  snapshot: ChatProcessSnapshot | undefined,
): ChatProcessRunSnapshot | undefined {
  return snapshot?.runs.at(-1);
}

export function snapshotFromProcessRuntime(
  state: ChatProcessRuntimeState,
  existing?: ChatProcessSnapshot,
): ChatProcessSnapshot | undefined {
  if (!isTerminal(state.phase)) return existing;
  const runs = existing?.runs.filter((run) => run.runId !== state.runId) ?? [];
  return {
    version: 1,
    runs: [
      ...runs,
      {
        runId: state.runId,
        phase: state.phase,
        steps: state.steps.map(cloneStep),
        startedAt: state.startedAt,
        firstContentAt: state.firstContentAt,
        endedAt: state.endedAt,
      },
    ],
  };
}

function phaseRank(phase: ChatProcessPhase): number {
  if (phase === "preparing") return 0;
  if (phase === "processing") return 1;
  if (phase === "answering") return 2;
  return 3;
}

function isTerminal(phase: ChatProcessPhase): phase is ChatProcessTerminalPhase {
  return phase === "completed" || phase === "failed" || phase === "interrupted";
}

function cloneStep(step: ChatProcessStep): ChatProcessStep {
  return {
    ...step,
    ...("data" in step && step.data ? { data: { ...step.data } } : {}),
  } as ChatProcessStep;
}
