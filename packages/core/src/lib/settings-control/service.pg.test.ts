import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../infra/db/index";
import {
  getSettingsRevision,
  getSettingsControlView,
  SettingsConflictError,
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
    expect(first).toEqual({ revision: 1, changed: true });
    await expect(saveSystemSettings({
      actorId, expected: 0, namespace: "gateway", values: { gateway_ua: "stale" },
    })).rejects.toBeInstanceOf(SettingsConflictError);
    const second = await saveOutputModeCreate({
      actorId, expected: 1,
      value: { name: "Settings test", description: null, systemPrompt: "Be precise", icon: null },
    });
    expect(second.revision).toBe(2);
    const modes = await pool.query('SELECT id FROM output_modes WHERE name=$1', ["Settings test"]);
    outputModeId = modes.rows[0].id;
    const third = await saveRenderStyleCreate({
      actorId, expected: 2,
      value: { name: "Settings test", description: null, cssClass, css: `.${cssClass} { color: inherit; }`, icon: null },
    });
    expect(third.revision).toBe(3);
    expect(await getSettingsControlView()).toMatchObject({ currentRevision: 3 });
    const rows = await pool.query(
      `SELECT
        (SELECT "value" FROM "system_settings" WHERE "namespace"='gateway' AND "key"='chat_ua') AS ua,
        (SELECT count(*)::int FROM "output_modes" WHERE "id"=$1) AS modes,
        (SELECT count(*)::int FROM "render_styles" WHERE "css_class"=$2) AS styles`,
      [outputModeId, cssClass],
    );
    expect(rows.rows[0]).toEqual({ ua: "settings-control-test/1", modes: 1, styles: 1 });
  });

  it("does not advance revision for unchanged or absent values", async () => {
    expect(await saveSystemSettings({
      actorId, expected: 3, namespace: "gateway",
      values: { chat_ua: "settings-control-test/1", gateway_ua: "" },
    })).toEqual({ revision: 3, changed: false });
    expect(await saveSystemSettings({
      actorId, expected: 3, namespace: "task", values: { title_model: "", title_model_id: "" },
    })).toEqual({ revision: 3, changed: false });
    expect(await getSettingsRevision()).toBe(3);
  });

  it("rolls back validation failures and late database write failures", async () => {
    await expect(saveSystemSettings({
      actorId, expected: 3, namespace: "task",
      values: { title_model: "must-not-apply", title_model_id: randomUUID() },
    })).rejects.toBeInstanceOf(SettingsValidationError);
    // 在隔离库中模拟最后一步版本更新失败，验证此前配置写入一起回滚。
    await pool.query(`ALTER TABLE "settings_control_state" ADD CONSTRAINT "test_reject_next_save" CHECK ("current_revision" <= 3)`);
    try {
      await expect(saveSystemSettings({
        actorId, expected: 3, namespace: "gateway", values: { chat_ua: "must-not-apply" },
      })).rejects.toThrow();
    } finally {
      await pool.query(`ALTER TABLE "settings_control_state" DROP CONSTRAINT "test_reject_next_save"`);
    }
    expect(await getSettingsRevision()).toBe(3);
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
    expect(rejected?.reason).toBeInstanceOf(SettingsConflictError);
    expect(await getSettingsRevision()).toBe(4);
  });

  it("rejects invalid revision tokens before touching settings", async () => {
    for (const expected of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(saveSystemSettings({
        actorId, expected, namespace: "gateway", values: { chat_ua: "invalid" },
      })).rejects.toBeInstanceOf(SettingsValidationError);
    }
  });

  it("removes settings history without changing effective settings or revision", async () => {
    const client = await pool.connect();
    const schema = `settings_migration_${randomUUID().replaceAll("-", "")}`;
    const baseline = readFileSync(join(process.cwd(), "drizzle/pg/0000_baseline.sql"), "utf8");
    const cleanup = readFileSync(join(process.cwd(), "drizzle/pg/0001_remove_settings_drafts.sql"), "utf8");
    const removeHistory = readFileSync(join(process.cwd(), "drizzle/pg/0002_remove_settings_history.sql"), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(`CREATE TYPE settings_change_set_status AS ENUM ('draft', 'applied', 'abandoned')`);
      await client.query(`CREATE TYPE settings_change_set_kind AS ENUM ('edit', 'rollback')`);
      await client.query(baseline.slice(
        baseline.indexOf('CREATE TABLE "settings_change_sets"'),
        baseline.indexOf('--> statement-breakpoint', baseline.indexOf('CREATE TABLE "settings_change_sets"')),
      ));
      await client.query(`CREATE UNIQUE INDEX settings_change_sets_single_draft_idx ON settings_change_sets (status) WHERE status='draft'`);
      await client.query(baseline.slice(
        baseline.indexOf('CREATE FUNCTION "prevent_applied_settings_change_set_mutation"'),
        baseline.indexOf('--> statement-breakpoint', baseline.indexOf('CREATE TRIGGER "settings_change_sets_applied_immutable"')),
      ));
      await client.query(`INSERT INTO settings_change_sets
        (id, actor_id, base_revision, status, applied_revision, applied_at, abandoned_at)
        VALUES ('saved', 'actor', 0, 'applied', 1, now(), null),
               ('pending', 'actor', 1, 'draft', null, null, null),
               ('discarded', 'actor', 1, 'abandoned', null, null, now())`);
      await client.query(`CREATE TABLE system_settings (LIKE public.system_settings INCLUDING ALL)`);
      await client.query(`CREATE TABLE settings_control_state (LIKE public.settings_control_state INCLUDING ALL)`);
      await client.query(`INSERT INTO system_settings (namespace, key, value) VALUES ('gateway', 'chat_ua', 'keep')`);
      await client.query(`INSERT INTO settings_control_state (id, current_revision) VALUES ('global', 12)`);
      await client.query(cleanup.replaceAll('"public".', `"${schema}".`));
      await client.query(removeHistory.replaceAll('"public".', `"${schema}".`));
      const history = await client.query("SELECT to_regclass($1) AS table, to_regprocedure($2) AS guard", [
        `${schema}.settings_change_sets`, `${schema}.prevent_applied_settings_change_set_mutation()`,
      ]);
      expect(history.rows[0]).toEqual({ table: null, guard: null });
      expect((await client.query("SELECT value FROM system_settings")).rows).toEqual([{ value: "keep" }]);
      expect((await client.query("SELECT current_revision FROM settings_control_state")).rows)
        .toEqual([{ current_revision: "12" }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
