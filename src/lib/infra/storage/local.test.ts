import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDriver } from "@/lib/infra/storage/local";

describe("LocalDriver.get", () => {
  let rootDir: string;
  let driver: LocalDriver;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nekusora-storage-"));
    driver = new LocalDriver({ rootDir });
    await driver.put("sample.txt", Buffer.from("0123456789"), "text/plain");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("只读取指定的闭区间字节", async () => {
    const content = await driver.get("sample.txt", { start: 2, end: 5 });

    expect(content.toString()).toBe("2345");
  });

  it("未指定范围时保持全量读取", async () => {
    const content = await driver.get("sample.txt");

    expect(content.toString()).toBe("0123456789");
  });
});
