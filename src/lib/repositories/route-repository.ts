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
  /** 按 id 查找已启用模型(单条,无歧义)。 */
  findEnabledModelById(modelId: string): Promise<Row | null>;

  /** 按 name + ownerUserId 查找已启用模型(网关 owner-only 路径)。 */
  findEnabledModelByNameForOwner(
    modelName: string,
    userId: string,
  ): Promise<Row | null>;

  /** 查找模型的路由链(join providers,按 priority 升序)。 */
  findEnabledRoutes(
    modelId: string,
  ): Promise<Array<{ route: Row; provider: Row }>>;

  /** 按 id 查找已启用 provider。 */
  findEnabledProvider(providerId: string): Promise<Row | null>;

  /** 查找 sub key 绑定的模型 ID 集合(用于绑定校验)。 */
  findKeyModelBindings(keyId: string): Promise<{ modelIds: Set<string> }>;
}

// ===== Drizzle 默认实现 =====

import { eq, and, asc } from "drizzle-orm";
import { getDb, getSchema } from "@/lib/infra/db";

export class DrizzleRouteRepository implements RouteRepository {
  async findEnabledModelById(modelId: string): Promise<Row | null> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const [row] = await db
      .select()
      .from(s.models)
      .where(and(eq(s.models.id, modelId), eq(s.models.enabled, true)))
      .limit(1);
    return row ?? null;
  }

  async findEnabledModelByNameForOwner(
    modelName: string,
    userId: string,
  ): Promise<Row | null> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const [row] = await db
      .select()
      .from(s.models)
      .where(
        and(
          eq(s.models.name, modelName),
          eq(s.models.ownerUserId, userId),
          eq(s.models.enabled, true),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findEnabledRoutes(
    modelId: string,
  ): Promise<Array<{ route: Row; provider: Row }>> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    return db
      .select({
        route: s.routes,
        provider: s.providers,
      })
      .from(s.routes)
      .innerJoin(s.providers, eq(s.routes.providerId, s.providers.id))
      .where(
        and(
          eq(s.routes.modelId, modelId),
          eq(s.routes.enabled, true),
          eq(s.providers.enabled, true),
        ),
      )
      .orderBy(asc(s.routes.priority));
  }

  async findEnabledProvider(providerId: string): Promise<Row | null> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const [row] = await db
      .select()
      .from(s.providers)
      .where(and(eq(s.providers.id, providerId), eq(s.providers.enabled, true)))
      .limit(1);
    return row ?? null;
  }

  async findKeyModelBindings(keyId: string): Promise<{ modelIds: Set<string> }> {
    const db = await getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = getSchema() as any;
    const bindings = await db
      .select()
      .from(s.keyModelBindings)
      .where(eq(s.keyModelBindings.keyId, keyId));
    return {
      modelIds: new Set(
        bindings.filter((b: Row) => b.modelId).map((b: Row) => b.modelId),
      ),
    };
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
