import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/lib/infra/db";
import { getGatewayGovernanceInsights } from "./analytics";
import { DEFAULT_GATEWAY_GOVERNANCE_POLICY } from "./policy";

const databaseUrl = process.env.TEST_DATABASE_URL;
const expectedDatabase = process.env.GATEWAY_GOVERNANCE_PG_TEST_DATABASE;
const originalDatabaseUrl = process.env.DATABASE_URL;

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

describePg("gateway governance PostgreSQL analytics", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
  });

  afterAll(async () => {
    try {
      await closeDb();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("compares bigint quota usage with candidate thresholds", async () => {
    await expect(getGatewayGovernanceInsights(
      7,
      DEFAULT_GATEWAY_GOVERNANCE_POLICY,
    )).resolves.toMatchObject({ quotas: expect.any(Array) });
  });
});
