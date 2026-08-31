import { describe, expect, it } from "vitest";
import type { ChatProcessEvent } from "@nekusora/contracts/chat";
import { reduceChatProcessEvent, snapshotFromProcessRuntime } from "./processTrace";

function phaseEvent(seq: number, phase: ChatProcessEvent["phase"]): ChatProcessEvent {
  return {
    type: "trace",
    version: 1,
    action: "phase",
    runId: "run-1",
    seq,
    at: `2026-08-07T00:00:0${seq}.000Z`,
    phase,
  };
}

describe("reduceChatProcessEvent", () => {
  it("按 step id 更新并保留首次顺序", () => {
    let state = reduceChatProcessEvent(undefined, phaseEvent(1, "preparing"));
    state = reduceChatProcessEvent(state, {
      ...phaseEvent(2, "preparing"),
      action: "step",
      step: { id: "memory", kind: "memory", status: "running" },
    });
    state = reduceChatProcessEvent(state, {
      ...phaseEvent(3, "preparing"),
      action: "step",
      step: { id: "rag", kind: "rag", status: "running" },
    });
    state = reduceChatProcessEvent(state, {
      ...phaseEvent(4, "processing"),
      action: "step",
      step: {
        id: "memory",
        kind: "memory",
        status: "completed",
        data: { availableCount: 3, recalledCount: 1 },
      },
    });

    expect(state.steps.map((step) => step.id)).toEqual(["memory", "rag"]);
    expect(state.steps[0]).toMatchObject({ status: "completed" });
  });

  it("忽略倒序、跨 run、phase 回退和终态后的事件", () => {
    let state = reduceChatProcessEvent(undefined, phaseEvent(1, "preparing"));
    state = reduceChatProcessEvent(state, phaseEvent(2, "answering"));
    state = reduceChatProcessEvent(state, phaseEvent(3, "processing"));
    expect(state.phase).toBe("answering");

    const sameAfterOld = reduceChatProcessEvent(state, phaseEvent(2, "answering"));
    const sameAfterOtherRun = reduceChatProcessEvent(state, {
      ...phaseEvent(4, "answering"),
      runId: "run-2",
    });
    expect(sameAfterOld).toBe(state);
    expect(sameAfterOtherRun).toBe(state);

    state = reduceChatProcessEvent(state, phaseEvent(4, "completed"));
    expect(reduceChatProcessEvent(state, phaseEvent(5, "failed"))).toBe(state);
  });

  it("终态冻结为快照并在 continue 时保留旧 run", () => {
    let state = reduceChatProcessEvent(undefined, phaseEvent(1, "preparing"));
    state = reduceChatProcessEvent(state, phaseEvent(2, "completed"));
    const first = snapshotFromProcessRuntime(state);
    const continued = reduceChatProcessEvent(undefined, {
      ...phaseEvent(1, "interrupted"),
      runId: "run-2",
    });

    expect(snapshotFromProcessRuntime(continued, first)?.runs.map((run) => run.runId))
      .toEqual(["run-1", "run-2"]);
  });

  it("RAG 来源在事件与快照之间深复制", () => {
    const sources = [{ fileId: "file-1", filename: "notes.txt", mime: "text/plain" }];
    let state = reduceChatProcessEvent(undefined, phaseEvent(1, "preparing"));
    state = reduceChatProcessEvent(state, {
      ...phaseEvent(2, "processing"),
      action: "step",
      step: {
        id: "rag",
        kind: "rag",
        status: "completed",
        data: { fileCount: 1, sources },
      },
    });
    sources[0].filename = "event-mutated.txt";
    expect(state.steps[0]).toMatchObject({ data: { sources: [{ filename: "notes.txt" }] } });

    state = { ...state, phase: "completed" };
    const snapshot = snapshotFromProcessRuntime(state);
    const step = state.steps[0];
    if (step.kind !== "rag" || !step.data?.sources) throw new Error("missing sources");
    step.data.sources[0].filename = "runtime-mutated.txt";
    expect(snapshot?.runs[0].steps[0]).toMatchObject({
      data: { sources: [{ filename: "notes.txt" }] },
    });
  });
});
