import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/infra/db";
import {
  abandonSettingsDraft,
  applySettingsDraft,
  createRollbackDraft,
  getSettingsControlView,
  SettingsDraftConflictError,
  SettingsValidationError,
  stageOutputModeCreate,
  stageOutputModeUpdate,
  stageRenderStyleCreate,
  stageSystemSettings,
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

  it("persists one draft and atomically publishes all resource types", async () => {
    const first = await stageSystemSettings({
      actorId,
      expected: { changeSetId: null, version: null },
      namespace: "gateway",
      values: { chat_ua: "settings-control-test/1" },
    });
    await expect(stageSystemSettings({
      actorId,
      expected: { changeSetId: null, version: null },
      namespace: "gateway",
      values: { gateway_ua: "stale" },
    })).rejects.toBeInstanceOf(SettingsDraftConflictError);

    const second = await stageOutputModeCreate({
      actorId,
      expected: { changeSetId: first.id, version: first.version },
      value: { name: "Settings test", description: null, systemPrompt: "Be precise", icon: null },
    });
    outputModeId = second.changes.find((change) => change.resource === "output_mode")!.after!.id;
    const third = await stageRenderStyleCreate({
      actorId,
      expected: { changeSetId: second.id, version: second.version },
      value: {
        name: "Settings test",
        description: null,
        cssClass,
        css: `.${cssClass} { color: inherit; }`,
        icon: null,
      },
    });

    const applied = await applySettingsDraft({
      actorId,
      expected: { changeSetId: third.id, version: third.version },
    });
    firstReleaseId = applied.changeSetId;
    expect(applied.revision).toBe(1);
    const rows = await pool.query(
      `SELECT
        (SELECT "value" FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua') AS "ua",
        (SELECT count(*)::int FROM "output_modes" WHERE "id"=$1) AS "modes",
        (SELECT count(*)::int FROM "render_styles" WHERE "css_class"=$2) AS "styles"`,
      [outputModeId, cssClass],
    );
    expect(rows.rows[0]).toMatchObject({ ua: "settings-control-test/1", modes: 1, styles: 1 });
  });

  it("keeps production and revision unchanged when projected validation fails", async () => {
    const first = await stageSystemSettings({
      actorId,
      expected: { changeSetId: null, version: null },
      namespace: "gateway",
      values: { chat_ua: "must-not-apply" },
    });
    const second = await stageOutputModeUpdate({
      actorId,
      expected: { changeSetId: first.id, version: first.version },
      id: outputModeId,
      patch: { name: "must-not-apply" },
    });
    const third = await stageSystemSettings({
      actorId,
      expected: { changeSetId: second.id, version: second.version },
      namespace: "task",
      values: { title_model_id: randomUUID() },
    });

    await expect(applySettingsDraft({
      actorId,
      expected: { changeSetId: third.id, version: third.version },
    })).rejects.toBeInstanceOf(SettingsValidationError);
    const rows = await pool.query(
      `SELECT
        (SELECT "current_revision"::int FROM "settings_control_state" WHERE "id"='global') AS "revision",
        (SELECT "value" FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua') AS "ua",
        (SELECT "name" FROM "output_modes" WHERE "id"=$1) AS "mode_name"`,
      [outputModeId],
    );
    expect(rows.rows[0]).toMatchObject({
      revision: 1,
      ua: "settings-control-test/1",
      mode_name: "Settings test",
    });
    await abandonSettingsDraft({
      actorId,
      expected: { changeSetId: third.id, version: third.version },
    });
  });

  it("prevents applied history mutation and reverses a selected release as a new release", async () => {
    await expect(pool.query(
      'UPDATE "settings_change_sets" SET "updated_at"=now() WHERE "id"=$1',
      [firstReleaseId],
    )).rejects.toMatchObject({ code: "55000" });
    await expect(pool.query(
      'DELETE FROM "settings_change_sets" WHERE "id"=$1',
      [firstReleaseId],
    )).rejects.toMatchObject({ code: "55000" });

    const rollback = await createRollbackDraft({ actorId, targetChangeSetId: firstReleaseId });
    expect(rollback.kind).toBe("rollback");
    const applied = await applySettingsDraft({
      actorId,
      expected: { changeSetId: rollback.id, version: rollback.version },
    });
    expect(applied.revision).toBe(2);
    const view = await getSettingsControlView();
    expect(view).toMatchObject({ currentRevision: 2, draft: null });
    const rows = await pool.query(
      `SELECT
        (SELECT count(*)::int FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua') AS "ua",
        (SELECT count(*)::int FROM "output_modes" WHERE "id"=$1) AS "modes",
        (SELECT count(*)::int FROM "render_styles" WHERE "css_class"=$2) AS "styles"`,
      [outputModeId, cssClass],
    );
    expect(rows.rows[0]).toMatchObject({ ua: 0, modes: 0, styles: 0 });
  });
});
