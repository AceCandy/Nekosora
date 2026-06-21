/**
 * SQLite schema —— 与 ./pg.ts 同构,仅列类型与方言差异不同。
 * 枚举用 text 列(PG 用 pgEnum);时间用 unixepoch;向量用 blob(sqlite-vec);
 * UUID 用 lower(hex(randomblob(16)))。
 */
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = sql`(unixepoch())`;
const uuid = sql`(lower(hex(randomblob(16))))`;

// ===========================================================================
// Better Auth 认证表(与 pg.ts 同构)
// ===========================================================================

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("user"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp" }),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ===========================================================================
// 密钥层级
// ===========================================================================

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    kind: text("kind").notNull(), // "master" | "sub"
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("api_keys_user_idx").on(t.userId),
    index("api_keys_parent_idx").on(t.parentId),
    // SQLite 不支持部分唯一索引(标准 SQLite 实际支持 partial index,但 drizzle 表达受限),
    // 这里靠应用层 + 全量唯一约束近似;主 key 唯一性在 keys.ts 的 createMasterKey 里校验。
    uniqueIndex("api_keys_user_kind_idx").on(t.userId, t.kind),
  ],
);

// ===========================================================================
// 全局 Provider / 模型(四表路由器)
// ===========================================================================

export const globalProviders = sqliteTable("global_providers", {
  id: text("id").primaryKey().default(uuid),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeysEnc: text("api_keys_enc").notNull(),
  keyStrategy: text("key_strategy").notNull().default("round_robin"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(0),
  connectTimeoutMs: integer("connect_timeout_ms"),
  readTimeoutMs: integer("read_timeout_ms"),
  streamIdleTimeoutMs: integer("stream_idle_timeout_ms"),
  headersJson: text("headers_json", { mode: "json" }).$type<Record<string, string>>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const globalModels = sqliteTable("global_models", {
  id: text("id").primaryKey().default(uuid),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  vendor: text("vendor"),
  icon: text("icon"),
  capabilities: text("capabilities", { mode: "json" })
    .$type<import("@/db/types").ModelCapabilities>()
    .notNull()
    .default({}),
  systemPrompt: text("system_prompt"),
  description: text("description"),
  accessScope: text("access_scope").notNull().default("public"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const globalRoutes = sqliteTable(
  "global_routes",
  {
    id: text("id").primaryKey().default(uuid),
    modelId: text("model_id")
      .notNull()
      .references(() => globalModels.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => globalProviders.id, { onDelete: "cascade" }),
    upstreamModelName: text("upstream_model_name").notNull(),
    protocol: text("protocol").notNull(),
    priority: integer("priority").notNull().default(0),
    weight: integer("weight").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    headersJson: text("headers_json", { mode: "json" }).$type<Record<string, string>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("global_routes_model_idx").on(t.modelId)],
);

// ===========================================================================
// 用户 BYO
// ===========================================================================

export const userProviders = sqliteTable("user_providers", {
  id: text("id").primaryKey().default(uuid),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEnc: text("api_key_enc").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const userModels = sqliteTable("user_models", {
  id: text("id").primaryKey().default(uuid),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  providerId: text("provider_id")
    .notNull()
    .references(() => userProviders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  upstreamModelName: text("upstream_model_name").notNull(),
  capabilities: text("capabilities", { mode: "json" })
    .$type<import("@/db/types").ModelCapabilities>()
    .notNull()
    .default({}),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

// ===========================================================================
// 子 Key 模型绑定
// ===========================================================================

export const keyModelBindings = sqliteTable(
  "key_model_bindings",
  {
    id: text("id").primaryKey().default(uuid),
    keyId: text("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // "global" | "byo"
    globalModelId: text("global_model_id").references(() => globalModels.id, {
      onDelete: "cascade",
    }),
    userModelId: text("user_model_id").references(() => userModels.id, {
      onDelete: "cascade",
    }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("key_model_bindings_key_idx").on(t.keyId),
    uniqueIndex("key_model_bindings_unique_idx").on(
      t.keyId,
      t.scope,
      t.globalModelId,
      t.userModelId,
    ),
  ],
);

// ===========================================================================
// WebChat 会话 / 消息 / runs / 工具调用
// ===========================================================================

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("新会话"),
    projectId: text("project_id"),
    modelName: text("model_name"),
    contextPolicy: text("context_policy", { mode: "json" })
      .$type<import("@/db/types").ContextPolicy>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("conversations_user_idx").on(t.userId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey().default(uuid),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull().unique(),
    parentId: text("parent_id"),
    sourceId: text("source_id"),
    runId: text("run_id"),
    role: text("role").notNull(),
    content: text("content", { mode: "json" }).notNull(),
    contentType: text("content_type").notNull().default("text"),
    branchReason: text("branch_reason"),
    status: text("status").notNull().default("success"),
    tokenUsage: text("token_usage", { mode: "json" })
      .$type<import("@/db/types").TokenUsage>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    processTrace: text("process_trace", { mode: "json" })
      .$type<import("@/db/types").ProcessTrace>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_parent_idx").on(t.parentId),
    index("messages_run_idx").on(t.runId),
  ],
);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey().default(uuid),
  runId: text("run_id").notNull().unique(),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  upstreamId: text("upstream_id"),
  platformModelName: text("platform_model_name"),
  routedBindingCode: text("routed_binding_code"),
  modelVendor: text("model_vendor"),
  firstTokenLatencyMs: integer("first_token_latency_ms"),
  tokenUsage: text("token_usage", { mode: "json" })
    .$type<import("@/db/types").TokenUsage>(),
  status: text("status").notNull().default("running"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

export const toolCalls = sqliteTable("tool_calls", {
  id: text("id").primaryKey().default(uuid),
  runId: text("run_id")
    .notNull()
    .references(() => runs.runId, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  toolType: text("tool_type").notNull(),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull().default("pending"),
  inputJson: text("input_json", { mode: "json" }),
  outputJson: text("output_json", { mode: "json" }),
  errorJson: text("error_json", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

export const conversationProjects = sqliteTable("conversation_projects", {
  id: text("id").primaryKey().default(uuid),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt"),
  color: text("color"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

// ===========================================================================
// MCP servers(P1-A —— 外部工具接入)
// ===========================================================================

export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=全局
    name: text("name").notNull(),
    transport: text("transport").notNull(), // "stdio" | "sse" | "http"
    command: text("command"), // stdio 模式
    args: text("args", { mode: "json" }).$type<string[]>(),
    envEnc: text("env_enc"), // 环境变量加密(AES-GCM)
    url: text("url"), // sse/http 模式
    headersJson: text("headers_json", { mode: "json" }).$type<Record<string, string>>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    cachedTools: text("cached_tools", { mode: "json" }).$type<unknown[]>(),
    lastConnectedAt: integer("last_connected_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("mcp_servers_user_idx").on(t.userId),
    index("mcp_servers_enabled_idx").on(t.enabled),
  ],
);

// ===========================================================================
// Artifacts(P1-B —— 代码块/Mermaid/SVG 等可渲染产物)
// ===========================================================================

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey().default(uuid),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "code" | "mermaid" | "svg" | "html" | "katex" | "markdown"
    title: text("title").notNull(),
    language: text("language"),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    parentArtifactId: text("parent_artifact_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("artifacts_msg_idx").on(t.messageId),
    index("artifacts_conv_idx").on(t.conversationId),
  ],
);

export const conversationShares = sqliteTable("conversation_shares", {
  id: text("id").primaryKey().default(uuid),
  shareId: text("share_id").notNull().unique(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  titleSnapshot: text("title_snapshot"),
  modelSnapshot: text("model_snapshot"),
  messageIdsJson: text("message_ids_json", { mode: "json" }).$type<string[]>(),
  defaultMessageIdsJson: text("default_message_ids_json", { mode: "json" }).$type<string[]>(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  regeneratedAt: integer("regenerated_at", { mode: "timestamp" }),
  lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

// ===========================================================================
// 文件 / RAG(向量用 blob,sqlite-vec 扩展运行时加载)
// ===========================================================================

export const fileObjects = sqliteTable(
  "file_objects",
  {
    id: text("id").primaryKey().default(uuid),
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
    extractStatus: text("extract_status"),
    extractEngine: text("extract_engine"),
    extractChars: integer("extract_chars"),
    extractPages: integer("extract_pages"),
    ocrUsed: integer("ocr_used", { mode: "boolean" }),
    ragReady: integer("rag_ready", { mode: "boolean" }).notNull().default(false),
    ragReason: text("rag_reason"),
    embedStatus: text("embed_status"),
    embedError: text("embed_error"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("file_objects_user_idx").on(t.userId)],
);

export const fileChunks = sqliteTable(
  "file_chunks",
  {
    id: text("id").primaryKey().default(uuid),
    fileId: text("file_id")
      .notNull()
      .references(() => fileObjects.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    pageNum: integer("page_num"),
    charOffset: integer("char_offset"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    // sqlite-vec 以 JSON 数组字符串或 BLOB 传递;存 JSON 字符串便于可读。
    embedding: text("embedding", { mode: "json" }).$type<number[]>(),
  },
  (t) => [index("file_chunks_file_idx").on(t.fileId)],
);

export const contextSnapshots = sqliteTable("context_snapshots", {
  id: text("id").primaryKey().default(uuid),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  fromTurn: integer("from_turn"),
  toTurn: integer("to_turn"),
  coveredUntilMessageId: text("covered_until_message_id"),
  coveredUntilPublicId: text("covered_until_public_id"),
  coveragePathHash: text("coverage_path_hash").notNull(),
  coveredMessageCount: integer("covered_message_count").notNull(),
  sourceTokens: integer("source_tokens"),
  summaryTokens: integer("summary_tokens"),
  summaryText: text("summary_text").notNull(),
  strategy: text("strategy").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

// ===========================================================================
// Prompt 模板 / Agent 模板(P2-B)
// ===========================================================================

export const promptTemplates = sqliteTable(
  "prompt_templates",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=官方内置
    scope: text("scope").notNull(), // "builtin" | "private" | "shared"
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    icon: text("icon"),
    systemPrompt: text("system_prompt"),
    userTemplate: text("user_template"), // 含 {{var}} 占位符
    variables: text("variables", { mode: "json" }).$type<unknown[]>(),
    recommendedModel: text("recommended_model"),
    isAgent: integer("is_agent", { mode: "boolean" }).notNull().default(false),
    agentConfig: text("agent_config", { mode: "json" }).$type<unknown>(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    useCount: integer("use_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("prompt_templates_scope_idx").on(t.scope)],
);

/**
 * 指令卡(instruction_cards)—— DEEIX skill 模式的本地实现。
 *
 * 本质:带 slash trigger 的可共享 system prompt 片段(纯文本,无执行能力)。
 * 与 pg.ts 同名表语义一致,仅列类型差异。详见 pg.ts 的注释。
 */
export const instructionCards = sqliteTable(
  "instruction_cards",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // null=builtin
    scope: text("scope").notNull(), // "builtin" | "private" | "shared"
    trigger: text("trigger").notNull(), // slash 命令名
    title: text("title").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(), // 指令正文
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    useCount: integer("use_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("instruction_cards_scope_idx").on(t.scope),
    index("instruction_cards_user_idx").on(t.userId),
  ],
);

export const userMemories = sqliteTable(
  "user_memories",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    content: text("content").notNull(),
    embedding: text("embedding", { mode: "json" }).$type<number[]>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("user_memories_user_idx").on(t.userId)],
);

// ===========================================================================
// 设置 / 用量
// ===========================================================================

export const systemSettings = sqliteTable(
  "system_settings",
  {
    id: text("id").primaryKey().default(uuid),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [uniqueIndex("system_settings_unique_idx").on(t.namespace, t.key)],
);

export const userSettings = sqliteTable(
  "user_settings",
  {
    id: text("id").primaryKey().default(uuid),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [uniqueIndex("user_settings_unique_idx").on(t.userId, t.key)],
);

export const usageLogs = sqliteTable(
  "usage_logs",
  {
    id: text("id").primaryKey().default(uuid),
    source: text("source").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    keyKind: text("key_kind"),
    model: text("model").notNull(),
    providerRef: text("provider_ref"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    status: text("status").notNull().default("success"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("usage_logs_user_idx").on(t.userId),
    index("usage_logs_created_idx").on(t.createdAt),
    index("usage_logs_model_idx").on(t.model),
  ],
);

// ===========================================================================
// 共享类型 re-export
// ===========================================================================

export type {
  ModelCapabilities,
  ContextPolicy,
  TokenUsage,
  ProcessTraceBlock,
  ProcessTrace,
  ApiKeyKind,
  ProviderProtocol,
  AccessScope,
  BindingScope,
  MessageStatus,
} from "@/db/types";
