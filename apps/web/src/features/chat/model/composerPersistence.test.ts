import { describe, expect, it, vi } from "vitest";
import { LatestSnapshotWriter } from "./composerPersistence";

interface Snapshot {
  value: string;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

const equals = (left: Snapshot, right: Snapshot) => left.value === right.value;

describe("LatestSnapshotWriter", () => {
  it("keeps one request in flight and writes only the latest pending snapshot", async () => {
    const writes: Array<{ scope: string; snapshot: Snapshot; task: ReturnType<typeof deferred> }> = [];
    const write = vi.fn((scope: string, snapshot: Snapshot) => {
      const task = deferred();
      writes.push({ scope, snapshot, task });
      return task.promise;
    });
    const statuses: string[] = [];
    const writer = new LatestSnapshotWriter({
      scopeId: "conversation-a",
      initialSnapshot: { value: "initial" },
      write,
      equals,
      onStatusChange: (status) => statuses.push(status),
    });

    writer.update({ value: "first" });
    writer.update({ value: "second" });
    writer.update({ value: "latest" });

    expect(write).toHaveBeenCalledTimes(1);
    expect(writes[0]).toMatchObject({ scope: "conversation-a", snapshot: { value: "first" } });

    writes[0].task.resolve();
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(2);
    expect(writes[1]).toMatchObject({ scope: "conversation-a", snapshot: { value: "latest" } });

    writes[1].task.resolve();
    await writer.whenIdle();
    expect(statuses.at(-1)).toBe("idle");
  });

  it("keeps the latest dirty snapshot after failure and retries that snapshot", async () => {
    const first = deferred();
    const second = deferred();
    const write = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const statuses: string[] = [];
    const writer = new LatestSnapshotWriter({
      scopeId: "conversation-a",
      initialSnapshot: { value: "initial" },
      write,
      equals,
      onStatusChange: (status) => statuses.push(status),
    });

    writer.update({ value: "failed" });
    first.reject(new Error("private failure"));
    await flushMicrotasks();
    expect(statuses.at(-1)).toBe("error");

    writer.update({ value: "latest" });
    expect(write).toHaveBeenLastCalledWith("conversation-a", { value: "latest" });
    second.resolve();
    await writer.whenIdle();
    expect(statuses.at(-1)).toBe("idle");
  });

  it("does not write a draft until adoption and then writes only changes after the create snapshot", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writer = new LatestSnapshotWriter({
      scopeId: null,
      initialSnapshot: { value: "draft-initial" },
      write,
      equals,
    });

    writer.update({ value: "draft-created" });
    expect(write).not.toHaveBeenCalled();

    writer.adoptScope("conversation-new", { value: "draft-created" });
    await writer.whenIdle();
    expect(write).not.toHaveBeenCalled();

    writer.update({ value: "changed-during-create" });
    await writer.whenIdle();
    expect(write).toHaveBeenCalledWith("conversation-new", { value: "changed-during-create" });
  });

  it("fences an old scope completion before draining the new scope", async () => {
    const first = deferred();
    const write = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const statuses: string[] = [];
    const writer = new LatestSnapshotWriter({
      scopeId: "conversation-a",
      initialSnapshot: { value: "a-initial" },
      write,
      equals,
      onStatusChange: (status) => statuses.push(status),
    });

    writer.update({ value: "a-latest" });
    writer.adoptScope("conversation-b", { value: "b-initial" });
    writer.update({ value: "b-latest" });
    first.reject(new Error("old scope failed"));

    await writer.whenIdle();
    expect(write).toHaveBeenNthCalledWith(1, "conversation-a", { value: "a-latest" });
    expect(write).toHaveBeenNthCalledWith(2, "conversation-b", { value: "b-latest" });
    expect(statuses.at(-1)).toBe("idle");
  });

  it("stops draining while disposed and resumes with only the latest snapshot", async () => {
    const first = deferred();
    const second = deferred();
    const write = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const writer = new LatestSnapshotWriter({
      scopeId: "conversation-a",
      initialSnapshot: { value: "initial" },
      write,
      equals,
    });

    writer.update({ value: "first" });
    writer.update({ value: "latest" });
    writer.dispose();
    first.resolve();
    await flushMicrotasks();

    expect(write).toHaveBeenCalledTimes(1);

    writer.resume();
    expect(write).toHaveBeenNthCalledWith(2, "conversation-a", { value: "latest" });
    second.resolve();
    await writer.whenIdle();
  });

  it("treats falsy generic values as snapshots instead of the empty sentinel", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writer = new LatestSnapshotWriter({
      scopeId: "conversation-a",
      initialSnapshot: 1,
      write,
      equals: (left, right) => left === right,
    });

    writer.update(0);
    await writer.whenIdle();

    expect(write).toHaveBeenCalledWith("conversation-a", 0);
  });
});
