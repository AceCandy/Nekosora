import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { getDb, getSchema } from "./index";

const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  end: vi.fn(),
  drizzle: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(options: unknown) { mocks.pool(options); }
      end() { return mocks.end(); }
    },
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
vi.mock("@nekusora/db/schema", () => ({ apiKeys: { name: "api_keys" } }));

describe("database factory", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/factory_test");
    vi.stubEnv("DB_POOL_MAX", "20");
    mocks.end.mockResolvedValue(undefined);
    mocks.drizzle.mockImplementation(({ client }) => ({ $client: client }));
  });

  afterEach(async () => {
    const { closeDb } = await import("./index");
    await closeDb();
    vi.unstubAllEnvs();
  });

  it("公共入口保留数据库、连接池与表字段类型", () => {
    type Schema = typeof import("@nekusora/db/schema");
    expectTypeOf<ReturnType<typeof getSchema>>().not.toBeAny();
    expectTypeOf<ReturnType<typeof getSchema>>().toEqualTypeOf<Schema>();
    expectTypeOf<Awaited<ReturnType<typeof getDb>>>().not.toBeAny();
    expectTypeOf<Awaited<ReturnType<typeof getDb>>>()
      .toEqualTypeOf<NodePgDatabase<Schema> & { $client: Pool }>();
    expectTypeOf<ReturnType<typeof getSchema>["apiKeys"]["$inferSelect"]["enabled"]>()
      .toEqualTypeOf<boolean>();
  });

  it("初始化前拒绝访问 Schema，并发获取只创建一个连接池", async () => {
    const { getDb, getSchema } = await import("./index");
    expect(() => getSchema()).toThrow("schema 尚未加载,请先 await getDb()");
    const first = getDb();
    const second = getDb();
    expect(second).toBe(first);
    const [db, sameDb] = await Promise.all([first, second]);
    expect(sameDb).toBe(db);
    expect(await getDb()).toBe(db);
    expect(mocks.pool).toHaveBeenCalledExactlyOnceWith({
      connectionString: "postgresql://localhost/factory_test", max: 20,
    });
    expect(mocks.drizzle).toHaveBeenCalledExactlyOnceWith({ client: db.$client, schema: getSchema() });
    expect(getSchema()).toMatchObject({ apiKeys: { name: "api_keys" } });
  });

  it("初始化失败后允许修正配置重试", async () => {
    const { getDb } = await import("./index");
    vi.stubEnv("DATABASE_URL", "");
    await expect(getDb()).rejects.toThrow("未配置 DATABASE_URL(仅支持 PostgreSQL)。");
    expect(mocks.pool).not.toHaveBeenCalled();
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/factory_test");
    await expect(getDb()).resolves.toHaveProperty("$client");
    expect(mocks.pool).toHaveBeenCalledOnce();
  });

  it.each(["0", "-1", "1.5", "invalid"])("拒绝非法连接池上限 %s", async (value) => {
    const { getDb } = await import("./index");
    vi.stubEnv("DB_POOL_MAX", value);
    await expect(getDb()).rejects.toThrow("DB_POOL_MAX 非法,期望正整数");
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it("关闭等待在途初始化，清空缓存后可创建新连接", async () => {
    const { closeDb, getDb, getSchema } = await import("./index");
    const initializing = getDb();
    await closeDb();
    const first = await initializing;
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(() => getSchema()).toThrow("schema 尚未加载");
    expect(await getDb()).not.toBe(first);
    expect(mocks.pool).toHaveBeenCalledTimes(2);
    await closeDb();
    await closeDb();
    expect(mocks.end).toHaveBeenCalledTimes(2);
  });
});
