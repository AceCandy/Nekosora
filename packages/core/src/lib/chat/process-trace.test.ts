import { describe, expect, it, vi } from "vitest";
import { isChatProcessEvent, isChatProcessSnapshot } from "@nekusora/contracts/chat";
import type { ChatProcessEvent } from "@nekusora/contracts/chat";
import { appendChatProcessRun, ChatProcessRecorder } from "./process-trace";

function advancingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 7, 0, 0, tick++));
}

describe("ChatProcessRecorder", () => {
  it("按 seq 发出准备、步骤、正文门控和终态", async () => {
    const events: ChatProcessEvent[] = [];
    const recorder = new ChatProcessRecorder({
      runId: "run-1",
      now: advancingClock(),
      emit: (event) => events.push(event),
    });

    await recorder.start();
    await recorder.recordStep({
      id: "memory",
      kind: "memory",
      status: "running",
    });
    await recorder.recordStep({
      id: "memory",
      kind: "memory",
      status: "completed",
      data: { availableCount: 2, recalledCount: 1 },
    });
    await recorder.setPhase("processing");
    await recorder.setPhase("answering");
    await recorder.setPhase("processing");
    await recorder.finish("completed");

    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((event) => event.phase)).toEqual([
      "preparing",
      "preparing",
      "preparing",
      "processing",
      "answering",
      "completed",
    ]);
    expect(recorder.snapshot()).toMatchObject({
      runId: "run-1",
      phase: "completed",
      firstContentAt: expect.any(String),
      steps: [{ id: "memory", status: "completed" }],
    });
  });

  it("终态自动收敛仍在运行的步骤", async () => {
    const events: ChatProcessEvent[] = [];
    const recorder = new ChatProcessRecorder({
      runId: "run-2",
      now: advancingClock(),
      emit: (event) => events.push(event),
    });

    await recorder.recordStep({ id: "rag", kind: "rag", status: "running" });
    await recorder.finish("interrupted");

    expect(recorder.snapshot()?.steps[0]).toMatchObject({ status: "interrupted" });
    expect(events.at(-2)).toMatchObject({ action: "step", step: { status: "interrupted" } });
    expect(events.at(-1)).toMatchObject({ action: "phase", phase: "interrupted" });
  });

  it("事件发送失败只降级轨迹", async () => {
    const onEmitError = vi.fn();
    const recorder = new ChatProcessRecorder({
      runId: "run-3",
      now: advancingClock(),
      emit: () => { throw new Error("socket closed"); },
      onEmitError,
    });

    await expect(recorder.start()).resolves.toBeUndefined();
    await expect(recorder.finish("failed")).resolves.toBeUndefined();
    expect(recorder.getEmitFailureCount()).toBe(2);
    expect(onEmitError).toHaveBeenCalledTimes(2);
    expect(recorder.snapshot()?.phase).toBe("failed");
  });
});

describe("Chat process contract", () => {
  it("拒绝额外敏感字段", () => {
    const event = {
      type: "trace",
      version: 1,
      action: "step",
      runId: "run-1",
      seq: 1,
      at: "2026-08-07T00:00:00.000Z",
      phase: "preparing",
      step: {
        id: "prompt",
        kind: "prompt",
        status: "completed",
        data: {
          fullMessageCount: 2,
          sentMessageCount: 2,
          tokenEstimate: 10,
          secret: "SENTINEL",
        },
      },
    };

    expect(isChatProcessEvent(event)).toBe(false);
  });

  it("按 run 追加快照且替换同 run", () => {
    const first = {
      runId: "run-1",
      phase: "completed" as const,
      steps: [],
      startedAt: "2026-08-07T00:00:00.000Z",
    };
    const second = {
      runId: "run-2",
      phase: "interrupted" as const,
      steps: [],
      startedAt: "2026-08-07T00:01:00.000Z",
    };

    const snapshot = appendChatProcessRun(appendChatProcessRun(undefined, first), second);
    const replaced = appendChatProcessRun(snapshot, { ...first, phase: "failed" });

    expect(snapshot.runs.map((run) => run.runId)).toEqual(["run-1", "run-2"]);
    expect(replaced.runs.map((run) => run.runId)).toEqual(["run-2", "run-1"]);
    expect(isChatProcessSnapshot(replaced)).toBe(true);
  });
});
