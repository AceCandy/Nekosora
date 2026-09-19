import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { modelCatalog } from "@nekusora/db/schema";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDb: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@nekusora/core/infra/db", () => ({
  getDb: mocks.getDb,
  getSchema: () => ({ modelCatalog }),
}));

import { setCatalogImageGeneration } from "./catalog-actions";

describe("目录图像生成能力", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin" });
    mocks.returning.mockResolvedValue([{ id: "catalog-chat" }]);
    mocks.where.mockReturnValue({ returning: mocks.returning });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.getDb.mockResolvedValue({ update: () => ({ set: mocks.set }) });
  });

  it.each([true, false])("原子保存 %s，仅修改目标能力并刷新入口", async (enabled) => {
    await setCatalogImageGeneration("catalog-chat", enabled);
    const patch = mocks.set.mock.calls[0][0] as { capabilities: SQL; updatedAt: SQL };
    const dialect = new PgDialect();
    expect(Object.keys(patch).sort()).toEqual(["capabilities", "updatedAt"]);
    expect(dialect.sqlToQuery(patch.capabilities)).toMatchObject({
      sql: '"model_catalog"."capabilities" || $1::jsonb',
      params: [JSON.stringify({ imageGeneration: enabled })],
    });
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0])).toMatchObject({
      sql: '"model_catalog"."id" = $1', params: ["catalog-chat"],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/panel/models");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/models");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/image");
  });

  it("非管理员不可写入", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(setCatalogImageGeneration("catalog-chat", true)).rejects.toThrow("FORBIDDEN");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("原子合并出图方式，不改变其他目录能力", async () => {
    await setCatalogImageGeneration("catalog-chat", true, "openai-responses");
    const patch = mocks.set.mock.calls[0][0] as { capabilities: SQL };
    expect(new PgDialect().sqlToQuery(patch.capabilities).params).toEqual([
      JSON.stringify({ imageGeneration: true, imageGenerationFormat: "openai-responses" }),
    ]);
  });

  it("拒绝无效输入", async () => {
    await expect(setCatalogImageGeneration(" ", true)).rejects.toThrow();
    // @ts-expect-error 模拟绕过客户端类型的非法请求。
    await expect(setCatalogImageGeneration("catalog-chat", "true")).rejects.toThrow();
    // @ts-expect-error 模拟非法出图协议。
    await expect(setCatalogImageGeneration("catalog-chat", true, "unknown")).rejects.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("不存在的模板不能报告保存成功", async () => {
    mocks.returning.mockResolvedValue([]);
    await expect(setCatalogImageGeneration("missing", true)).rejects.toThrow("MODEL_CATALOG_NOT_FOUND");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
