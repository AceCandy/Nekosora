import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { conversationShares, conversationShareUnlockAttempts, conversations, runs } from "./pg";

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

describe("conversation share schema", () => {
  it("声明分享配置、版本选择与解锁限流约束", () => {
    expect(conversations.messageVersionSelections.name).toBe("message_version_selections");
    expect(conversationShares.mode.name).toBe("mode");
    expect(conversationShares.expiresAt.name).toBe("expires_at");
    expect(conversationShares.passwordVerifier.name).toBe("password_verifier");
    expect(conversationShares.renderStyleSnapshot.name).toBe("render_style_snapshot");

    const shareIndex = getTableConfig(conversationShares).indexes.find(
      (candidate) => candidate.config.name === "conversation_shares_conversation_created_idx",
    );
    expect(shareIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["conversation_id", "created_at"]);

    const bucketIndex = getTableConfig(conversationShareUnlockAttempts).indexes.find(
      (candidate) => candidate.config.name === "conversation_share_unlock_attempts_bucket_idx",
    );
    expect(bucketIndex?.config.unique).toBe(true);
    expect(bucketIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["share_id", "scope", "client_fingerprint"]);
  });
});
