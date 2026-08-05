export type ComposerSyncStatus = "idle" | "saving" | "error";

interface LatestSnapshotWriterOptions<T> {
  scopeId: string | null;
  initialSnapshot: T;
  write: (scopeId: string, snapshot: T) => Promise<void>;
  equals: (left: T, right: T) => boolean;
  onStatusChange?: (status: ComposerSyncStatus) => void;
}

export class LatestSnapshotWriter<T> {
  private scopeId: string | null;
  private latestSnapshot: T;
  private persistedSnapshot: T;
  private pendingSnapshot: T | null = null;
  private write: LatestSnapshotWriterOptions<T>["write"];
  private readonly equals: LatestSnapshotWriterOptions<T>["equals"];
  private readonly onStatusChange?: LatestSnapshotWriterOptions<T>["onStatusChange"];
  private status: ComposerSyncStatus = "idle";
  private generation = 0;
  private inFlight = false;
  private blocked = false;
  private disposed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(options: LatestSnapshotWriterOptions<T>) {
    this.scopeId = options.scopeId;
    this.latestSnapshot = options.initialSnapshot;
    this.persistedSnapshot = options.initialSnapshot;
    this.write = options.write;
    this.equals = options.equals;
    this.onStatusChange = options.onStatusChange;
  }

  setWrite(write: LatestSnapshotWriterOptions<T>["write"]): void {
    this.write = write;
  }

  update(snapshot: T): void {
    if (this.disposed) return;
    this.latestSnapshot = snapshot;
    if (!this.scopeId) return;
    this.pendingSnapshot = snapshot;
    this.blocked = false;
    this.drain();
  }

  adoptScope(scopeId: string, persistedSnapshot: T): void {
    if (this.disposed) return;
    this.generation += 1;
    this.scopeId = scopeId;
    this.persistedSnapshot = persistedSnapshot;
    this.pendingSnapshot = this.equals(this.latestSnapshot, persistedSnapshot)
      ? null
      : this.latestSnapshot;
    this.blocked = false;
    this.drain();
  }

  retry(): void {
    if (this.disposed || !this.scopeId) return;
    this.pendingSnapshot = this.latestSnapshot;
    this.blocked = false;
    this.drain();
  }

  resume(): void {
    // React Strict Mode 会重放 effect；仅在 cleanup 已停用 writer 后恢复。
    if (!this.disposed) return;
    this.disposed = false;
    this.blocked = false;
    this.pendingSnapshot = this.scopeId && !this.equals(this.latestSnapshot, this.persistedSnapshot)
      ? this.latestSnapshot
      : null;
    this.drain();
  }

  whenIdle(): Promise<void> {
    if (this.isQuiescent()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pendingSnapshot = null;
    this.blocked = true;
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  private isQuiescent(): boolean {
    return !this.inFlight
      && (!this.scopeId || this.blocked || this.pendingSnapshot === null);
  }

  private setStatus(status: ComposerSyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (!this.disposed) this.onStatusChange?.(status);
  }

  private settleWaiters(): void {
    if (!this.isQuiescent()) return;
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  private drain(): void {
    if (this.disposed || this.inFlight || this.blocked || !this.scopeId) {
      this.settleWaiters();
      return;
    }

    const snapshot = this.pendingSnapshot;
    if (snapshot === null) {
      this.setStatus("idle");
      this.settleWaiters();
      return;
    }
    this.pendingSnapshot = null;
    if (this.equals(snapshot, this.persistedSnapshot)) {
      this.setStatus("idle");
      this.settleWaiters();
      return;
    }

    const scopeId = this.scopeId;
    const generation = this.generation;
    this.inFlight = true;
    this.setStatus("saving");
    void this.write(scopeId, snapshot).then(
      () => this.finishWrite(generation, snapshot, true),
      () => this.finishWrite(generation, snapshot, false),
    );
  }

  private finishWrite(generation: number, snapshot: T, succeeded: boolean): void {
    this.inFlight = false;
    if (generation !== this.generation) {
      this.drain();
      return;
    }

    if (succeeded) {
      this.persistedSnapshot = snapshot;
      if (this.pendingSnapshot && this.equals(this.pendingSnapshot, snapshot)) {
        this.pendingSnapshot = null;
      }
      this.drain();
      return;
    }

    this.pendingSnapshot = this.latestSnapshot;
    this.blocked = true;
    this.setStatus("error");
    this.settleWaiters();
  }
}
