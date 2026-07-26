import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { runs } from "./pg";

describe("runs schema", () => {
  it("声明租约列与 running conversation 部分索引", () => {
    expect(runs.leaseExpiresAt.name).toBe("lease_expires_at");

    const activeIndex = getTableConfig(runs).indexes.find(
      (candidate) => candidate.config.name === "runs_active_conversation_idx",
    );
    expect(activeIndex).toBeDefined();
    expect(activeIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["conversation_id", "lease_expires_at"]);
    expect(activeIndex?.config.where).toBeDefined();
  });
});
