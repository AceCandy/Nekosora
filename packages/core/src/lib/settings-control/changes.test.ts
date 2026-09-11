import { describe, expect, it } from "vitest";
import {
  mergeSettingsChange,
  parseSettingsChanges,
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
  it("ignores clearing an absent setting and removes an unpersisted creation", () => {
    const empty: SettingsChange = { resource: "system_setting", resourceKey: "system:task:title_model", before: null, after: null };
    expect(mergeSettingsChange([], empty)).toEqual([]);
    const created: SettingsChange = { ...empty, after: { namespace: "task", key: "title_model", value: "test" } };
    expect(mergeSettingsChange([created, original], empty)).toEqual([original]);
    expect(() => parseSettingsChanges([empty])).toThrow();
  });
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

    const change = edited[0];
    if (change.resource !== "output_mode") throw new Error("expected output mode change");
    expect(mergeSettingsChange(edited, {
      ...original,
      before: change.after,
      after: original.before,
    })).toEqual([]);
  });

});
