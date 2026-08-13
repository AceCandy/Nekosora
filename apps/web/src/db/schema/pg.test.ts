import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  apiKeys,
  conversationShares,
  conversationShareUnlockAttempts,
  conversations,
  gatewayAttempts,
  gatewayExecutions,
  gatewayRetentionState,
  messageFileObjects,
  memoryExtractionJobs,
  runs,
} from "./pg";

describe("API key schema", () => {
  it("声明 prefix 索引且不再声明父子关系", () => {
    expect("parentId" in apiKeys).toBe(false);

    const config = getTableConfig(apiKeys);
    const prefixIndex = config.indexes.find(
      (candidate) => candidate.config.name === "api_keys_key_prefix_idx",
    );
    expect(prefixIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["key_prefix"]);
    expect(config.indexes.some(
      (candidate) => candidate.config.name === "api_keys_parent_idx",
    )).toBe(false);
  });
});

describe("gateway observability schema", () => {
  it("声明 execution final fact 与唯一 attempt 序号", () => {
    expect(gatewayExecutions.requestId.name).toBe("request_id");
    expect(gatewayExecutions.operation.notNull).toBe(true);
    expect(gatewayExecutions.status.default).toBe("running");
    expect(gatewayExecutions.modelType.name).toBe("model_type");

    const executionConfig = getTableConfig(gatewayExecutions);
    const retentionIndex = executionConfig.indexes.find(
      (candidate) => candidate.config.name === "gateway_executions_retention_idx",
    );
    expect(retentionIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["status", "created_at", "id"]);
    expect(gatewayRetentionState.lastClaimedDate.name).toBe("last_claimed_date");

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

describe("conversation navigation schema", () => {
  it("声明匹配 user、分组、更新时间与 id 的导航索引", () => {
    const navigationIndex = getTableConfig(conversations).indexes.find(
      (candidate) => candidate.config.name === "conversations_navigation_idx",
    );
    expect(navigationIndex).toBeDefined();
    expect(navigationIndex?.config.columns).toHaveLength(4);
    expect(navigationIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["user_id", null, "updated_at", "id"]);
    expect(navigationIndex?.config.columns.slice(2).every(
      (column) => "indexConfig" in column && column.indexConfig.order === "desc",
    ))
      .toBe(true);
  });

  it("同步导航索引迁移、journal 与 snapshot", () => {
    const migration = readFileSync("drizzle/pg/0013_noisy_adam_destine.sql", "utf8");
    const journal = JSON.parse(readFileSync("drizzle/pg/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const snapshot = JSON.parse(readFileSync("drizzle/pg/meta/0013_snapshot.json", "utf8")) as {
      tables: Record<string, { indexes: Record<string, { columns: Array<{ expression: string; asc: boolean }> }> }>;
    };

    expect(migration).toMatch(/CREATE INDEX "conversations_navigation_idx"[\s\S]*"user_id"[\s\S]*case when "archived"[\s\S]*"updated_at" DESC[\s\S]*"id" DESC/);
    expect(journal.entries.at(-1)).toMatchObject({ idx: 13, tag: "0013_noisy_adam_destine" });
    expect(snapshot.tables["public.conversations"].indexes.conversations_navigation_idx.columns)
      .toMatchObject([
        { expression: "user_id", asc: true },
        { asc: true },
        { expression: "updated_at", asc: false },
        { expression: "id", asc: false },
      ]);
  });
});

describe("memory extraction jobs schema", () => {
  it("声明 run 唯一 durable intent、级联外键与恢复索引", () => {
    expect(memoryExtractionJobs.runId.isUnique).toBe(true);
    expect(memoryExtractionJobs.messages.notNull).toBe(true);

    const config = getTableConfig(memoryExtractionJobs);
    const foreignTables = config.foreignKeys.map((foreignKey) =>
      foreignKey.reference().foreignTable[Symbol.for("drizzle:Name")]
    );
    expect(foreignTables).toEqual(expect.arrayContaining(["runs", "conversations", "user"]));

    const dispatchIndex = config.indexes.find(
      (candidate) => candidate.config.name === "memory_extraction_jobs_dispatch_idx",
    );
    expect(dispatchIndex?.config.columns.map((column) => "name" in column ? column.name : null))
      .toEqual(["dispatch_after", "created_at"]);
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
