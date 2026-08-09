import { eq } from "drizzle-orm";
import { getSchema } from "@/lib/infra/db";
import {
  routeApiFormatForModel,
  type ModelType,
  type ProviderProtocol,
  type RouteApiFormat,
} from "@/db/types";

/** 从模型目录读取类型并校验 route wire format。 */
export async function resolveModelRouteApiFormat(
  db: unknown,
  modelId: string,
  protocol: ProviderProtocol,
  value?: string | null,
): Promise<RouteApiFormat> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [model] = await (db as any)
    .select({ catalogId: s.models.catalogId })
    .from(s.models)
    .where(eq(s.models.id, modelId))
    .limit(1);
  if (!model) throw new Error("模型不存在");
  return resolveCatalogRouteApiFormat(db, model.catalogId as string, protocol, value);
}

/** 新建模型尚无 modelId 时，按所选目录项校验 route wire format。 */
export async function resolveCatalogRouteApiFormat(
  db: unknown,
  catalogId: string,
  protocol: ProviderProtocol,
  value?: string | null,
): Promise<RouteApiFormat> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [catalog] = await (db as any)
    .select({ modelType: s.modelCatalog.modelType })
    .from(s.modelCatalog)
    .where(eq(s.modelCatalog.id, catalogId))
    .limit(1);
  if (!catalog) throw new Error("模型模板不存在或已禁用");
  return routeApiFormatForModel(value, protocol, catalog.modelType as ModelType);
}
