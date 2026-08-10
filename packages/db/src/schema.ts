/**
 * PostgreSQL schema —— Better Auth 认证表 + Nekusora 业务表。
 *
 * pgvector 用于向量检索(文件 RAG)。
 */
import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  vector,
  pgEnum,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ModelCapabilities,
  ModelDefaultParams,
  ModelType,
  ContextPolicy,
  TokenUsage,
  ProcessTrace,
  ConversationShareMessageSnapshot,
  ConversationShareMode,
  ConversationShareRenderStyleSnapshot,
  MessageVersionSelections,
  MemoryExtractionMessage,
  RouteApiFormat,
} from "./types";

// ===========================================================================
// Better Auth 认证表(admin 插件 + 自定义 status)
// ===========================================================================

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // admin 插件
    role: text("role").notNull().default("user"), // "user" | "admin"
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    // 自定义
    status: text("status").notNull().default("active"), // "active" | "disabled"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 仅 admin 行进入索引,从数据库层确保全局只有一个管理员。
    uniqueIndex("user_single_admin_unique_idx").on(t.role).where(sql`${t.role} = 'admin'`),
  ],
);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// ===========================================================================
// 密钥层级(单表自引用)
//   主 Key: kind='master', parent_id=NULL, 每用户唯一
//   子 Key: kind='sub', parent_id=主key.id, 可多个
// ===========================================================================

export const apiKeyKinds = pgEnum("api_key_kind", ["master", "sub"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id"), // 主 key 为 NULL;子 key 指向主 key.id
    kind: apiKeyKinds("kind").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(), // sha256(完整 sk 字符串)
    keyPrefix: text("key_prefix").notNull(), // 脱敏预览;兼容旧的前缀+省略号格式
    enabled: boolean("enabled").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_keys_user_idx").on(t.userId),
    index("api_keys_parent_idx").on(t.parentId),
    // 每用户仅一个主 key:部分唯一索引,仅约束 kind='master' 的行。
    uniqueIndex("api_keys_master_unique_idx")
      .on(t.userId)
      .where(sql`kind = 'master'`),
  ],
);

// ===========================================================================
// 全局 Provider / 模型(管理员域,四表路由器)
// ===========================================================================

export const providerProtocol = pgEnum("provider_protocol", [
  "openai",
  "anthropic",
  "gemini",
  "openai-compatible",
  // P1-D:非 chat 协议族(OpenAI 兼容格式)。
  "openai-images",
  "openai-audio-stt",
  "openai-audio-tts",
]);
export const modelVisibility = pgEnum("model_visibility", ["public", "private"]);
export const routeApiFormat = pgEnum("route_api_format", [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "gemini-generate-content",
  "openai-images",
  "openai-audio-stt",
  "openai-audio-tts",
]);

export const modelCatalog = pgTable(
  "model_catalog",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    canonicalModelId: text("canonical_model_id").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    modelType: text("model_type").$type<ModelType>().notNull(),
    capabilities: jsonb("capabilities").$type<ModelCapabilities>().notNull().default({}),
    defaultParams: jsonb("default_params").$type<ModelDefaultParams>().notNull().default({}),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("model_catalog_canonical_model_id_unique_idx").on(t.canonicalModelId),
    index("model_catalog_enabled_sort_idx").on(t.enabled, t.sortOrder),
  ],
);

/** 单个 key 的存活探测结果(用 index 标识第几个 key,不存明文 key)。 */
export interface ProviderKeyResult {
  index: number;
  ok: boolean;
  errorKind?: "auth" | "network" | "unknown";
  error?: string;
}

export const providers = pgTable(
  "providers",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    protocol: providerProtocol("protocol").notNull(),
    baseUrl: text("base_url").notNull(),
    apiKeysEnc: text("api_keys_enc").notNull(), // AES-GCM 加密的密钥 bundle JSON
    keyStrategy: text("key_strategy").notNull().default("round_robin"),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    connectTimeoutMs: integer("connect_timeout_ms"),
    readTimeoutMs: integer("read_timeout_ms"),
    streamIdleTimeoutMs: integer("stream_idle_timeout_ms"),
    headersJson: jsonb("headers_json").$type<Record<string, string>>(),
    // null=待探测;false=上游明确拒绝 stream_options。true 保留给显式正向能力。
    supportsStreamUsage: boolean("supports_stream_usage"),
    // 最近一次全量密钥检测的聚合健康度(检测所有 key 后回写)。
    lastHealthCheckedAt: timestamp("last_health_checked_at", { withTimezone: true }),
    lastHealthyKeyCount: integer("last_healthy_key_count"),
    lastTotalKeyCount: integer("last_total_key_count"),
    // 网络层连通判定:任一 key 探测非 network 即通(能连上服务器)。null=未检测。
    lastNetworkOk: boolean("last_network_ok"),
    // 逐 key 探测结果(用 index 标识第几个 key,不存明文 key)。null=未检测。
    lastKeyResults: jsonb("last_key_results").$type<ProviderKeyResult[]>(),
    // 检测模型(手填或从上游模型列表选),用于后续深度健康检测;空表示未配置。
    testModel: text("test_model"),
    // 最近一次深度检测结果(用 testModel 发极小生成验证 model+key+协议全链路);null=未检测。
    lastModelProbeOk: boolean("last_model_probe_ok"),
    lastModelProbeAt: timestamp("last_model_probe_at", { withTimezone: true }),
    lastModelProbeError: text("last_model_probe_error"),
    // 最近一次拉取并落库的上游模型 id 列表(/models);空表示未拉取。
    upstreamModels: jsonb("upstream_models").$type<string[]>(),
    upstreamModelsAt: timestamp("upstream_models_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("providers_owner_idx").on(t.ownerUserId),
    uniqueIndex("providers_owner_name_idx").on(t.ownerUserId, t.name),
  ],
);

export const models = pgTable(
  "models",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    visibility: modelVisibility("visibility").notNull().default("private"), // public=admin 发布给所有人 WebChat 可选;private=仅 owner
    name: text("name").notNull(), // 对外模型名(用户/调用方看到)
    displayName: text("display_name"),
    catalogId: text("catalog_id")
      .notNull()
      .references(() => modelCatalog.id, { onDelete: "restrict" }),
    icon: text("icon"),
    systemPrompt: text("system_prompt"),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("models_owner_idx").on(t.ownerUserId),
    index("models_visibility_idx").on(t.visibility),
    index("models_catalog_idx").on(t.catalogId),
    uniqueIndex("models_owner_name_idx").on(t.ownerUserId, t.name),
  ],
);

export const routes = pgTable(
  "routes",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    upstreamModelName: text("upstream_model_name").notNull(),
    apiFormat: routeApiFormat("api_format").$type<RouteApiFormat>().notNull(),
    priority: integer("priority").notNull().default(0),
    weight: integer("weight").notNull().default(1),
    supportsTools: boolean("supports_tools").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    headersJson: jsonb("headers_json").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("routes_model_idx").on(t.modelId),
    index("routes_owner_idx").on(t.ownerUserId),
  ],
);

// ===========================================================================
// 子 Key 模型绑定(收敛为单 modelId;原 scope+globalModelId+userModelId 已废弃)
// ===========================================================================

export const keyModelBindings = pgTable(
  "key_model_bindings",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    keyId: text("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("key_model_bindings_key_idx").on(t.keyId),
    uniqueIndex("key_model_bindings_unique_idx").on(t.keyId, t.modelId),
  ],
);

// ===========================================================================
// WebChat 会话 / 消息(双链树)/ runs / 工具调用
// ===========================================================================

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("新会话"),
    projectId: text("project_id"),
    modelName: text("model_name"), // 记录使用的对外模型名
    outputModeId: text("output_mode_id"), // 当前会话的输出模式(管理员预设的 prompt 模板)
    renderStyleId: text("render_style_id"), // 当前会话的输出样式(管理员预设的渲染 CSS)
    messageVersionSelections: jsonb("message_version_selections").$type<MessageVersionSelections>(),
    webSearch: boolean("web_search").notNull().default(false), // 当前会话是否启用联网搜索
    composerState: jsonb("composer_state").$type<import("./types").ComposerState>(), // 指令卡 / 知识库等数组型会话状态
    pinned: boolean("pinned").notNull().default(false), // 是否置顶
    archived: boolean("archived").notNull().default(false), // 是否归档
    generating: boolean("generating").notNull().default(false), // 遗留回滚兼容列;新 runtime 从有效 run 租约派生,不读写
    contextPolicy: jsonb("context_policy").$type<ContextPolicy>(), // per-conversation 快照
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.userId)],
);

/** 会话标题任务 outbox；业务完成前保留，供 worker 周期重投。 */
export const conversationTitleJobs = pgTable(
  "conversation_title_jobs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .unique()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    firstUserMessage: text("first_user_message").notNull(),
    fallbackTitle: text("fallback_title").notNull(),
    chatModel: text("chat_model"),
    chatModelId: text("chat_model_id"),
    dispatchAfter: timestamp("dispatch_after", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_title_jobs_dispatch_idx").on(t.dispatchAfter, t.createdAt),
  ],
);

export const messageStatus = pgEnum("message_status", [
  "pending",
  "streaming",
  "success",
  "interrupted",
]);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull().unique(), // 稳定 UUID,客户端可见
    parentId: text("parent_id"), // 自引用:分支树父节点
    sourceId: text("source_id"), // 自引用:fork 点(被重试/编辑的原消息)
    runId: text("run_id"), // "run_" + uuid
    role: text("role").notNull(), // "user" | "assistant" | "system"
    content: jsonb("content").notNull(), // OpenAI 消息内容格式
    reasoning: text("reasoning"), // 推理过程(thinking),仅 reasoning 模型产出
    contentType: text("content_type").notNull().default("text"),
    branchReason: text("branch_reason"), // "retry" | "edit" | ...
    status: messageStatus("status").notNull().default("success"),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    processTrace: jsonb("process_trace").$type<ProcessTrace>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // 软删除时间戳;null 表示未删
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_parent_idx").on(t.parentId),
    index("messages_run_idx").on(t.runId),
  ],
);

/** 用户对 assistant 回复的质量反馈；每个用户对每条消息最多一条，可覆盖或撤销。 */
export const messageFeedback = pgTable(
  "message_feedback",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rating: text("rating").notNull(), // "up" | "down"；写入入口负责校验
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("message_feedback_user_message_unique_idx").on(t.userId, t.messageId),
    index("message_feedback_conversation_idx").on(t.conversationId),
    index("message_feedback_rating_idx").on(t.rating),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: text("run_id").notNull().unique(),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    upstreamId: text("upstream_id"),
    platformModelName: text("platform_model_name"),
    routedBindingCode: text("routed_binding_code"),
    firstTokenLatencyMs: integer("first_token_latency_ms"),
    durationMs: integer("duration_ms"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    tokenUsage: jsonb("token_usage").$type<TokenUsage>(),
    status: text("status").notNull().default("running"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true })
      .default(sql`now() + interval '2 minutes'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("runs_active_conversation_idx")
      .on(t.conversationId, t.leaseExpiresAt)
      .where(sql`${t.status} = 'running'`),
  ],
);

/** Chat 完成事务写入的记忆提取 durable intent；业务完成前保留。 */
export const memoryExtractionJobs = pgTable(
  "memory_extraction_jobs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .unique()
      .references(() => runs.runId, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    messages: jsonb("messages").$type<MemoryExtractionMessage[]>().notNull(),
    dispatchAfter: timestamp("dispatch_after", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memory_extraction_jobs_dispatch_idx").on(t.dispatchAfter, t.createdAt),
  ],
);

export const toolCalls = pgTable("tool_calls", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: text("run_id")
    .notNull()
    .references(() => runs.runId, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  toolType: text("tool_type").notNull(), // "server" | "local"
  toolName: text("tool_name").notNull(),
  status: text("status").notNull().default("pending"),
  inputJson: jsonb("input_json"),
  outputJson: jsonb("output_json"),
  errorJson: jsonb("error_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationProjects = pgTable("conversation_projects", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt"),
  color: text("color"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===========================================================================
// MCP servers(P1-A —— 外部工具接入)
// ===========================================================================

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=全局
    name: text("name").notNull(),
    transport: text("transport").notNull(), // "stdio" | "sse" | "http"
    command: text("command"),
    args: jsonb("args").$type<string[]>(),
    envEnc: text("env_enc"),
    url: text("url"),
    headersJson: jsonb("headers_json").$type<Record<string, string>>(),
    enabled: boolean("enabled").notNull().default(true),
    cachedTools: jsonb("cached_tools").$type<unknown[]>(),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_servers_user_idx").on(t.userId), index("mcp_servers_enabled_idx").on(t.enabled)],
);

// ===========================================================================
// Artifacts(P1-B —— 代码块/Mermaid/SVG 等可渲染产物)
// ===========================================================================

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    language: text("language"),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    parentArtifactId: text("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifacts_msg_idx").on(t.messageId), index("artifacts_conv_idx").on(t.conversationId)],
);

export const conversationShares = pgTable(
  "conversation_shares",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    shareId: text("share_id").notNull().unique(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    mode: text("mode").$type<ConversationShareMode>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    passwordVerifier: text("password_verifier"),
    renderStyleSnapshot: jsonb("render_style_snapshot").$type<ConversationShareRenderStyleSnapshot>(),
    titleSnapshot: text("title_snapshot"),
    modelSnapshot: text("model_snapshot"),
    messageIdsJson: jsonb("message_ids_json").$type<string[]>(),
    defaultMessageIdsJson: jsonb("default_message_ids_json").$type<string[]>(),
    messageSnapshotsJson: jsonb("message_snapshots_json").$type<ConversationShareMessageSnapshot[]>(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    regeneratedAt: timestamp("regenerated_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_shares_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

/** 受密码保护分享的失败解锁窗口；来源仅保存域分离 HMAC 指纹。 */
export const conversationShareUnlockAttempts = pgTable(
  "conversation_share_unlock_attempts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    shareId: text("share_id")
      .notNull()
      .references(() => conversationShares.shareId, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    clientFingerprint: text("client_fingerprint").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
    failureCount: integer("failure_count").notNull().default(0),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_share_unlock_attempts_bucket_idx")
      .on(t.shareId, t.scope, t.clientFingerprint),
    index("conversation_share_unlock_attempts_updated_idx").on(t.updatedAt),
  ],
);

// ===========================================================================
// 图像生成任务
// ===========================================================================

/** 图像生成任务状态。 */
export type ImageJobStatus = "pending" | "done" | "failed";

export const imageJobs = pgTable(
  "image_jobs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    n: integer("n").notNull().default(1),
    size: text("size"),
    status: text("status").notNull().default("pending"),
    resultUrls: jsonb("result_urls").$type<string[]>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("image_jobs_user_idx").on(t.userId)],
);

// ===========================================================================
// 知识库(多库 RAG)
// ===========================================================================

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_bases_user_idx").on(t.userId)],
);

// ===========================================================================
// 文件 / RAG
// ===========================================================================

export const fileObjects = pgTable(
  "file_objects",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    knowledgeBaseId: text("knowledge_base_id"),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    storagePath: text("storage_path").notNull(),
    size: integer("size").notNull(),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingLeaseId: text("processing_lease_id"),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", { withTimezone: true }),
    extractStatus: text("extract_status"),
    extractEngine: text("extract_engine"),
    extractChars: integer("extract_chars"),
    extractPages: integer("extract_pages"),
    ocrUsed: boolean("ocr_used"),
    ragReady: boolean("rag_ready").notNull().default(false),
    ragReason: text("rag_reason"),
    embedStatus: text("embed_status"),
    embedError: text("embed_error"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("file_objects_user_idx").on(t.userId),
    index("file_objects_stale_processing_idx")
      .on(t.processingLeaseExpiresAt, t.createdAt)
      .where(sql`${t.processingStatus} IN ('extracting', 'embedding')`),
    index("file_objects_pending_processing_idx")
      .on(t.createdAt, t.id)
      .where(sql`${t.processingStatus} = 'pending'`),
  ],
);

export const fileChunks = pgTable(
  "file_chunks",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    fileId: text("file_id")
      .notNull()
      .references(() => fileObjects.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    pageNum: integer("page_num"),
    charOffset: integer("char_offset"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: vector("embedding", { dimensions: 1024 }),
  },
  (t) => [
    index("file_chunks_file_idx").on(t.fileId),
    // pgvector 的 HNSW 相似度索引由迁移后置 SQL 创建(drizzle 暂无声明式向量索引 API):
    //   CREATE INDEX file_chunks_embedding_idx ON file_chunks
    //     USING hnsw (embedding vector_cosine_ops);
  ],
);

/** 用户消息与聊天图片文件的有序关联；文件实体沿用既有生命周期。 */
export const messageFileObjects = pgTable(
  "message_file_objects",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => fileObjects.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [
    primaryKey({
      name: "message_file_objects_message_file_pk",
      columns: [t.messageId, t.fileId],
    }),
    uniqueIndex("message_file_objects_message_sort_unique_idx").on(
      t.messageId,
      t.sortOrder,
    ),
    index("message_file_objects_file_message_idx").on(t.fileId, t.messageId),
  ],
);

export const contextSnapshots = pgTable("context_snapshots", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => messages.id, {
    onDelete: "cascade",
  }),
  runId: text("run_id"),
  fromTurn: integer("from_turn"),
  toTurn: integer("to_turn"),
  coveredUntilMessageId: text("covered_until_message_id"),
  coveredUntilPublicId: text("covered_until_public_id"),
  coveragePathHash: text("coverage_path_hash").notNull(), // 滚动 SHA(id:publicID:parentID:role)
  coveredMessageCount: integer("covered_message_count").notNull(),
  sourceTokens: integer("source_tokens"),
  summaryTokens: integer("summary_tokens"),
  summaryText: text("summary_text").notNull(),
  strategy: text("strategy").notNull(), // "turn_cap" | "token_cap"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===========================================================================
// Prompt 模板 / Agent 模板(P2-B)
// ===========================================================================

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // "builtin" | "private" | "shared"
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    icon: text("icon"),
    systemPrompt: text("system_prompt"),
    userTemplate: text("user_template"),
    variables: jsonb("variables").$type<unknown[]>(),
    recommendedModel: text("recommended_model"),
    isAgent: boolean("is_agent").notNull().default(false),
    agentConfig: jsonb("agent_config").$type<unknown>(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    useCount: integer("use_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("prompt_templates_scope_idx").on(t.scope)],
);

/**
 * 指令卡(instruction_cards)—— DEEIX skill 模式的本地实现。
 *
 * 本质:带 slash trigger 的可共享 system prompt 片段(纯文本,无执行能力)。
 * 用户发消息时手动勾选若干卡,服务端渲染为 <instruction_card_context> XML 注入 system message。
 *
 * scope:
 *   - builtin  系统内置(管理员配,全用户可见)
 *   - shared   用户共享(全用户可见,仅属主可改)
 *   - private  私有(仅属主可见)
 *
 * trigger:slash 命令名(如 "翻译官"),用户输入 /翻译官 或在 UI 勾选触发。
 * markdown:指令正文(支持 markdown 语法,上限 10000 字符)。
 */
export const instructionCards = pgTable(
  "instruction_cards",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=builtin
    scope: text("scope").notNull(), // "builtin" | "private" | "shared"
    trigger: text("trigger").notNull(), // slash 命令名(唯一性由应用层在 scope 内保证)
    title: text("title").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(), // 指令正文
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    useCount: integer("use_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("instruction_cards_scope_idx").on(t.scope),
    index("instruction_cards_user_idx").on(t.userId),
  ],
);

// ===========================================================================
// 输出模式(管理员预设的会话级输出模式,如「HTML 渲染」「简洁输出」)
// ===========================================================================

export const outputModes = pgTable(
  "output_modes",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(), // 显示名(如「HTML 渲染」)
    description: text("description"),
    systemPrompt: text("system_prompt").notNull(), // 注入会话的 system 指令
    icon: text("icon"), // 图标名(lucide,可选)
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("output_modes_enabled_idx").on(t.enabled)],
);

// ===========================================================================
// 输出样式(管理员预设的会话级 Markdown 渲染样式,纯渲染层不影响模型输出)
// cssClass 作为稳定 slug,对应 DOM 上的 rs-{cssClass} 类,也是 CSS 选择器前缀
// ===========================================================================

export const renderStyles = pgTable(
  "render_styles",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    description: text("description"),
    cssClass: text("css_class").notNull(), // 稳定 slug,对应 .rs-{cssClass} 选择器
    css: text("css").notNull(), // 聚合注入页面的样式文本
    icon: text("icon"),
    renderer: text("renderer").notNull().default("streamdown"), // 渲染器:streamdown(默认) | custom(流式结束后用内置解析器重渲,支持完整 CSS)
    builtin: boolean("builtin").notNull().default(false), // 系统内置(不可删,遵守 DESIGN)
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("render_styles_enabled_idx").on(t.enabled),
    uniqueIndex("render_styles_css_class_idx").on(t.cssClass),
  ],
);

// ===========================================================================
// 设置 / 用量
// ===========================================================================

export const systemSettings = pgTable(
  "system_settings",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("system_settings_unique_idx").on(t.namespace, t.key)],
);

export const userSettings = pgTable(
  "user_settings",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_settings_unique_idx").on(t.userId, t.key)],
);

/** 一次用户可见或后台逻辑网关执行的最终事实。 */
export const gatewayExecutions = pgTable(
  "gateway_executions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    requestId: text("request_id").notNull(),
    operation: text("operation").notNull(),
    source: text("source").notNull(), // "chat" | "gateway"
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    keyKind: text("key_kind"), // "master" | "sub" | null(chat)
    model: text("model").notNull(),
    modelId: text("model_id"),
    providerRef: text("provider_ref"),
    providerName: text("provider_name"),
    routeId: text("route_id"),
    routeName: text("route_name"),
    upstreamModel: text("upstream_model"),
    upstreamKeyMasked: text("upstream_key_masked"),
    requestPath: text("request_path"),
    stream: boolean("stream").notNull().default(false),
    status: text("status").notNull().default("running"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorPhase: text("error_phase"),
    errorType: text("error_type"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    firstTokenLatencyMs: integer("first_token_latency_ms"),
    taskKind: text("task_kind"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("gateway_executions_user_idx").on(t.userId),
    index("gateway_executions_created_idx").on(t.createdAt),
    index("gateway_executions_model_idx").on(t.model),
    index("gateway_executions_request_idx").on(t.requestId),
    index("gateway_executions_status_idx").on(t.status),
  ],
);

/** 一次真实上游调用或因协议不兼容而拒绝的 route attempt。 */
export const gatewayAttempts = pgTable(
  "gateway_attempts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    executionId: text("execution_id")
      .notNull()
      .references(() => gatewayExecutions.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull().default("running"),
    providerRef: text("provider_ref"),
    providerName: text("provider_name"),
    providerProtocol: text("provider_protocol"),
    routeId: text("route_id"),
    routeName: text("route_name"),
    upstreamModel: text("upstream_model"),
    upstreamKeyMasked: text("upstream_key_masked"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorPhase: text("error_phase"),
    errorType: text("error_type"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    firstTokenLatencyMs: integer("first_token_latency_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gateway_attempts_execution_attempt_unique_idx").on(t.executionId, t.attempt),
    index("gateway_attempts_execution_idx").on(t.executionId),
    index("gateway_attempts_created_idx").on(t.createdAt),
    index("gateway_attempts_provider_ref_idx").on(t.providerRef),
    index("gateway_attempts_status_idx").on(t.status),
  ],
);

// ===========================================================================
// 共享类型(dialect 中立,re-export)
// ===========================================================================

export type {
  ModelCapabilities,
  ContextPolicy,
  TokenUsage,
  ProcessTraceBlock,
  ProcessTrace,
  ApiKeyKind,
  ProviderProtocol,
  MessageStatus,
  ErrorPhase,
} from "./types";
