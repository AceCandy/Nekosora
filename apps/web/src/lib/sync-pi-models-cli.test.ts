import { describe, expect, it } from "vitest";
import {
  parseSyncArgs,
  renderSyncFailure,
  renderSyncPlan,
  resolveSyncSource,
  SyncCliError,
} from "../../scripts/sync-pi-models";
import type { SyncPlan } from "./sync-pi-models";

describe("model catalog sync CLI policy", () => {
  it("只接受默认 dry-run 与 --write", () => {
    expect(parseSyncArgs([])).toEqual({ write: false });
    expect(parseSyncArgs(["--write"])).toEqual({ write: true });
    expect(parseSyncArgs(["--", "--write"])).toEqual({ write: true });
    for (const flag of ["--import-missing", "--also-update", "--apply", "--unknown"]) {
      expect(() => parseSyncArgs([flag])).toThrowError(expect.objectContaining({
        stage: "arguments",
        reason: "unsupported_argument",
      }));
    }
  });

  it("--write 必须显式指定本地 snapshot,dry-run 才允许 live source", () => {
    expect(resolveSyncSource({ write: false }, {})).toEqual({ kind: "live" });
    expect(resolveSyncSource({ write: false }, { PI_MODELS_FILE: "/tmp/pi.json" }))
      .toEqual({ kind: "file", path: "/tmp/pi.json" });
    expect(resolveSyncSource({ write: true }, { PI_MODELS_FILE: "/tmp/pi.json" }))
      .toEqual({ kind: "file", path: "/tmp/pi.json" });
    expect(() => resolveSyncSource({ write: true }, {})).toThrowError(expect.objectContaining({
      stage: "arguments",
      reason: "write_requires_snapshot",
    }));
  });

  it("失败输出只包含稳定 stage/reason,不泄露原始错误", () => {
    const raw = new Error("https://secret.example/path Authorization=Bearer-secret");
    expect(renderSyncFailure(raw)).toBe(
      "model catalog sync failed: stage=internal reason=unexpected_failure",
    );
    expect(renderSyncFailure(new SyncCliError("source", "snapshot_invalid"))).toBe(
      "model catalog sync failed: stage=source reason=snapshot_invalid",
    );
    expect(renderSyncFailure(raw)).not.toContain("secret");
  });

  it("dry-run 审计不输出可疑标识或 capability 原始值", () => {
    const plan: SyncPlan = {
      additions: [{
        canonicalModelId: "https://secret.example/new-model",
        name: "ignored",
        match: {
          provider: "vendor",
          modelKey: "new-model",
          via: "vendor/new-model",
          kind: "provider-id",
          authority: "direct",
        },
        capabilities: {},
        enabled: true,
      }],
      changes: [{
        canonicalModelId: "https://secret.example/model",
        name: "ignored",
        match: {
          provider: "vendor",
          modelKey: "model",
          via: "vendor/model",
          kind: "provider-id",
          authority: "direct",
        },
        operations: [{
          target: "capability",
          action: "set",
          key: "thinkingLevelMap",
          value: { high: "Bearer-secret" },
        }],
        nextCapabilities: {},
      }],
      references: [],
      rejections: [{
        provider: "/private/provider",
        modelKey: "Authorization=Bearer-secret",
        scope: "reasoning",
        code: "invalid_map_value",
      }],
      matched: 1,
      unchanged: 0,
      unmatched: { generic: ["/private/generic"], catalog: ["safe-model"] },
    };

    const output = renderSyncPlan(plan);
    expect(output).toContain("redacted-model");
    expect(output).toContain("new redacted-model provider-id");
    expect(output).toContain("external-model reasoning:invalid_map_value");
    expect(output).toContain("capability.thinkingLevelMap=set");
    for (const sensitive of ["secret.example", "/private", "Authorization", "Bearer-secret"]) {
      expect(output).not.toContain(sensitive);
    }
  });
});
