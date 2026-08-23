import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/infra/db";
import { parseGatewayGovernancePolicy } from "@/lib/gateway-governance/policy";
import {
  changedFields,
  mergeSettingsChange,
  parseSettingsChanges,
  reverseSettingsChange,
  sameSnapshot,
  settingsChangesOverlap,
  snapshotMatchesChangedFields,
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

interface ChangeSetRow {
  id: string;
  status: "draft" | "applied" | "abandoned";
  kind: "edit" | "rollback";
  rollback_of: string | null;
  actor_id: string;
  base_revision: number | string;
  applied_revision: number | string | null;
  version: number | string;
  changes: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  applied_at: Date | string | null;
}

export interface SettingsDraftExpectation {
  changeSetId: string | null;
  version: number | null;
}

export interface SettingsDraftView {
  id: string;
  kind: "edit" | "rollback";
  rollbackOf: string | null;
  baseRevision: number;
  version: number;
  changes: SettingsChange[];
  updatedAt: Date;
}

export interface SettingsControlView {
  currentRevision: number;
  draft: SettingsDraftView | null;
}

export interface SettingsHistoryEntry extends SettingsDraftView {
  actorId: string;
  appliedRevision: number;
  appliedAt: Date;
}

export interface SettingsRollbackConflict {
  resourceKey: string;
  fields: string[];
}

export class SettingsDraftConflictError extends Error {
  readonly code = "settings_draft_conflict";

  constructor(message = "设置草稿已变化，请刷新后重试") {
    super(message);
    this.name = "SettingsDraftConflictError";
  }
}

export class SettingsValidationError extends Error {
  readonly code = "settings_validation_failed";

  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export class SettingsRollbackConflictError extends Error {
  readonly code = "settings_rollback_conflict";
  readonly conflicts: SettingsRollbackConflict[];

  constructor(conflicts: SettingsRollbackConflict[]) {
    super("指定发布与后续设置变更冲突");
    this.name = "SettingsRollbackConflictError";
    this.conflicts = conflicts;
  }
}

export async function getSettingsControlView(): Promise<SettingsControlView> {
  const db = await getSettingsDb();
  const stateResult = await db.execute(sql`
    SELECT "current_revision"
      FROM "settings_control_state"
     WHERE "id" = ${CONTROL_STATE_ID}
  `);
  const [state] = rowsOf<{ current_revision: number | string }>(stateResult);
  if (!state) throw new Error("设置控制状态不存在");
  const draftResult = await db.execute(sql`
    SELECT "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
           "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
      FROM "settings_change_sets"
     WHERE "status" = 'draft'
     LIMIT 1
  `);
  const draft = rowsOf<ChangeSetRow>(draftResult)[0];
  return {
    currentRevision: integerValue(state.current_revision),
    draft: draft ? draftView(draft) : null,
  };
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

export function projectSystemSettings(
  namespace: string,
  production: Record<string, string>,
  changes: readonly SettingsChange[],
): Record<string, string> {
  const projected = { ...production };
  for (const change of changes) {
    if (change.resource !== "system_setting") continue;
    const snapshot = change.after ?? change.before;
    if (snapshot?.namespace !== namespace) continue;
    if (change.after) projected[change.after.key] = change.after.value;
    else if (change.before) delete projected[change.before.key];
  }
  return projected;
}

export function projectOutputModes(
  production: readonly OutputModeSnapshot[],
  changes: readonly SettingsChange[],
): OutputModeSnapshot[] {
  const projected = new Map(production.map((mode) => [mode.id, mode]));
  for (const change of changes) {
    if (change.resource !== "output_mode") continue;
    if (change.after) projected.set(change.after.id, change.after);
    else if (change.before) projected.delete(change.before.id);
  }
  return [...projected.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function projectRenderStyles(
  production: readonly RenderStyleSnapshot[],
  changes: readonly SettingsChange[],
): RenderStyleSnapshot[] {
  const projected = new Map(production.map((style) => [style.id, style]));
  for (const change of changes) {
    if (change.resource !== "render_style") continue;
    if (change.after) projected.set(change.after.id, change.after);
    else if (change.before) projected.delete(change.before.id);
  }
  return [...projected.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function stageSystemSettings(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  namespace: string;
  values: Record<string, string>;
}): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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

export async function stageOutputModeCreate(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  value: Pick<OutputModeSnapshot, "name" | "description" | "systemPrompt" | "icon">;
}): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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

export async function stageOutputModeUpdate(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  id: string;
  patch: Partial<Pick<
    OutputModeSnapshot,
    "name" | "description" | "systemPrompt" | "icon" | "enabled"
  >>;
}): Promise<SettingsDraftView> {
  return mutateOutputMode(input, (current) => ({
    ...current,
    ...input.patch,
    ...(input.patch.name !== undefined ? { name: input.patch.name.trim() } : {}),
    ...(input.patch.systemPrompt !== undefined
      ? { systemPrompt: input.patch.systemPrompt.trim() }
      : {}),
  }));
}

export async function stageOutputModeDelete(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  id: string;
}): Promise<SettingsDraftView> {
  return mutateOutputMode(input, () => null);
}

export async function stageOutputModeReorder(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  orderedIds: string[];
}): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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

export async function stageRenderStyleCreate(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  value: Pick<RenderStyleSnapshot, "name" | "description" | "cssClass" | "css" | "icon">;
}): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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

export async function stageRenderStyleUpdate(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  id: string;
  patch: Partial<Pick<
    RenderStyleSnapshot,
    "name" | "description" | "cssClass" | "css" | "icon" | "renderer" | "enabled"
  >>;
}): Promise<SettingsDraftView> {
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

export async function stageRenderStyleDelete(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  id: string;
}): Promise<SettingsDraftView> {
  return mutateRenderStyle(input, (current) => {
    if (current.builtin) throw new SettingsValidationError("系统内置样式不可删除");
    return null;
  });
}

export async function stageRenderStyleReorder(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
  orderedIds: string[];
}): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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

export async function abandonSettingsDraft(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
}): Promise<void> {
  const db = await getSettingsDb();
  await db.transaction(async (tx) => {
    await lockControlState(tx);
    const draft = await lockActiveDraft(tx);
    assertDraftExpectation(draft, input.expected, input.actorId);
    const result = await tx.execute(sql`
      UPDATE "settings_change_sets"
         SET "status" = 'abandoned',
             "abandoned_at" = statement_timestamp(),
             "updated_at" = statement_timestamp()
       WHERE "id" = ${draft!.id}
         AND "status" = 'draft'
         AND "version" = ${integerValue(draft!.version)}
       RETURNING "id"
    `);
    if (rowsOf(result).length !== 1) throw new SettingsDraftConflictError();
  });
}

export async function applySettingsDraft(input: {
  actorId: string;
  expected: SettingsDraftExpectation;
}): Promise<{ revision: number; changeSetId: string }> {
  const db = await getSettingsDb();
  return db.transaction(async (tx) => {
    const revision = await lockControlState(tx);
    const draft = await lockActiveDraft(tx);
    assertDraftExpectation(draft, input.expected, input.actorId);
    const changes = parseSettingsChanges(draft!.changes);
    if (changes.length === 0) throw new SettingsValidationError("活动草稿没有可发布变更");

    for (const change of changes) {
      const current = await loadProductionSnapshot(tx, change);
      if (!sameSnapshot(current, change.before)) {
        throw new SettingsDraftConflictError(`生产设置 ${change.resourceKey} 已变化`);
      }
    }
    await validateProjectedState(tx, changes, input.actorId);

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
    const stateResult = await tx.execute(sql`
      UPDATE "settings_control_state"
         SET "current_revision" = ${nextRevision}, "updated_at" = statement_timestamp()
       WHERE "id" = ${CONTROL_STATE_ID}
         AND "current_revision" = ${revision}
       RETURNING "id"
    `);
    if (rowsOf(stateResult).length !== 1) throw new SettingsDraftConflictError();
    const applied = await tx.execute(sql`
      UPDATE "settings_change_sets"
         SET "status" = 'applied',
             "applied_revision" = ${nextRevision},
             "applied_at" = statement_timestamp(),
             "updated_at" = statement_timestamp()
       WHERE "id" = ${draft!.id}
         AND "status" = 'draft'
         AND "version" = ${integerValue(draft!.version)}
       RETURNING "id"
    `);
    if (rowsOf(applied).length !== 1) throw new SettingsDraftConflictError();
    return { revision: nextRevision, changeSetId: draft!.id };
  });
}

export async function listSettingsHistory(limit = 50): Promise<SettingsHistoryEntry[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SettingsValidationError("历史查询条数必须在 1-100 之间");
  }
  const db = await getSettingsDb();
  const result = await db.execute(sql`
    SELECT "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
           "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
      FROM "settings_change_sets"
     WHERE "status" = 'applied'
     ORDER BY "applied_revision" DESC
     LIMIT ${limit}
  `);
  return rowsOf<ChangeSetRow>(result).map(historyView);
}

export async function createRollbackDraft(input: {
  actorId: string;
  targetChangeSetId: string;
}): Promise<SettingsDraftView> {
  const db = await getSettingsDb();
  return db.transaction(async (tx) => {
    const revision = await lockControlState(tx);
    if (await lockActiveDraft(tx)) throw new SettingsDraftConflictError("请先处理当前活动草稿");
    const target = await loadAppliedChangeSet(tx, input.targetChangeSetId);
    const later = await loadLaterAppliedChangeSets(tx, integerValue(target.applied_revision!));
    const targetChanges = parseSettingsChanges(target.changes);
    const laterChanges = later.flatMap((row) => parseSettingsChanges(row.changes));
    const conflicts: SettingsRollbackConflict[] = [];
    const reversed: SettingsChange[] = [];

    for (const targetChange of targetChanges) {
      const fields = changedFields(targetChange);
      const overlap = laterChanges.filter((change) => settingsChangesOverlap(targetChange, change));
      const current = await loadProductionSnapshot(tx, targetChange);
      if (overlap.length > 0
        || !snapshotMatchesChangedFields(current, targetChange.after, fields)) {
        conflicts.push({ resourceKey: targetChange.resourceKey, fields });
        continue;
      }
      reversed.push(reverseSettingsChange(targetChange, current));
    }
    if (conflicts.length > 0) throw new SettingsRollbackConflictError(conflicts);

    const changes = parseSettingsChanges(reversed.filter((change) => (
      !sameSnapshot(change.before, change.after)
    )));
    if (changes.length === 0) throw new SettingsValidationError("目标发布没有可撤销变更");
    const id = randomUUID();
    const inserted = await tx.execute(sql`
      INSERT INTO "settings_change_sets" (
        "id", "status", "kind", "rollback_of", "actor_id", "base_revision", "version", "changes"
      ) VALUES (
        ${id}, 'draft', 'rollback', ${target.id}, ${input.actorId}, ${revision}, 1,
        ${JSON.stringify(changes)}::jsonb
      )
      RETURNING "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
                "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
    `);
    const [draft] = rowsOf<ChangeSetRow>(inserted);
    if (!draft) throw new Error("创建回滚草稿失败");
    return draftView(draft);
  });
}

async function mutateOutputMode(
  input: { actorId: string; expected: SettingsDraftExpectation; id: string },
  mutate: (current: OutputModeSnapshot) => OutputModeSnapshot | null,
): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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
  input: { actorId: string; expected: SettingsDraftExpectation; id: string },
  mutate: (
    current: RenderStyleSnapshot,
    tx: SqlExecutor,
    changes: SettingsChange[],
  ) => RenderStyleSnapshot | null | Promise<RenderStyleSnapshot | null>,
): Promise<SettingsDraftView> {
  return mutateDraft(input.actorId, input.expected, async (tx, changes) => {
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

async function mutateDraft(
  actorId: string,
  expected: SettingsDraftExpectation,
  mutate: (tx: SqlExecutor, changes: SettingsChange[]) => Promise<SettingsChange[]>,
): Promise<SettingsDraftView> {
  requireActor(actorId);
  requireExpectation(expected);
  const db = await getSettingsDb();
  return db.transaction(async (tx) => {
    const revision = await lockControlState(tx);
    const draft = await lockActiveDraft(tx);
    assertDraftExpectation(draft, expected, actorId);
    const changes = parseSettingsChanges(draft?.changes ?? []);
    const nextChanges = parseSettingsChanges(await mutate(tx, changes));

    if (!draft) {
      const id = randomUUID();
      const inserted = await tx.execute(sql`
        INSERT INTO "settings_change_sets" (
          "id", "status", "kind", "actor_id", "base_revision", "version", "changes"
        ) VALUES (${id}, 'draft', 'edit', ${actorId}, ${revision}, 1, ${JSON.stringify(nextChanges)}::jsonb)
        RETURNING "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
                  "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
      `);
      const [created] = rowsOf<ChangeSetRow>(inserted);
      if (!created) throw new Error("创建设置草稿失败");
      return draftView(created);
    }

    const version = integerValue(draft.version);
    const updated = await tx.execute(sql`
      UPDATE "settings_change_sets"
         SET "changes" = ${JSON.stringify(nextChanges)}::jsonb,
             "version" = "version" + 1,
             "updated_at" = statement_timestamp()
       WHERE "id" = ${draft.id}
         AND "status" = 'draft'
         AND "version" = ${version}
       RETURNING "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
                 "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
    `);
    const [result] = rowsOf<ChangeSetRow>(updated);
    if (!result) throw new SettingsDraftConflictError();
    return draftView(result);
  });
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

async function loadProductionSnapshot(
  tx: SqlExecutor,
  change: SettingsChange,
): Promise<SettingsSnapshot | null> {
  if (change.resource === "system_setting") {
    const snapshot = change.after ?? change.before!;
    return loadSystemSetting(tx, snapshot.namespace, snapshot.key);
  }
  const snapshot = change.after ?? change.before!;
  return change.resource === "output_mode"
    ? loadOutputMode(tx, snapshot.id)
    : loadRenderStyle(tx, snapshot.id);
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

async function lockActiveDraft(tx: SqlExecutor): Promise<ChangeSetRow | null> {
  const result = await tx.execute(sql`
    SELECT "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
           "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
      FROM "settings_change_sets"
     WHERE "status" = 'draft'
     LIMIT 1
     FOR UPDATE
  `);
  return rowsOf<ChangeSetRow>(result)[0] ?? null;
}

async function loadAppliedChangeSet(tx: SqlExecutor, id: string): Promise<ChangeSetRow> {
  const result = await tx.execute(sql`
    SELECT "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
           "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
      FROM "settings_change_sets"
     WHERE "id" = ${id} AND "status" = 'applied'
     LIMIT 1
  `);
  const [row] = rowsOf<ChangeSetRow>(result);
  if (!row) throw new SettingsValidationError("指定发布不存在");
  return row;
}

async function loadLaterAppliedChangeSets(
  tx: SqlExecutor,
  revision: number,
): Promise<ChangeSetRow[]> {
  const result = await tx.execute(sql`
    SELECT "id", "status", "kind", "rollback_of", "actor_id", "base_revision",
           "applied_revision", "version", "changes", "created_at", "updated_at", "applied_at"
      FROM "settings_change_sets"
     WHERE "status" = 'applied' AND "applied_revision" > ${revision}
     ORDER BY "applied_revision" ASC
  `);
  return rowsOf<ChangeSetRow>(result);
}

function assertDraftExpectation(
  draft: ChangeSetRow | null,
  expected: SettingsDraftExpectation,
  actorId: string,
): void {
  requireActor(actorId);
  requireExpectation(expected);
  if (!draft) {
    if (expected.changeSetId !== null) throw new SettingsDraftConflictError();
    return;
  }
  if (draft.actor_id !== actorId
    || draft.id !== expected.changeSetId
    || integerValue(draft.version) !== expected.version) {
    throw new SettingsDraftConflictError();
  }
}

function requireExpectation(expected: SettingsDraftExpectation): void {
  if ((expected.changeSetId === null) !== (expected.version === null)) {
    throw new SettingsValidationError("草稿标识与版本必须同时提交");
  }
  if (expected.version !== null
    && (!Number.isSafeInteger(expected.version) || expected.version < 1)) {
    throw new SettingsValidationError("草稿版本非法");
  }
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

function draftView(row: ChangeSetRow): SettingsDraftView {
  return {
    id: row.id,
    kind: row.kind,
    rollbackOf: row.rollback_of,
    baseRevision: integerValue(row.base_revision),
    version: integerValue(row.version),
    changes: parseSettingsChanges(row.changes),
    updatedAt: dateValue(row.updated_at),
  };
}

function historyView(row: ChangeSetRow): SettingsHistoryEntry {
  if (row.applied_revision === null || row.applied_at === null) {
    throw new Error("已发布设置记录缺少 revision 或时间");
  }
  return {
    ...draftView(row),
    actorId: row.actor_id,
    appliedRevision: integerValue(row.applied_revision),
    appliedAt: dateValue(row.applied_at),
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

function dateValue(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("设置控制时间非法");
  return parsed;
}

async function getSettingsDb(): Promise<SettingsDatabase> {
  return getDb() as Promise<SettingsDatabase>;
}
