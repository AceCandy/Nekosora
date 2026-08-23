import { describe, expect, it } from "vitest";
import {
  changedFields,
  mergeSettingsChange,
  reverseSettingsChange,
  settingsChangesOverlap,
  type SettingsChange,
} from "./changes";

const original: SettingsChange = {
  resource: "output_mode",
  resourceKey: "output-mode:mode-1",
  before: {
    id: "mode-1",
    name: "原名",
    description: null,
    systemPrompt: "old",
    icon: null,
    enabled: true,
    sortOrder: 0,
  },
  after: {
    id: "mode-1",
    name: "新名",
    description: null,
    systemPrompt: "old",
    icon: null,
    enabled: true,
    sortOrder: 0,
  },
};

describe("settings change canonical helpers", () => {
  it("preserves the first before snapshot and removes a restored no-op", () => {
    const edited = mergeSettingsChange([original], {
      ...original,
      before: original.after,
      after: { ...original.after!, systemPrompt: "new" },
    });
    expect(edited[0]).toMatchObject({
      before: original.before,
      after: { name: "新名", systemPrompt: "new" },
    });

    expect(mergeSettingsChange(edited, {
      ...original,
      before: edited[0]!.after,
      after: original.before,
    })).toEqual([]);
  });

  it("reverses only the target update fields and preserves unrelated later values", () => {
    const current = { ...original.after!, systemPrompt: "later unrelated" };
    expect(changedFields(original)).toEqual(["name"]);
    expect(reverseSettingsChange(original, current).after).toEqual({
      ...current,
      name: "原名",
    });
  });

  it("treats create/delete as entity-wide conflicts and updates as field conflicts", () => {
    const laterDescription = {
      ...original,
      before: original.after,
      after: { ...original.after!, description: "later" },
    } as SettingsChange;
    const creation = { ...original, before: null } as SettingsChange;
    expect(settingsChangesOverlap(original, laterDescription)).toBe(false);
    expect(settingsChangesOverlap(creation, laterDescription)).toBe(true);
  });
});
