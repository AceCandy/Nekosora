import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../infra/db/index";
import { parseGatewayGovernancePolicy } from "../gateway-governance/policy";
import {
  mergeSettingsChange,
  parseSettingsChanges,
  type OutputModeSnapshot,
  type RenderStyleSnapshot,
  type SettingsChange,
  type SettingsSnapshot,
  type SystemSettingSnapshot,
} from "./changes";

const CONTROL_STATE_ID = "global";
const ALLOWED_SYSTEM_SETTINGS = new Set([
  "gateway:chat_ua",
  "gateway:gateway_ua",
  "gateway:request_governance_v1",
  "rag:embedding_provider_id",
  "rag:embedding_model",
  "rag:mem0_llm_model_id",
  "rag:mem0_llm_model",
  "task:title_model_id",
  "task:title_model",
  "task:compact_model_id",
  "task:compact_model",
]);

interface SqlExecutor {
  execute(query: unknown): Promise<unknown>;
}

interface SettingsDatabase extends SqlExecutor {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface SettingsSaveResult {
  revision: number;
  changed: boolean;
}

export interface SettingsControlView {
  currentRevision: number;
}

export class SettingsConflictError extends Error {
  readonly code = "settings_conflict";

  constructor(message = "设置已变化，请刷新后核对再保存") {
    super(message);
    this.name = "SettingsConflictError";
  }
}

export class SettingsValidationError extends Error {
  readonly code = "settings_validation_failed";

  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export async function getSettingsControlView(): Promise<SettingsControlView> {
  return { currentRevision: await getSettingsRevision() };
}

export async function getSettingsRevision(): Promise<number> {
  const db = await getSettingsDb();
  const result = await db.execute(sql`
    SELECT "current_revision" FROM "settings_control_state" WHERE "id" = ${CONTROL_STATE_ID}
  `);
  const [row] = rowsOf<{ current_revision: number | string }>(result);
  if (!row) throw new Error("设置控制状态不存在");
  return integerValue(row.current_revision);
}

export async function saveSystemSettings(input: {
  actorId: string;
  expected: number;
  namespace: string;
  values: Record<string, string>;
}): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    let next = changes;
    for (const [key, rawValue] of Object.entries(input.values)) {
      const resourceKey = systemResourceKey(input.namespace, key);
      const current = await projectedSnapshot(tx, next, resourceKey, () => (
        loadSystemSetting(tx, input.namespace, key)
      ));
      const value = canonicalSystemValue(input.namespace, key, rawValue);
      next = mergeSettingsChange(next, {
        resource: "system_setting",
        resourceKey,
        before: current.before as SystemSettingSnapshot | null,
        after: value === "" ? null : { namespace: input.namespace, key, value },
      });
    }
    return next;
  });
}

export async function saveOutputModeCreate(input: {
  actorId: string;
  expected: number;
  value: Pick<OutputModeSnapshot, "name" | "description" | "systemPrompt" | "icon">;
}): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    const modes = await projectedOutputModes(tx, changes);
    const id = randomUUID();
    const snapshot: OutputModeSnapshot = {
      id,
      name: input.value.name.trim(),
      description: input.value.description,
      systemPrompt: input.value.systemPrompt.trim(),
      icon: input.value.icon,
      enabled: true,
      sortOrder: Math.max(-1, ...modes.map((mode) => mode.sortOrder)) + 1,
    };
    return mergeSettingsChange(changes, {
      resource: "output_mode",
      resourceKey: `output-mode:${id}`,
      before: null,
      after: snapshot,
    });
  });
}

export async function saveOutputModeUpdate(input: {
  actorId: string;
  expected: number;
  id: string;
  patch: Partial<Pick<
    OutputModeSnapshot,
    "name" | "description" | "systemPrompt" | "icon" | "enabled"
  >>;
}): Promise<SettingsSaveResult> {
  return mutateOutputMode(input, (current) => ({
    ...current,
    ...input.patch,
    ...(input.patch.name !== undefined ? { name: input.patch.name.trim() } : {}),
    ...(input.patch.systemPrompt !== undefined
      ? { systemPrompt: input.patch.systemPrompt.trim() }
      : {}),
  }));
}

export async function saveOutputModeDelete(input: {
  actorId: string;
  expected: number;
  id: string;
}): Promise<SettingsSaveResult> {
  return mutateOutputMode(input, () => null);
}

export async function saveOutputModeReorder(input: {
  actorId: string;
  expected: number;
  orderedIds: string[];
}): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    const modes = await projectedOutputModes(tx, changes);
    requireExactOrder(modes.map((mode) => mode.id), input.orderedIds);
    let next = changes;
    for (const [sortOrder, id] of input.orderedIds.entries()) {
      const mode = modes.find((candidate) => candidate.id === id)!;
      if (mode.sortOrder === sortOrder) continue;
      const current = await projectedSnapshot(tx, next, `output-mode:${id}`, () => (
        loadOutputMode(tx, id)
      ));
      next = mergeSettingsChange(next, {
        resource: "output_mode",
        resourceKey: `output-mode:${id}`,
        before: current.before as OutputModeSnapshot | null,
        after: { ...mode, sortOrder },
      });
    }
    return next;
  });
}

export async function saveRenderStyleCreate(input: {
  actorId: string;
  expected: number;
  value: Pick<RenderStyleSnapshot, "name" | "description" | "cssClass" | "css" | "icon">;
}): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    const styles = await projectedRenderStyles(tx, changes);
    const id = randomUUID();
    const snapshot: RenderStyleSnapshot = {
      id,
      name: input.value.name.trim(),
      description: input.value.description,
      cssClass: input.value.cssClass.trim(),
      css: input.value.css.trim(),
      icon: input.value.icon,
      renderer: "streamdown",
      builtin: false,
      enabled: true,
      sortOrder: Math.max(-1, ...styles.map((style) => style.sortOrder)) + 1,
    };
    assertCssClassAvailable(styles, snapshot.cssClass);
    return mergeSettingsChange(changes, {
      resource: "render_style",
      resourceKey: `render-style:${id}`,
      before: null,
      after: snapshot,
    });
  });
}

export async function saveRenderStyleUpdate(input: {
  actorId: string;
  expected: number;
  id: string;
  patch: Partial<Pick<
    RenderStyleSnapshot,
    "name" | "description" | "cssClass" | "css" | "icon" | "renderer" | "enabled"
  >>;
}): Promise<SettingsSaveResult> {
  return mutateRenderStyle(input, async (current, tx, changes) => {
    if (current.builtin && input.patch.cssClass !== undefined
      && input.patch.cssClass !== current.cssClass) {
      throw new SettingsValidationError("系统内置样式不能修改 CSS 标识");
    }
    const next = {
      ...current,
      ...input.patch,
      ...(input.patch.name !== undefined ? { name: input.patch.name.trim() } : {}),
      ...(input.patch.css !== undefined ? { css: input.patch.css.trim() } : {}),
      ...(input.patch.cssClass !== undefined ? { cssClass: input.patch.cssClass.trim() } : {}),
    };
    const styles = await projectedRenderStyles(tx, changes);
    assertCssClassAvailable(styles, next.cssClass, current.id);
    return next;
  });
}

export async function saveRenderStyleDelete(input: {
  actorId: string;
  expected: number;
  id: string;
}): Promise<SettingsSaveResult> {
  return mutateRenderStyle(input, (current) => {
    if (current.builtin) throw new SettingsValidationError("系统内置样式不可删除");
    return null;
  });
}

export async function saveRenderStyleReorder(input: {
  actorId: string;
  expected: number;
  orderedIds: string[];
}): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    const styles = await projectedRenderStyles(tx, changes);
    requireExactOrder(styles.map((style) => style.id), input.orderedIds);
    let next = changes;
    for (const [sortOrder, id] of input.orderedIds.entries()) {
      const style = styles.find((candidate) => candidate.id === id)!;
      if (style.sortOrder === sortOrder) continue;
      const current = await projectedSnapshot(tx, next, `render-style:${id}`, () => (
        loadRenderStyle(tx, id)
      ));
      next = mergeSettingsChange(next, {
        resource: "render_style",
        resourceKey: `render-style:${id}`,
        before: current.before as RenderStyleSnapshot | null,
        after: { ...style, sortOrder },
      });
    }
    return next;
  });
}

async function mutateOutputMode(
  input: { actorId: string; expected: number; id: string },
  mutate: (current: OutputModeSnapshot) => OutputModeSnapshot | null,
): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    const resourceKey = `output-mode:${input.id}`;
    const current = await projectedSnapshot(tx, changes, resourceKey, () => (
      loadOutputMode(tx, input.id)
    ));
    if (!current.after) throw new SettingsValidationError("输出模式不存在");
    return mergeSettingsChange(changes, {
      resource: "output_mode",
      resourceKey,
      before: current.before as OutputModeSnapshot | null,
      after: mutate(current.after as OutputModeSnapshot),
    });
  });
}

async function mutateRenderStyle(
  input: { actorId: string; expected: number; id: string },
  mutate: (
    current: RenderStyleSnapshot,
    tx: SqlExecutor,
    changes: SettingsChange[],
  ) => RenderStyleSnapshot | null | Promise<RenderStyleSnapshot | null>,
): Promise<SettingsSaveResult> {
  return mutateSettings(input.actorId, input.expected, async (tx, changes) => {
    const resourceKey = `render-style:${input.id}`;
    const current = await projectedSnapshot(tx, changes, resourceKey, () => (
      loadRenderStyle(tx, input.id)
    ));
    if (!current.after) throw new SettingsValidationError("输出样式不存在");
    return mergeSettingsChange(changes, {
      resource: "render_style",
      resourceKey,
      before: current.before as RenderStyleSnapshot | null,
      after: await mutate(current.after as RenderStyleSnapshot, tx, changes),
    });
  });
}

/** 保存基于当前生效值，在同一事务内更新配置与并发版本。 */
async function mutateSettings(
  actorId: string,
  expected: number,
  mutate: (tx: SqlExecutor, changes: SettingsChange[]) => Promise<SettingsChange[]>,
): Promise<SettingsSaveResult> {
  requireActor(actorId);
  requireRevision(expected);
  const db = await getSettingsDb();
  return db.transaction(async (tx) => {
    const revision = await lockControlState(tx);
    if (revision !== expected) throw new SettingsConflictError();
    const changes = parseSettingsChanges(await mutate(tx, []));
    if (changes.length === 0) return { revision, changed: false };
    return { revision: await applyChanges(tx, actorId, revision, changes), changed: true };
  });
}

async function applyChanges(
  tx: SqlExecutor,
  actorId: string,
  revision: number,
  changes: SettingsChange[],
): Promise<number> {
  await validateProjectedState(tx, changes, actorId);
  for (const change of changes.filter((item) => item.after === null)) {
    await writeSettingsChange(tx, change);
  }
  for (const change of changes.filter((item) => item.before && item.after)) {
    await writeSettingsChange(tx, change);
  }
  for (const change of changes.filter((item) => item.before === null)) {
    await writeSettingsChange(tx, change);
  }
  const nextRevision = revision + 1;
  requireRevision(nextRevision);
  const result = await tx.execute(sql`
    UPDATE "settings_control_state"
       SET "current_revision" = ${nextRevision}, "updated_at" = statement_timestamp()
     WHERE "id" = ${CONTROL_STATE_ID} AND "current_revision" = ${revision}
     RETURNING "id"
  `);
  if (rowsOf(result).length !== 1) throw new SettingsConflictError();
  return nextRevision;
}

function requireRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new SettingsValidationError("设置版本非法");
  }
}

async function projectedSnapshot(
  tx: SqlExecutor,
  changes: readonly SettingsChange[],
  resourceKey: string,
  load: () => Promise<SettingsSnapshot | null>,
): Promise<{ before: SettingsSnapshot | null; after: SettingsSnapshot | null }> {
  const existing = changes.find((change) => change.resourceKey === resourceKey);
  if (existing) return { before: existing.before, after: existing.after };
  const current = await load();
  return { before: current, after: current };
}

async function projectedOutputModes(
  tx: SqlExecutor,
  changes: readonly SettingsChange[],
): Promise<OutputModeSnapshot[]> {
  const result = await tx.execute(sql`
    SELECT "id", "name", "description", "system_prompt", "icon", "enabled", "sort_order"
      FROM "output_modes"
  `);
  const values = new Map(rowsOf<Record<string, unknown>>(result).map((row) => {
    const snapshot = outputModeFromRow(row);
    return [snapshot.id, snapshot];
  }));
  for (const change of changes.filter((item) => item.resource === "output_mode")) {
    if (change.after) values.set(change.after.id, change.after);
    else if (change.before) values.delete(change.before.id);
  }
  return [...values.values()];
}

async function projectedRenderStyles(
  tx: SqlExecutor,
  changes: readonly SettingsChange[],
): Promise<RenderStyleSnapshot[]> {
  const result = await tx.execute(sql`
    SELECT "id", "name", "description", "css_class", "css", "icon", "renderer",
           "builtin", "enabled", "sort_order"
      FROM "render_styles"
  `);
  const values = new Map(rowsOf<Record<string, unknown>>(result).map((row) => {
    const snapshot = renderStyleFromRow(row);
    return [snapshot.id, snapshot];
  }));
  for (const change of changes.filter((item) => item.resource === "render_style")) {
    if (change.after) values.set(change.after.id, change.after);
    else if (change.before) values.delete(change.before.id);
  }
  return [...values.values()];
}

async function validateProjectedState(
  tx: SqlExecutor,
  changes: SettingsChange[],
  actorId: string,
): Promise<void> {
  for (const change of changes) {
    if (change.resource === "system_setting" && change.after) {
      canonicalSystemValue(change.after.namespace, change.after.key, change.after.value);
      await validateSystemReference(tx, change.after, actorId);
    }
  }
  const modes = await projectedOutputModes(tx, changes);
  const styles = await projectedRenderStyles(tx, changes);
  parseSettingsChanges(changes);
  requireUniqueIds(modes.map((mode) => mode.id), "输出模式 ID 重复");
  requireUniqueIds(styles.map((style) => style.id), "输出样式 ID 重复");
  requireUniqueIds(styles.map((style) => style.cssClass), "输出样式 CSS 标识重复");
}

async function validateSystemReference(
  tx: SqlExecutor,
  setting: SystemSettingSnapshot,
  actorId: string,
): Promise<void> {
  if (setting.namespace === "rag" && setting.key === "embedding_provider_id" && setting.value) {
    const result = await tx.execute(sql`
      SELECT "id" FROM "providers"
       WHERE "id" = ${setting.value} AND "owner_user_id" = ${actorId} AND "enabled" = true
       LIMIT 1
    `);
    if (rowsOf(result).length !== 1) throw new SettingsValidationError("Embedding Provider 不可用");
  }
  if ((setting.key === "title_model_id"
      || setting.key === "compact_model_id"
      || setting.key === "mem0_llm_model_id") && setting.value) {
    const result = await tx.execute(sql`
      SELECT "models"."id"
        FROM "models"
        JOIN "routes" ON "routes"."model_id" = "models"."id" AND "routes"."enabled" = true
        JOIN "providers" ON "providers"."id" = "routes"."provider_id"
          AND "providers"."enabled" = true
       WHERE "models"."id" = ${setting.value}
         AND "models"."visibility" = 'public'
         AND "models"."enabled" = true
       LIMIT 1
    `);
    if (rowsOf(result).length !== 1) throw new SettingsValidationError("后台任务模型不可用");
  }
}

async function writeSettingsChange(tx: SqlExecutor, change: SettingsChange): Promise<void> {
  if (change.resource === "system_setting") {
    if (!change.after) {
      await tx.execute(sql`
        DELETE FROM "system_settings"
         WHERE "namespace" = ${change.before!.namespace} AND "key" = ${change.before!.key}
      `);
      return;
    }
    await tx.execute(sql`
      INSERT INTO "system_settings" ("namespace", "key", "value", "updated_at")
      VALUES (${change.after.namespace}, ${change.after.key}, ${change.after.value}, statement_timestamp())
      ON CONFLICT ("namespace", "key") DO UPDATE SET
        "value" = excluded."value", "updated_at" = statement_timestamp()
    `);
    return;
  }
  if (change.resource === "output_mode") {
    if (!change.after) {
      await tx.execute(sql`DELETE FROM "output_modes" WHERE "id" = ${change.before!.id}`);
    } else if (!change.before) {
      await tx.execute(sql`
        INSERT INTO "output_modes" (
          "id", "name", "description", "system_prompt", "icon", "enabled", "sort_order"
        ) VALUES (
          ${change.after.id}, ${change.after.name}, ${change.after.description},
          ${change.after.systemPrompt}, ${change.after.icon}, ${change.after.enabled},
          ${change.after.sortOrder}
        )
      `);
    } else {
      await tx.execute(sql`
        UPDATE "output_modes"
           SET "name" = ${change.after.name},
               "description" = ${change.after.description},
               "system_prompt" = ${change.after.systemPrompt},
               "icon" = ${change.after.icon},
               "enabled" = ${change.after.enabled},
               "sort_order" = ${change.after.sortOrder},
               "updated_at" = statement_timestamp()
         WHERE "id" = ${change.after.id}
      `);
    }
    return;
  }
  if (!change.after) {
    await tx.execute(sql`DELETE FROM "render_styles" WHERE "id" = ${change.before!.id}`);
  } else if (!change.before) {
    await tx.execute(sql`
      INSERT INTO "render_styles" (
        "id", "name", "description", "css_class", "css", "icon", "renderer",
        "builtin", "enabled", "sort_order"
      ) VALUES (
        ${change.after.id}, ${change.after.name}, ${change.after.description},
        ${change.after.cssClass}, ${change.after.css}, ${change.after.icon},
        ${change.after.renderer}, ${change.after.builtin}, ${change.after.enabled},
        ${change.after.sortOrder}
      )
    `);
  } else {
    await tx.execute(sql`
      UPDATE "render_styles"
         SET "name" = ${change.after.name},
             "description" = ${change.after.description},
             "css_class" = ${change.after.cssClass},
             "css" = ${change.after.css},
             "icon" = ${change.after.icon},
             "renderer" = ${change.after.renderer},
             "builtin" = ${change.after.builtin},
             "enabled" = ${change.after.enabled},
             "sort_order" = ${change.after.sortOrder},
             "updated_at" = statement_timestamp()
       WHERE "id" = ${change.after.id}
    `);
  }
}

async function loadSystemSetting(
  tx: SqlExecutor,
  namespace: string,
  key: string,
): Promise<SystemSettingSnapshot | null> {
  const result = await tx.execute(sql`
    SELECT "value" FROM "system_settings"
     WHERE "namespace" = ${namespace} AND "key" = ${key}
     LIMIT 1
  `);
  const [row] = rowsOf<{ value: string }>(result);
  return row ? { namespace, key, value: String(row.value) } : null;
}

async function loadOutputMode(tx: SqlExecutor, id: string): Promise<OutputModeSnapshot | null> {
  const result = await tx.execute(sql`
    SELECT "id", "name", "description", "system_prompt", "icon", "enabled", "sort_order"
      FROM "output_modes" WHERE "id" = ${id} LIMIT 1
  `);
  const [row] = rowsOf<Record<string, unknown>>(result);
  return row ? outputModeFromRow(row) : null;
}

async function loadRenderStyle(tx: SqlExecutor, id: string): Promise<RenderStyleSnapshot | null> {
  const result = await tx.execute(sql`
    SELECT "id", "name", "description", "css_class", "css", "icon", "renderer",
           "builtin", "enabled", "sort_order"
      FROM "render_styles" WHERE "id" = ${id} LIMIT 1
  `);
  const [row] = rowsOf<Record<string, unknown>>(result);
  return row ? renderStyleFromRow(row) : null;
}

async function lockControlState(tx: SqlExecutor): Promise<number> {
  const result = await tx.execute(sql`
    SELECT "current_revision" FROM "settings_control_state"
     WHERE "id" = ${CONTROL_STATE_ID}
     FOR UPDATE
  `);
  const [row] = rowsOf<{ current_revision: number | string }>(result);
  if (!row) throw new Error("设置控制状态不存在");
  return integerValue(row.current_revision);
}

function requireActor(actorId: string): void {
  if (!actorId) throw new SettingsValidationError("管理员身份缺失");
}

function canonicalSystemValue(namespace: string, key: string, value: string): string {
  if (!ALLOWED_SYSTEM_SETTINGS.has(`${namespace}:${key}`)) {
    throw new SettingsValidationError("不支持的系统设置");
  }
  if (namespace === "gateway" && key === "request_governance_v1" && value) {
    return JSON.stringify(parseGatewayGovernancePolicy(JSON.parse(value)));
  }
  return value;
}

function systemResourceKey(namespace: string, key: string): string {
  canonicalSystemValue(namespace, key, "");
  return `system:${namespace}:${key}`;
}

function outputModeFromRow(row: Record<string, unknown>): OutputModeSnapshot {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    systemPrompt: String(row.system_prompt),
    icon: row.icon == null ? null : String(row.icon),
    enabled: Boolean(row.enabled),
    sortOrder: integerValue(row.sort_order),
  };
}

function renderStyleFromRow(row: Record<string, unknown>): RenderStyleSnapshot {
  const renderer = String(row.renderer);
  if (renderer !== "streamdown" && renderer !== "custom") {
    throw new SettingsValidationError("输出样式 renderer 非法");
  }
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    cssClass: String(row.css_class),
    css: String(row.css),
    icon: row.icon == null ? null : String(row.icon),
    renderer,
    builtin: Boolean(row.builtin),
    enabled: Boolean(row.enabled),
    sortOrder: integerValue(row.sort_order),
  };
}

function requireExactOrder(existingIds: string[], orderedIds: string[]): void {
  requireUniqueIds(orderedIds, "排序包含重复资源");
  if (existingIds.length !== orderedIds.length
    || existingIds.some((id) => !orderedIds.includes(id))) {
    throw new SettingsValidationError("排序必须包含全部当前资源");
  }
}

function requireUniqueIds(values: string[], message: string): void {
  if (new Set(values).size !== values.length) throw new SettingsValidationError(message);
}

function assertCssClassAvailable(
  styles: RenderStyleSnapshot[],
  cssClass: string,
  excludeId?: string,
): void {
  if (styles.some((style) => style.cssClass === cssClass && style.id !== excludeId)) {
    throw new SettingsValidationError("CSS 标识已存在");
  }
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows?: T[] }).rows ?? [];
  }
  return [];
}

function integerValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("设置控制数值非法");
  return parsed;
}

async function getSettingsDb(): Promise<SettingsDatabase> {
  return getDb() as Promise<SettingsDatabase>;
}
