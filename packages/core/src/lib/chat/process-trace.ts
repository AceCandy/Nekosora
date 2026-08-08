import type {
  ChatProcessEvent,
  ChatProcessPhase,
  ChatProcessRunSnapshot,
  ChatProcessSnapshot,
  ChatProcessStep,
  ChatProcessTerminalPhase,
} from "@nekusora/contracts/chat";

type ProcessEventEmitter = (event: ChatProcessEvent) => void | Promise<void>;

interface ChatProcessRecorderOptions {
  runId: string;
  emit: ProcessEventEmitter;
  now?: () => Date;
  onEmitError?: (error: unknown) => void;
}

const PHASE_RANK: Record<ChatProcessPhase, number> = {
  preparing: 0,
  processing: 1,
  answering: 2,
  completed: 3,
  failed: 3,
  interrupted: 3,
};

/** 单个 Chat run 的低频过程事件记录器；失败只降级轨迹，不影响回答。 */
export class ChatProcessRecorder {
  readonly runId: string;
  readonly startedAt: string;

  private readonly emit: ProcessEventEmitter;
  private readonly now: () => Date;
  private readonly onEmitError?: (error: unknown) => void;
  private readonly steps = new Map<string, ChatProcessStep>();
  private phase: ChatProcessPhase = "preparing";
  private phaseEmitted = false;
  private seq = 0;
  private firstContentAt: string | undefined;
  private endedAt: string | undefined;
  private emission = Promise.resolve();
  private emitFailureCount = 0;

  constructor(options: ChatProcessRecorderOptions) {
    this.runId = options.runId;
    this.emit = options.emit;
    this.now = options.now ?? (() => new Date());
    this.onEmitError = options.onEmitError;
    this.startedAt = this.timestamp();
  }

  start(): Promise<void> {
    this.ensureStarted();
    return this.flush();
  }

  setPhase(next: ChatProcessPhase): Promise<void> {
    this.ensureStarted();
    if (isTerminalPhase(this.phase) || PHASE_RANK[next] < PHASE_RANK[this.phase]) {
      return this.flush();
    }
    if (next === this.phase) return this.flush();

    this.phase = next;
    const at = this.timestamp();
    if (next === "answering" && !this.firstContentAt) this.firstContentAt = at;
    if (isTerminalPhase(next)) this.endedAt = at;
    this.queue({
      type: "trace",
      version: 1,
      action: "phase",
      runId: this.runId,
      seq: this.nextSeq(),
      at,
      phase: next,
    });
    return this.flush();
  }

  recordStep(step: ChatProcessStep): Promise<void> {
    this.ensureStarted();
    if (isTerminalPhase(this.phase)) return this.flush();

    const previous = this.steps.get(step.id);
    if (previous && previous.kind !== step.kind) return this.flush();
    if (previous && previous.status !== "running" && step.status === "running") {
      return this.flush();
    }

    const at = this.timestamp();
    const normalized = {
      ...step,
      startedAt: previous?.startedAt ?? step.startedAt ?? at,
      endedAt: step.status === "running" ? undefined : step.endedAt ?? at,
    } as ChatProcessStep;
    this.steps.set(step.id, normalized);
    this.queue({
      type: "trace",
      version: 1,
      action: "step",
      runId: this.runId,
      seq: this.nextSeq(),
      at,
      phase: this.phase,
      step: normalized,
    });
    return this.flush();
  }

  async finish(phase: ChatProcessTerminalPhase): Promise<void> {
    if (isTerminalPhase(this.phase)) return this.flush();
    const stepStatus = phase === "completed" ? "completed" : phase;
    for (const step of this.steps.values()) {
      if (step.status === "running") {
        await this.recordStep({ ...step, status: stepStatus } as ChatProcessStep);
      }
    }
    await this.setPhase(phase);
  }

  snapshot(): ChatProcessRunSnapshot | undefined {
    if (!isTerminalPhase(this.phase)) return undefined;
    return this.snapshotFor(this.phase, this.endedAt);
  }

  /** 为 completion 事务生成终态快照，但不提前向客户端宣告终态。 */
  projectedSnapshot(phase: ChatProcessTerminalPhase, endedAt = this.timestamp()): ChatProcessRunSnapshot {
    return this.snapshotFor(phase, endedAt);
  }

  private snapshotFor(
    phase: ChatProcessTerminalPhase,
    endedAt: string | undefined,
  ): ChatProcessRunSnapshot {
    const stepStatus = phase === "completed" ? "completed" : phase;
    return {
      runId: this.runId,
      phase,
      steps: [...this.steps.values()].map((step) => cloneStep(
        step.status === "running"
          ? { ...step, status: stepStatus, endedAt } as ChatProcessStep
          : step,
      )),
      startedAt: this.startedAt,
      firstContentAt: this.firstContentAt,
      endedAt,
    };
  }

  flush(): Promise<void> {
    return this.emission;
  }

  getEmitFailureCount(): number {
    return this.emitFailureCount;
  }

  private ensureStarted(): void {
    if (this.phaseEmitted) return;
    this.phaseEmitted = true;
    this.queue({
      type: "trace",
      version: 1,
      action: "phase",
      runId: this.runId,
      seq: this.nextSeq(),
      at: this.startedAt,
      phase: "preparing",
    });
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private queue(event: ChatProcessEvent): void {
    this.emission = this.emission
      .then(() => this.emit(event))
      .catch((error) => {
        this.emitFailureCount += 1;
        this.onEmitError?.(error);
      });
  }
}

export function appendChatProcessRun(
  snapshot: ChatProcessSnapshot | undefined,
  run: ChatProcessRunSnapshot,
): ChatProcessSnapshot {
  const runs = snapshot?.runs.filter((item) => item.runId !== run.runId) ?? [];
  return { version: 1, runs: [...runs, run] };
}

function isTerminalPhase(phase: ChatProcessPhase): phase is ChatProcessTerminalPhase {
  return phase === "completed" || phase === "failed" || phase === "interrupted";
}

function cloneStep(step: ChatProcessStep): ChatProcessStep {
  return {
    ...step,
    ...("data" in step && step.data ? { data: { ...step.data } } : {}),
  } as ChatProcessStep;
}
