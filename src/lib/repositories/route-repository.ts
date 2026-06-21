/**
 * RouteRepository —— 路由解析的数据访问抽象。
 *
 * 目的:把 routing.ts 的业务逻辑与 Drizzle ORM 解耦,使其可测试。
 *   - 生产:DrizzleRouteRepository(默认,读真实 DB)
 *   - 测试:可注入内存 mock,验证路由决策逻辑而无需 DB
 *
 * 返回类型用 `any`(原始 schema 行),保持与现有代码一致的灵活性,
 * 避免为每个表生成精确类型(那是 schema 层的职责)。
 */
import type { CallContext } from "@/lib/providers/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface RouteRepository {
  /** 查找已启用的全局模型(by name)。 */
  findEnabledGlobalModel(modelName: string): Promise<Row | null>;

  /** 查找已启用的用户 BYO 模型(by name + userId)。 */
  findEnabledUserModel(modelName: string, userId: string): Promise<Row | null>;

  /** 查找 sub key 绑定的全局/用户模型 ID 集合(用于绑定校验)。 */
  findKeyModelBindings(keyId: string): Promise<{
    globalModelIds: Set<string>;
    userModelIds: Set<string>;
  }>;

  /** 查找全局模型的路由链(join providers,按 priority 升序)。 */
  findEnabledGlobalRoutes(
    modelId: string,
  ): Promise<Array<{ route: Row; provider: Row }>>;

  /** 查找 BYO 模型对应的已启用 provider。 */
  findEnabledUserProvider(providerId: string): Promise<Row | null>;
}

// ===== Drizzle 默认实现 =====

import { eq, and, asc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";

export class DrizzleRouteRepository implements RouteRepository {
  async findEnabledGlobalModel(modelName: string): Promise<Row | null> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const [row] = await db
      .select()
      .from(s.globalModels)
      .where(and(eq(s.globalModels.name, modelName), eq(s.globalModels.enabled, true)))
      .limit(1);
    return row ?? null;
  }

  async findEnabledUserModel(modelName: string, userId: string): Promise<Row | null> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const [row] = await db
      .select()
      .from(s.userModels)
      .where(
        and(
          eq(s.userModels.name, modelName),
          eq(s.userModels.userId, userId),
          eq(s.userModels.enabled, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findKeyModelBindings(keyId: string): Promise<{
    globalModelIds: Set<string>;
    userModelIds: Set<string>;
  }> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const bindings = await db
      .select()
      .from(s.keyModelBindings)
      .where(eq(s.keyModelBindings.keyId, keyId));
    return {
      // 注意:scope 值沿用历史命名 —— "global"(全局模型)和 "byo"(用户模型)。
      globalModelIds: new Set(
        bindings
          .filter((b: Row) => b.scope === "global" && b.globalModelId)
          .map((b: Row) => b.globalModelId),
      ),
      userModelIds: new Set(
        bindings
          .filter((b: Row) => b.scope === "byo" && b.userModelId)
          .map((b: Row) => b.userModelId),
      ),
    };
  }

  async findEnabledGlobalRoutes(
    modelId: string,
  ): Promise<Array<{ route: Row; provider: Row }>> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    return db
      .select({
        route: s.globalRoutes,
        provider: s.globalProviders,
      })
      .from(s.globalRoutes)
      .innerJoin(
        s.globalProviders,
        eq(s.globalRoutes.providerId, s.globalProviders.id),
      )
      .where(
        and(
          eq(s.globalRoutes.modelId, modelId),
          eq(s.globalRoutes.enabled, true),
          eq(s.globalProviders.enabled, true),
        ),
      )
      .orderBy(asc(s.globalRoutes.priority));
  }

  async findEnabledUserProvider(providerId: string): Promise<Row | null> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const [row] = await db
      .select()
      .from(s.userProviders)
      .where(
        and(
          eq(s.userProviders.id, providerId),
          eq(s.userProviders.enabled, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}

/** 当前生效的 Repository 实例(默认 Drizzle;测试可覆盖)。 */
let currentRepo: RouteRepository = new DrizzleRouteRepository();

/** 获取当前 Repository(业务代码用)。 */
export function getRouteRepository(): RouteRepository {
  return currentRepo;
}

/**
 * 覆盖 Repository(仅测试用)。
 * 用完记得调 resetRouteRepository() 恢复,避免污染其他测试。
 */
export function setRouteRepository(repo: RouteRepository): void {
  currentRepo = repo;
}

/** 恢复默认 Drizzle 实现(测试 cleanup 用)。 */
export function resetRouteRepository(): void {
  currentRepo = new DrizzleRouteRepository();
}

// CallContext 重新导出,方便业务层单文件 import。
export type { CallContext };
