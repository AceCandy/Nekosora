/**
 * PostgreSQL schema —— Better Auth 认证表 + Nekusora 业务表。
 *
 * pgvector 用于向量检索(文件 RAG)。
 */
import {
  type AnyPgColumn,
  pgTable,
  text,
  boolean,
  bigint,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  vector,
  pgEnum,
  primaryKey,
  check,
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
// 密钥类型
//   主 Key:每用户唯一,不受模型绑定限制
//   子 Key:可多个,按自身 key ID 绑定模型
// ===========================================================================

export const apiKeyKinds = pgEnum("api_key_kind", ["master", "sub"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
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
    index("api_keys_key_prefix_idx").on(t.keyPrefix),
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
    check(
      "providers_connect_timeout_ms_check",
      sql`${t.connectTimeoutMs} between 1000 and 300000`,
    ),
    check(
      "providers_read_timeout_ms_check",
      sql`${t.readTimeoutMs} between 10000 and 3600000`,
    ),
    check(
      "providers_stream_idle_timeout_ms_check",
      sql`${t.streamIdleTimeoutMs} between 5000 and 900000`,
    ),
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
    composerState: jsonb("composer_state").$type<import("./types").ComposerState>(), // 输入区会话状态
    pinned: boolean("pinned").notNull().default(false), // 是否置顶
    archived: boolean("archived").notNull().default(false), // 是否归档
    generating: boolean("generating").notNull().default(false), // 遗留回滚兼容列;新 runtime 从有效 run 租约派生,不读写
    contextPolicy: jsonb("context_policy").$type<ContextPolicy>(), // per-conversation 快照
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_user_idx").on(t.userId),
    index("conversations_navigation_idx").on(
      t.userId,
      sql`(case when ${t.archived} then 2 when ${t.pinned} then 0 else 1 end)`,
      t.updatedAt.desc(),
      t.id.desc(),
    ),
  ],
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

export const settingsChangeSetStatus = pgEnum("settings_change_set_status", [
  "draft",
  "applied",
  "abandoned",
]);

export const settingsChangeSetKind = pgEnum("settings_change_set_kind", ["edit", "rollback"]);

/** 全局设置发布的串行化锁点与缓存代际。 */
export const settingsControlState = pgTable(
  "settings_control_state",
  {
    id: text("id").primaryKey(),
    currentRevision: bigint("current_revision", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("settings_control_state_singleton_check", sql`${t.id} = 'global'`),
    check("settings_control_state_revision_check", sql`${t.currentRevision} >= 0`),
  ],
);

/** 设置草稿与不可变发布历史；changes 仅保存 canonical 资源快照。 */
export const settingsChangeSets = pgTable(
  "settings_change_sets",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    status: settingsChangeSetStatus("status").notNull().default("draft"),
    kind: settingsChangeSetKind("kind").notNull().default("edit"),
    rollbackOf: text("rollback_of").references(
      (): AnyPgColumn => settingsChangeSets.id,
      { onDelete: "restrict" },
    ),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    baseRevision: bigint("base_revision", { mode: "number" }).notNull(),
    appliedRevision: bigint("applied_revision", { mode: "number" }),
    version: integer("version").notNull().default(1),
    changes: jsonb("changes").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("settings_change_sets_single_draft_idx")
      .on(t.status)
      .where(sql`${t.status} = 'draft'`),
    uniqueIndex("settings_change_sets_applied_revision_idx").on(t.appliedRevision),
    index("settings_change_sets_applied_at_idx").on(t.appliedAt),
    check("settings_change_sets_base_revision_check", sql`${t.baseRevision} >= 0`),
    check("settings_change_sets_version_check", sql`${t.version} > 0`),
    check("settings_change_sets_changes_array_check", sql`jsonb_typeof(${t.changes}) = 'array'`),
    check(
      "settings_change_sets_rollback_check",
      sql`(${t.kind} = 'edit' and ${t.rollbackOf} is null)
        or (${t.kind} = 'rollback' and ${t.rollbackOf} is not null)`,
    ),
    check(
      "settings_change_sets_status_check",
      sql`(${t.status} = 'draft'
          and ${t.appliedRevision} is null
          and ${t.appliedAt} is null
          and ${t.abandonedAt} is null)
        or (${t.status} = 'applied'
          and ${t.appliedRevision} is not null
          and ${t.appliedAt} is not null
          and ${t.abandonedAt} is null)
        or (${t.status} = 'abandoned'
          and ${t.appliedRevision} is null
          and ${t.appliedAt} is null
          and ${t.abandonedAt} is not null)`,
    ),
  ],
);

export const gatewayGovernanceOperation = pgEnum("gateway_governance_operation", [
  "chat.stream",
  "chat.generate",
  "image.generate",
  "audio.speech",
  "audio.transcription",
  "mcp.search",
]);

export const gatewayQuotaKind = pgEnum("gateway_quota_kind", [
  "chat_tokens",
  "image_count",
  "tts_code_points",
  "stt_seconds",
]);

export const gatewayGovernanceScope = pgEnum("gateway_governance_scope", ["key", "user"]);

/** API Key 或用户的速率状态，同时作为治理事务的稳定锁点。 */
export const gatewayGovernanceSubjects = pgTable(
  "gateway_governance_subjects",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "cascade" }),
    rateTokens: numeric("rate_tokens", { precision: 20, scale: 6 }).notNull(),
    rateRefilledAt: timestamp("rate_refilled_at", { withTimezone: true }).notNull(),
    metricsMinuteStart: timestamp("metrics_minute_start", { withTimezone: true }),
    metricsMinuteRequests: integer("metrics_minute_requests").notNull().default(0),
    policyFingerprint: text("policy_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gateway_governance_subjects_user_unique_idx")
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("gateway_governance_subjects_api_key_unique_idx")
      .on(t.apiKeyId)
      .where(sql`${t.apiKeyId} is not null`),
    check(
      "gateway_governance_subjects_identity_check",
      sql`num_nonnulls(${t.userId}, ${t.apiKeyId}) = 1`,
    ),
    check("gateway_governance_subjects_rate_tokens_check", sql`${t.rateTokens} >= 0`),
    check(
      "gateway_governance_subjects_metrics_requests_check",
      sql`${t.metricsMinuteRequests} >= 0`,
    ),
  ],
);

/** 不含主体标识的小时治理趋势；计数累加、峰值取最高观测值。 */
export const gatewayGovernanceHourly = pgTable(
  "gateway_governance_hourly",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    scope: gatewayGovernanceScope("scope").notNull(),
    requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
    rpmPeak: integer("rpm_peak").notNull().default(0),
    concurrencyPeak: integer("concurrency_peak").notNull().default(0),
    rateRejected: bigint("rate_rejected", { mode: "number" }).notNull().default(0),
    concurrencyRejected: bigint("concurrency_rejected", { mode: "number" })
      .notNull()
      .default(0),
    quotaChatTokensRejected: bigint("quota_chat_tokens_rejected", { mode: "number" })
      .notNull()
      .default(0),
    quotaImageCountRejected: bigint("quota_image_count_rejected", { mode: "number" })
      .notNull()
      .default(0),
    quotaTtsCodePointsRejected: bigint("quota_tts_code_points_rejected", { mode: "number" })
      .notNull()
      .default(0),
    quotaSttSecondsRejected: bigint("quota_stt_seconds_rejected", { mode: "number" })
      .notNull()
      .default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gateway_governance_hourly_bucket_scope_idx").on(t.bucketStart, t.scope),
    index("gateway_governance_hourly_bucket_idx").on(t.bucketStart),
    check(
      "gateway_governance_hourly_bucket_start_check",
      sql`${t.bucketStart} = date_trunc('hour', ${t.bucketStart} at time zone 'UTC') at time zone 'UTC'`,
    ),
    check(
      "gateway_governance_hourly_non_negative_check",
      sql`${t.requestCount} >= 0
        and ${t.rpmPeak} >= 0
        and ${t.concurrencyPeak} >= 0
        and ${t.rateRejected} >= 0
        and ${t.concurrencyRejected} >= 0
        and ${t.quotaChatTokensRejected} >= 0
        and ${t.quotaImageCountRejected} >= 0
        and ${t.quotaTtsCodePointsRejected} >= 0
        and ${t.quotaSttSecondsRejected} >= 0`,
    ),
  ],
);

/** 按主体、计量单位与 UTC 月份隔离的活动预留和已结算额度。 */
export const gatewayQuotaWindows = pgTable(
  "gateway_quota_windows",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    subjectId: text("subject_id")
      .notNull()
      .references(() => gatewayGovernanceSubjects.id, { onDelete: "cascade" }),
    quotaKind: gatewayQuotaKind("quota_kind").notNull(),
    monthStart: timestamp("month_start", { withTimezone: true }).notNull(),
    reservedUnits: bigint("reserved_units", { mode: "number" }).notNull().default(0),
    usedUnits: bigint("used_units", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gateway_quota_windows_subject_kind_month_unique_idx")
      .on(t.subjectId, t.quotaKind, t.monthStart),
    index("gateway_quota_windows_subject_idx").on(t.subjectId),
    check("gateway_quota_windows_reserved_units_check", sql`${t.reservedUnits} >= 0`),
    check("gateway_quota_windows_used_units_check", sql`${t.usedUnits} >= 0`),
    check(
      "gateway_quota_windows_month_start_check",
      sql`${t.monthStart} = date_trunc('month', ${t.monthStart} at time zone 'UTC') at time zone 'UTC'`,
    ),
  ],
);

/** 活动请求的并发 ownership token 与可选月度额度 reservation。 */
export const gatewayGovernanceLeases = pgTable(
  "gateway_governance_leases",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    keySubjectId: text("key_subject_id")
      .notNull()
      .references(() => gatewayGovernanceSubjects.id, { onDelete: "restrict" }),
    userSubjectId: text("user_subject_id")
      .notNull()
      .references(() => gatewayGovernanceSubjects.id, { onDelete: "restrict" }),
    operation: gatewayGovernanceOperation("operation").notNull(),
    quotaKind: gatewayQuotaKind("quota_kind"),
    quotaMonthStart: timestamp("quota_month_start", { withTimezone: true }),
    reservedUnits: bigint("reserved_units", { mode: "number" }),
    providerStartedAt: timestamp("provider_started_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("gateway_governance_leases_key_expiry_idx").on(t.keySubjectId, t.leaseExpiresAt),
    index("gateway_governance_leases_user_expiry_idx").on(t.userSubjectId, t.leaseExpiresAt),
    index("gateway_governance_leases_expiry_id_idx").on(t.leaseExpiresAt, t.id),
    check(
      "gateway_governance_leases_quota_fields_check",
      sql`(
        ${t.quotaKind} is null
        and ${t.quotaMonthStart} is null
        and ${t.reservedUnits} is null
      ) or (
        ${t.quotaKind} is not null
        and ${t.quotaMonthStart} is not null
        and ${t.reservedUnits} > 0
      )`,
    ),
  ],
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
    modelType: text("model_type").$type<ModelType>(),
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
    imageCount: integer("image_count"),
    ttsCodePoints: integer("tts_code_points"),
    sttSeconds: integer("stt_seconds"),
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
    index("gateway_executions_retention_idx").on(t.status, t.createdAt, t.id),
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
    imageCount: integer("image_count"),
    ttsCodePoints: integer("tts_code_points"),
    sttSeconds: integer("stt_seconds"),
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

/** 协调多 Worker 每日最多领取一次 Gateway 日志保留任务。 */
export const gatewayRetentionState = pgTable("gateway_retention_state", {
  id: text("id").primaryKey(),
  lastClaimedDate: date("last_claimed_date").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===========================================================================
// 共享类型(dialect 中立,re-export)
// ===========================================================================

export type {
  ModelCapabilities,
  ModelType,
  ContextPolicy,
  TokenUsage,
  ProcessTraceBlock,
  ProcessTrace,
  ApiKeyKind,
  ProviderProtocol,
  MessageStatus,
  ErrorPhase,
} from "./types";
