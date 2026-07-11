/**
 * PostgreSQL schema —— Better Auth 认证表 + Nekusora 业务表。
 *
 * 与 ./sqlite.ts 保持表名、字段语义一致,仅列类型与方言差异不同。
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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ModelCapabilities,
  ContextPolicy,
  TokenUsage,
  ProcessTrace,
} from "@/db/types";

// ===========================================================================
// Better Auth 认证表(admin 插件 + 自定义 status)
// ===========================================================================

export const user = pgTable("user", {
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
});

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
    keyPrefix: text("key_prefix").notNull(), // 显示用,如 "sk-abcd…"
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
    // 最近一次全量密钥检测的聚合健康度(检测所有 key 后回写)。
    lastHealthCheckedAt: timestamp("last_health_checked_at", { withTimezone: true }),
    lastHealthyKeyCount: integer("last_healthy_key_count"),
    lastTotalKeyCount: integer("last_total_key_count"),
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
    vendor: text("vendor"),
    icon: text("icon"),
    capabilities: jsonb("capabilities").$type<ModelCapabilities>().notNull().default({}),
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
    priority: integer("priority").notNull().default(0),
    weight: integer("weight").notNull().default(1),
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
    webSearch: boolean("web_search").notNull().default(false), // 当前会话是否启用联网搜索
    composerState: jsonb("composer_state").$type<import("@/db/types").ComposerState>(), // 指令卡 / 知识库等数组型会话状态
    pinned: boolean("pinned").notNull().default(false), // 是否置顶
    archived: boolean("archived").notNull().default(false), // 是否归档
    generating: boolean("generating").notNull().default(false), // 是否正在生成(供侧栏转圈标识;服务端写入)
    contextPolicy: jsonb("context_policy").$type<ContextPolicy>(), // per-conversation 快照
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.userId)],
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

export const runs = pgTable("runs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
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
  tokenUsage: jsonb("token_usage").$type<TokenUsage>(),
  status: text("status").notNull().default("running"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const conversationShares = pgTable("conversation_shares", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  shareId: text("share_id").notNull().unique(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  titleSnapshot: text("title_snapshot"),
  modelSnapshot: text("model_snapshot"),
  messageIdsJson: jsonb("message_ids_json").$type<string[]>(),
  defaultMessageIdsJson: jsonb("default_message_ids_json").$type<string[]>(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  regeneratedAt: timestamp("regenerated_at", { withTimezone: true }),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (t) => [index("file_objects_user_idx").on(t.userId)],
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
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [
    index("file_chunks_file_idx").on(t.fileId),
    // pgvector 的 HNSW 相似度索引由迁移后置 SQL 创建(drizzle 暂无声明式向量索引 API):
    //   CREATE INDEX file_chunks_embedding_idx ON file_chunks
    //     USING hnsw (embedding vector_cosine_ops);
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

export const userMemories = pgTable(
  "user_memories",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // "preference" | "profile" | "project"(原 custom 已迁移为 project)
    source: text("source").notNull().default("manual"), // "manual" | "ai"(记忆来源)
    content: text("content").notNull(),
    disclosure: text("disclosure"), // 「何时该用这条记忆」(抽取时 LLM 生成);旧记忆为 NULL
    priority: integer("priority").notNull().default(0), // 重要性;scope 默认映射 preference=0/profile=1/project=2
    embedding: vector("embedding", { dimensions: 1536 }), // 融合向量 embed(content + " " + disclosure)
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }), // 召回命中时刷新;project 过期判断依据
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_memories_user_idx").on(t.userId)],
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

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    source: text("source").notNull(), // "chat" | "gateway"
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    keyKind: text("key_kind"), // "master" | "sub" | null(chat)
    model: text("model").notNull(),
    providerRef: text("provider_ref"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    status: text("status").notNull().default("success"),
    // —— 网关日志重构:成功计费补充字段(均 nullable,兼容历史行) ——
    firstTokenLatencyMs: integer("first_token_latency_ms"), // 首 token 延迟(TTFT)
    providerName: text("provider_name"), // 可读服务商名快照(替代裸 providerRef 展示)
    routeId: text("route_id"), // 命中路由 id 溯源
    routeName: text("route_name"), // 组合展示名(providerName · upstreamModel)
    upstreamModel: text("upstream_model"), // 真实上游模型名(区别于对外 model)
    // 命中上游 key 的脱敏快照(前3后3,中间 *;运行时从明文算,绝不存明文)。
    upstreamKeyMasked: text("upstream_key_masked"),
    /** 副任务类型(null=主回复/网关请求;title/memory/compact=后台副任务,用于区分双日志)。 */
    taskKind: text("task_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_logs_user_idx").on(t.userId),
    index("usage_logs_created_idx").on(t.createdAt),
    index("usage_logs_model_idx").on(t.model),
  ],
);

// 网关调用日志重构:失败 / 中断请求独立存表(物理双表)。
// 成功计费走 usage_logs;此处只收 failed / interrupted,补全错误码 / HTTP 状态 / 阶段等。
export const opsErrorLogs = pgTable(
  "ops_error_logs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    requestId: text("request_id").notNull(), // runId,串联一次生成
    source: text("source").notNull(), // "chat" | "gateway"
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    keyKind: text("key_kind"), // "master" | "sub" | null(chat)
    model: text("model").notNull(), // 对外模型名
    upstreamModel: text("upstream_model"), // 真实上游模型名
    providerName: text("provider_name"), // 可读服务商名快照
    providerRef: text("provider_ref"), // 裸 <source>:<providerId>,保留溯源
    // 命中上游 key 的脱敏快照(前3后3,中间 *;运行时从明文算,绝不存明文)。
    upstreamKeyMasked: text("upstream_key_masked"),
    routeId: text("route_id"),
    routeName: text("route_name"),
    requestPath: text("request_path"), // 如 /v1/chat/completions
    stream: boolean("stream").notNull().default(false), // 是否流式
    httpStatus: integer("http_status"), // HTTP 状态码(区别于枚举 status)
    errorCode: text("error_code").notNull(), // 错误码(generation_failed/routing_error/...)
    errorMessage: text("error_message"), // 错误信息(脱敏后)
    // errorPhase 本期 Phase 2 暂不计算,留 null;Phase 3 由 error-classify 填充。
    errorPhase: text("error_phase"), // 生命周期阶段(routing/upstream/network/internal/auth/request)
    errorType: text("error_type"), // 具体类型
    promptTokens: integer("prompt_tokens").notNull().default(0), // 失败前已计 token(可能 0)
    completionTokens: integer("completion_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"), // 端到端耗时
    firstTokenLatencyMs: integer("first_token_latency_ms"), // 失败前是否产出首 token
    /** 副任务类型(null=主回复/网关请求;title/memory/compact=后台副任务)。 */
    taskKind: text("task_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ops_error_logs_user_idx").on(t.userId),
    index("ops_error_logs_created_idx").on(t.createdAt),
    index("ops_error_logs_error_code_idx").on(t.errorCode),
    index("ops_error_logs_http_status_idx").on(t.httpStatus),
    index("ops_error_logs_provider_ref_idx").on(t.providerRef),
    index("ops_error_logs_source_idx").on(t.source),
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
} from "@/db/types";
