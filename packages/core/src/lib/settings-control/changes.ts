import { z } from "zod";

const systemSettingSnapshotSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
}).strict();

const outputModeSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  systemPrompt: z.string().min(1),
  icon: z.string().nullable(),
  enabled: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
}).strict();

const renderStyleSnapshotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  cssClass: z.string().min(1),
  css: z.string().min(1),
  icon: z.string().nullable(),
  renderer: z.enum(["streamdown", "custom"]),
  builtin: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
}).strict();

const systemSettingChangeSchema = z.object({
  resource: z.literal("system_setting"),
  resourceKey: z.string().startsWith("system:"),
  before: systemSettingSnapshotSchema.nullable(),
  after: systemSettingSnapshotSchema.nullable(),
}).strict();

const outputModeChangeSchema = z.object({
  resource: z.literal("output_mode"),
  resourceKey: z.string().startsWith("output-mode:"),
  before: outputModeSnapshotSchema.nullable(),
  after: outputModeSnapshotSchema.nullable(),
}).strict();

const renderStyleChangeSchema = z.object({
  resource: z.literal("render_style"),
  resourceKey: z.string().startsWith("render-style:"),
  before: renderStyleSnapshotSchema.nullable(),
  after: renderStyleSnapshotSchema.nullable(),
}).strict();

const settingsChangeSchema = z.discriminatedUnion("resource", [
  systemSettingChangeSchema,
  outputModeChangeSchema,
  renderStyleChangeSchema,
]);

export const settingsChangesSchema = z.array(settingsChangeSchema);

export type SystemSettingSnapshot = z.infer<typeof systemSettingSnapshotSchema>;
export type OutputModeSnapshot = z.infer<typeof outputModeSnapshotSchema>;
export type RenderStyleSnapshot = z.infer<typeof renderStyleSnapshotSchema>;
export type SettingsChange = z.infer<typeof settingsChangeSchema>;
export type SettingsSnapshot = NonNullable<SettingsChange["before"]>;

export function parseSettingsChanges(input: unknown): SettingsChange[] {
  const changes = settingsChangesSchema.parse(input);
  const keys = new Set<string>();
  for (const change of changes) {
    if (keys.has(change.resourceKey)) throw new Error("设置变更包含重复资源");
    keys.add(change.resourceKey);
    validateResourceKey(change);
    if (sameSnapshot(change.before, change.after)) throw new Error("设置变更包含空变更");
  }
  return changes;
}

export function mergeSettingsChange(
  changes: readonly SettingsChange[],
  next: SettingsChange,
): SettingsChange[] {
  // 清空不存在的设置或恢复原值时，不记录变更。
  if (next.before !== null || next.after !== null) validateResourceKey(next);
  const index = changes.findIndex((change) => change.resourceKey === next.resourceKey);
  const before = index >= 0 ? changes[index]!.before : next.before;
  if (sameSnapshot(before, next.after)) {
    return changes.filter((_, itemIndex) => itemIndex !== index);
  }
  const merged = { ...next, before } as SettingsChange;
  return index < 0
    ? [...changes, merged]
    : changes.map((change, itemIndex) => itemIndex === index ? merged : change);
}

export function sameSnapshot(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = recordOf(a);
  const right = recordOf(b);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => key in right && sameSnapshot(left[key], right[key]));
}

function validateResourceKey(change: SettingsChange): void {
  if (change.resource === "system_setting") {
    const snapshot = change.after ?? change.before;
    if (!snapshot) throw new Error("设置变更前后不能同时为空");
    if (change.resourceKey !== `system:${snapshot.namespace}:${snapshot.key}`) {
      throw new Error("设置资源标识与快照不一致");
    }
    if (change.before && change.after
      && (change.before.namespace !== change.after.namespace
        || change.before.key !== change.after.key)) {
      throw new Error("设置变更不能替换稳定标识");
    }
    return;
  }
  const snapshot = change.after ?? change.before;
  if (!snapshot) throw new Error("设置变更前后不能同时为空");
  const prefix = change.resource === "output_mode" ? "output-mode" : "render-style";
  if (change.resourceKey !== `${prefix}:${snapshot.id}`) {
    throw new Error("设置资源标识与快照不一致");
  }
  if (change.before && change.after && change.before.id !== change.after.id) {
    throw new Error("设置变更不能替换稳定标识");
  }
}

function recordOf(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
