import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/infra/db";
import {
  abandonSettingsDraft,
  applySettingsDraft,
  rollbackSettings,
  getSettingsRevision,
  listSettingsHistory,
  SettingsRollbackConflictError,
  getSettingsControlView,
  SettingsDraftConflictError,
  SettingsValidationError,
  saveOutputModeCreate,
  saveOutputModeUpdate,
  saveRenderStyleCreate,
  saveSystemSettings,
} from "./service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.GATEWAY_GOVERNANCE_PG_TEST_DATABASE;

function isIsolatedTestDatabase(): boolean {
  if (!databaseUrl || !expectedDatabase) return false;
  try {
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    return databaseName === expectedDatabase
      && /^nekusora_core_pg_test_[0-9a-f]{16}$/.test(databaseName);
  } catch {
    return false;
  }
}

const describePg = isIsolatedTestDatabase() ? describe : describe.skip;

describePg("settings control PostgreSQL service", () => {
  const actorId = `settings-${randomUUID()}`;
  const cssClass = `settings-${randomUUID().slice(0, 8)}`;
  let pool: pg.Pool;
  let firstReleaseId = "";
  let outputModeId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query(
      'INSERT INTO "user" ("id", "name", "email") VALUES ($1, $2, $3)',
      [actorId, "Settings test", `${actorId}@example.test`],
    );
  });

  afterAll(async () => {
    await closeDb();
    await pool.end();
  });

  it("saves each resource immediately and rejects stale revisions", async () => {
    const first = await saveSystemSettings({
      actorId, expected: 0, namespace: "gateway",
      values: { chat_ua: "settings-control-test/1", gateway_ua: "" },
    });
    firstReleaseId = first.changeSetId!;
    expect(first.revision).toBe(1);
    await expect(saveSystemSettings({
      actorId, expected: 0, namespace: "gateway", values: { gateway_ua: "stale" },
    })).rejects.toBeInstanceOf(SettingsDraftConflictError);
    const second = await saveOutputModeCreate({
      actorId, expected: 1,
      value: { name: "Settings test", description: null, systemPrompt: "Be precise", icon: null },
    });
    expect(second.revision).toBe(2);
    const history = await listSettingsHistory();
    outputModeId = history[0].changes.find((change) => change.resource === "output_mode")!.after!.id;
    const third = await saveRenderStyleCreate({
      actorId, expected: 2,
      value: { name: "Settings test", description: null, cssClass, css: `.${cssClass} { color: inherit; }`, icon: null },
    });
    expect(third.revision).toBe(3);
    expect(await getSettingsControlView()).toMatchObject({ currentRevision: 3, draft: null });
    const rows = await pool.query(
      `SELECT
        (SELECT "value" FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua') AS ua,
        (SELECT count(*)::int FROM "output_modes" WHERE "id"=$1) AS modes,
        (SELECT count(*)::int FROM "render_styles" WHERE "css_class"=$2) AS styles`,
      [outputModeId, cssClass],
    );
    expect(rows.rows[0]).toEqual({ ua: "settings-control-test/1", modes: 1, styles: 1 });
  });

  it("does not add history for unchanged or absent legacy values", async () => {
    const before = await listSettingsHistory();
    expect(await saveSystemSettings({
      actorId, expected: 3, namespace: "gateway",
      values: { chat_ua: "settings-control-test/1", gateway_ua: "" },
    })).toEqual({ revision: 3, changeSetId: null });
    expect(await saveSystemSettings({
      actorId, expected: 3, namespace: "task", values: { title_model: "", title_model_id: "" },
    })).toEqual({ revision: 3, changeSetId: null });
    expect(await listSettingsHistory()).toEqual(before);
  });

  it("rolls back validation failures and late database write failures", async () => {
    await expect(saveSystemSettings({
      actorId, expected: 3, namespace: "task",
      values: { title_model: "must-not-apply", title_model_id: randomUUID() },
    })).rejects.toBeInstanceOf(SettingsValidationError);
    // 在隔离库中模拟最后一步历史写入失败，验证此前配置与 revision 一起回滚。
    await pool.query(`ALTER TABLE "settings_change_sets" ADD CONSTRAINT "test_reject_next_save" CHECK ("applied_revision" <= 3)`);
    try {
      await expect(saveSystemSettings({
        actorId, expected: 3, namespace: "gateway", values: { chat_ua: "must-not-apply" },
      })).rejects.toThrow();
    } finally {
      await pool.query(`ALTER TABLE "settings_change_sets" DROP CONSTRAINT "test_reject_next_save"`);
    }
    expect(await getSettingsRevision()).toBe(3);
    expect(await listSettingsHistory()).toHaveLength(3);
    const rows = await pool.query(`SELECT "value" FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua'`);
    expect(rows.rows[0].value).toBe("settings-control-test/1");
    const absent = await pool.query(`SELECT * FROM "system_settings" WHERE "namespace"='task' AND "key"='title_model'`);
    expect(absent.rows).toEqual([]);
  });

  it("allows only one concurrent save with the same revision", async () => {
    const results = await Promise.allSettled(["a", "b"].map((description) => saveOutputModeUpdate({
      actorId, expected: 3, id: outputModeId, patch: { description },
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(SettingsDraftConflictError);
    expect(await getSettingsRevision()).toBe(4);
  });

  it("preserves old drafts during saves and still supports explicit legacy publishing", async () => {
    const id = randomUUID();
    const changes = [{
      resource: "system_setting", resourceKey: "system:gateway:gateway_ua",
      before: null, after: { namespace: "gateway", key: "gateway_ua", value: "legacy-agent" },
    }];
    await pool.query(
      `INSERT INTO "settings_change_sets" ("id", "actor_id", "base_revision", "changes")
       VALUES ($1, $2, 4, $3::jsonb)`, [id, actorId, JSON.stringify(changes)],
    );
    const before = (await getSettingsControlView()).draft;
    await saveOutputModeUpdate({ actorId, expected: 4, id: outputModeId, patch: { name: "Renamed" } });
    expect((await getSettingsControlView()).draft).toEqual(before);
    const unchanged = await pool.query(`SELECT * FROM "system_settings" WHERE "namespace"='gateway' AND "key"='gateway_ua'`);
    expect(unchanged.rows).toEqual([]);
    await applySettingsDraft({ actorId, expected: { changeSetId: id, version: 1 } });
    expect(await getSettingsRevision()).toBe(6);
    expect((await getSettingsControlView()).draft).toBeNull();
  });

  it("keeps history immutable and directly reverts a selected change", async () => {
    await expect(pool.query(
      'UPDATE "settings_change_sets" SET "updated_at"=now() WHERE "id"=$1', [firstReleaseId],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(pool.query(
      'DELETE FROM "settings_change_sets" WHERE "id"=$1', [firstReleaseId],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(rollbackSettings({
      actorId, expected: 5, targetChangeSetId: firstReleaseId,
    })).rejects.toBeInstanceOf(SettingsDraftConflictError);
    const reverted = await rollbackSettings({ actorId, expected: 6, targetChangeSetId: firstReleaseId });
    expect(reverted.revision).toBe(7);
    expect((await listSettingsHistory())[0]).toMatchObject({
      kind: "rollback", rollbackOf: firstReleaseId, appliedRevision: 7,
    });
    expect((await getSettingsControlView()).draft).toBeNull();
    const rows = await pool.query(`SELECT * FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua'`);
    expect(rows.rows).toEqual([]);
    await expect(rollbackSettings({
      actorId, expected: 7, targetChangeSetId: firstReleaseId,
    })).rejects.toBeInstanceOf(SettingsRollbackConflictError);
    expect(await getSettingsRevision()).toBe(7);
  });

  it("rejects invalid revision tokens before touching settings", async () => {
    for (const expected of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(saveSystemSettings({
        actorId, expected, namespace: "gateway", values: { chat_ua: "invalid" },
      })).rejects.toBeInstanceOf(SettingsValidationError);
    }
    const id = randomUUID();
    await pool.query(
      `INSERT INTO "settings_change_sets" ("id", "actor_id", "base_revision") VALUES ($1, $2, 7)`,
      [id, actorId],
    );
    await abandonSettingsDraft({ actorId, expected: { changeSetId: id, version: 1 } });
    expect((await getSettingsControlView()).draft).toBeNull();
  });
});
