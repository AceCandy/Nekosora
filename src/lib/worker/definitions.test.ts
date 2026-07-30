import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processFile: vi.fn(),
  recoverStaleFileProcessing: vi.fn(),
  processMemoryExtractionJob: vi.fn(),
  recoverMemoryExtractionJobs: vi.fn(),
  processConversationTitleJob: vi.fn(),
  recoverConversationTitleJobs: vi.fn(),
}));

vi.mock("@/lib/rag/processing-coordinator", () => ({
  processFile: mocks.processFile,
}));
vi.mock("@/lib/rag/recovery", () => ({
  recoverStaleFileProcessing: mocks.recoverStaleFileProcessing,
}));
vi.mock("@/lib/memory/jobs", () => ({
  processMemoryExtractionJob: mocks.processMemoryExtractionJob,
}));
vi.mock("@/lib/memory/dispatch", () => ({
  recoverMemoryExtractionJobs: mocks.recoverMemoryExtractionJobs,
}));
vi.mock("@/lib/conversation-title/service", () => ({
  processConversationTitleJob: mocks.processConversationTitleJob,
}));
vi.mock("@/lib/conversation-title/dispatch", () => ({
  recoverConversationTitleJobs: mocks.recoverConversationTitleJobs,
}));

import {
  CONVERSATION_TITLE_QUEUE,
  FILE_PROCESS_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
} from "@/lib/jobs/catalog";
import { WORKER_DEFINITIONS } from "./definitions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.processFile.mockResolvedValue("completed");
  mocks.processMemoryExtractionJob.mockResolvedValue("completed");
  mocks.processConversationTitleJob.mockResolvedValue("completed");
  mocks.recoverStaleFileProcessing.mockResolvedValue(undefined);
  mocks.recoverMemoryExtractionJobs.mockResolvedValue(undefined);
  mocks.recoverConversationTitleJobs.mockResolvedValue(undefined);
});

describe("worker definitions", () => {
  it("按 catalog 顺序集中装配三个 handler 与 recovery", () => {
    expect(WORKER_DEFINITIONS.map((item) => item.job)).toEqual([
      FILE_PROCESS_QUEUE,
      MEMORY_EXTRACTION_QUEUE,
      CONVERSATION_TITLE_QUEUE,
    ]);
    expect(WORKER_DEFINITIONS.map((item) => item.recovery.intervalMs))
      .toEqual([60_000, 60_000, 60_000]);
    expect(WORKER_DEFINITIONS.map((item) => item.recovery.failureMessage)).toEqual([
      "[file-processing-recovery] scan failed",
      "[memory-extraction-recovery] scan failed",
      "[conversation-title-recovery] scan failed",
    ]);
  });

  it("handler 只投影 catalog payload 并传播 outcome", async () => {
    const [file, memory, title] = WORKER_DEFINITIONS;

    await expect(file!.handle({ fileId: "file-1" })).resolves.toBe("completed");
    await expect(memory!.handle({ id: "memory-1" })).resolves.toBe("completed");
    await expect(title!.handle({ id: "title-1" })).resolves.toBe("completed");

    expect(mocks.processFile).toHaveBeenCalledWith("file-1");
    expect(mocks.processMemoryExtractionJob).toHaveBeenCalledWith("memory-1");
    expect(mocks.processConversationTitleJob).toHaveBeenCalledWith("title-1");
  });

  it("recovery definition 只运行一轮领域扫描", async () => {
    await Promise.all(WORKER_DEFINITIONS.map((item) => item.recovery.run()));

    expect(mocks.recoverStaleFileProcessing).toHaveBeenCalledOnce();
    expect(mocks.recoverMemoryExtractionJobs).toHaveBeenCalledOnce();
    expect(mocks.recoverConversationTitleJobs).toHaveBeenCalledOnce();
  });
});
