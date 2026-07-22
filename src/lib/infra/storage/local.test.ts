import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { LocalDriver } from "@/lib/infra/storage/local";

describe("LocalDriver.get", () => {
  let rootDir: string;
  let outsidePath: string;
  let driver: LocalDriver;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "nekusora-storage-"));
    outsidePath = join(dirname(rootDir), `${basename(rootDir)}-outside.txt`);
    driver = new LocalDriver({ rootDir });
    await driver.put("sample.txt", Buffer.from("0123456789"), "text/plain");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsidePath, { force: true });
  });

  it("只读取指定的闭区间字节", async () => {
    const content = await driver.get("sample.txt", { start: 2, end: 5 });

    expect(content.toString()).toBe("2345");
  });

  it("未指定范围时保持全量读取", async () => {
    const content = await driver.get("sample.txt");

    expect(content.toString()).toBe("0123456789");
  });

  it("put 拒绝越界相对 key 且不创建外部文件", async () => {
    const key = join("..", basename(outsidePath));

    await expect(
      driver.put(key, Buffer.from("owned"), "text/plain"),
    ).rejects.toThrow("storage_key_outside_root");
    await expect(readFile(outsidePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("get 拒绝越界相对 key", async () => {
    await writeFile(outsidePath, "secret");

    await expect(
      driver.get(join("..", basename(outsidePath))),
    ).rejects.toThrow("storage_key_outside_root");
  });

  it("delete 拒绝越界相对 key 且不删除外部文件", async () => {
    await writeFile(outsidePath, "secret");

    await expect(
      driver.delete(join("..", basename(outsidePath))),
    ).rejects.toThrow("storage_key_outside_root");
    await expect(readFile(outsidePath, "utf8")).resolves.toBe("secret");
  });

  it("exists 对越界 key 返回 false", async () => {
    await writeFile(outsidePath, "secret");

    await expect(
      driver.exists(join("..", basename(outsidePath))),
    ).resolves.toBe(false);
  });

  it("合法嵌套 key 与历史绝对路径保持可读", async () => {
    await driver.put("nested/sample.txt", Buffer.from("nested"), "text/plain");
    await writeFile(outsidePath, "legacy");

    await expect(driver.get("nested/sample.txt")).resolves.toEqual(
      Buffer.from("nested"),
    );
    await expect(driver.get(outsidePath)).resolves.toEqual(Buffer.from("legacy"));
  });
});
