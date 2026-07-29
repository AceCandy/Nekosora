import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  conversationShares,
  conversationShareUnlockAttempts,
  conversations,
  gatewayAttempts,
  gatewayExecutions,
  messageFileObjects,
  runs,
} from "./pg";

describe("gateway observability schema", () => {
  it("声明 execution final fact 与唯一 attempt 序号", () => {
    expect(gatewayExecutions.requestId.name).toBe("request_id");
    expect(gatewayExecutions.operation.notNull).toBe(true);
    expect(gatewayExecutions.status.default).toBe("running");

    const attemptConfig = getTableConfig(gatewayAttempts);
    const uniqueAttempt = attemptConfig.indexes.find(
      (candidate) => candidate.config.name === "gateway_attempts_execution_attempt_unique_idx",
    );
    expect(uniqueAttempt?.config.unique).toBe(true);
    expect(uniqueAttempt?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["execution_id", "attempt"]);
    expect(attemptConfig.foreignKeys[0]?.reference().foreignTable).toBe(gatewayExecutions);
  });
});

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

  it("声明 nullable 的整轮耗时与完成时间", () => {
    expect(runs.durationMs.name).toBe("duration_ms");
    expect(runs.durationMs.notNull).toBe(false);
    expect(runs.completedAt.name).toBe("completed_at");
    expect(runs.completedAt.notNull).toBe(false);
    expect(runs.completedAt.getSQLType()).toBe("timestamp with time zone");
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

describe("message file objects schema", () => {
  it("声明消息附件主键、稳定顺序和文件反向索引", () => {
    const config = getTableConfig(messageFileObjects);

    expect(config.primaryKeys[0]?.name).toBe("message_file_objects_message_file_pk");
    expect(config.primaryKeys[0]?.columns.map((column) => column.name))
      .toEqual(["message_id", "file_id"]);

    const sortIndex = config.indexes.find(
      (candidate) => candidate.config.name === "message_file_objects_message_sort_unique_idx",
    );
    expect(sortIndex?.config.unique).toBe(true);
    expect(sortIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["message_id", "sort_order"]);

    const reverseIndex = config.indexes.find(
      (candidate) => candidate.config.name === "message_file_objects_file_message_idx",
    );
    expect(reverseIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["file_id", "message_id"]);
  });
});
