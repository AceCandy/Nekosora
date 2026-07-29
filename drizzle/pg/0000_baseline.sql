CREATE TYPE "public"."api_key_kind" AS ENUM('master', 'sub');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'streaming', 'success', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."model_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."provider_protocol" AS ENUM('openai', 'anthropic', 'gemini', 'openai-compatible', 'openai-images', 'openai-audio-stt', 'openai-audio-tts');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"kind" "api_key_kind" NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"language" text,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_artifact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_snapshots" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"run_id" text,
	"from_turn" integer,
	"to_turn" integer,
	"covered_until_message_id" text,
	"covered_until_public_id" text,
	"coverage_path_hash" text NOT NULL,
	"covered_message_count" integer NOT NULL,
	"source_tokens" integer,
	"summary_tokens" integer,
	"summary_text" text NOT NULL,
	"strategy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_projects" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_shares" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"title_snapshot" text,
	"model_snapshot" text,
	"message_ids_json" jsonb,
	"default_message_ids_json" jsonb,
	"revoked_at" timestamp with time zone,
	"regenerated_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_shares_share_id_unique" UNIQUE("share_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '新会话' NOT NULL,
	"project_id" text,
	"model_name" text,
	"output_mode_id" text,
	"render_style_id" text,
	"web_search" boolean DEFAULT false NOT NULL,
	"composer_state" jsonb,
	"pinned" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"generating" boolean DEFAULT false NOT NULL,
	"context_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"page_num" integer,
	"char_offset" integer,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"knowledge_base_id" text,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"storage_path" text NOT NULL,
	"size" integer NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"extract_status" text,
	"extract_engine" text,
	"extract_chars" integer,
	"extract_pages" integer,
	"ocr_used" boolean,
	"rag_ready" boolean DEFAULT false NOT NULL,
	"rag_reason" text,
	"embed_status" text,
	"embed_error" text,
	"page_count" integer,
	"chunk_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_jobs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"n" integer DEFAULT 1 NOT NULL,
	"size" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_urls" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruction_cards" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"scope" text NOT NULL,
	"trigger" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_model_bindings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_id" text NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"transport" text NOT NULL,
	"command" text,
	"args" jsonb,
	"env_enc" text,
	"url" text,
	"headers_json" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"cached_tools" jsonb,
	"last_connected_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"public_id" text NOT NULL,
	"parent_id" text,
	"source_id" text,
	"run_id" text,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"reasoning" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"branch_reason" text,
	"status" "message_status" DEFAULT 'success' NOT NULL,
	"token_usage" jsonb,
	"error_code" text,
	"error_message" text,
	"process_trace" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "model_catalog" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"canonical_model_id" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_type" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_window" integer,
	"max_output_tokens" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"visibility" "model_visibility" DEFAULT 'private' NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"catalog_id" text NOT NULL,
	"icon" text,
	"system_prompt" text,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops_error_logs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"source" text NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"key_kind" text,
	"model" text NOT NULL,
	"upstream_model" text,
	"provider_name" text,
	"provider_ref" text,
	"upstream_key_masked" text,
	"route_id" text,
	"route_name" text,
	"request_path" text,
	"stream" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"error_code" text NOT NULL,
	"error_message" text,
	"error_phase" text,
	"error_type" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"first_token_latency_ms" integer,
	"task_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "output_modes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"icon" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"icon" text,
	"system_prompt" text,
	"user_template" text,
	"variables" jsonb,
	"recommended_model" text,
	"is_agent" boolean DEFAULT false NOT NULL,
	"agent_config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"protocol" "provider_protocol" NOT NULL,
	"base_url" text NOT NULL,
	"api_keys_enc" text NOT NULL,
	"key_strategy" text DEFAULT 'round_robin' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"connect_timeout_ms" integer,
	"read_timeout_ms" integer,
	"stream_idle_timeout_ms" integer,
	"headers_json" jsonb,
	"last_health_checked_at" timestamp with time zone,
	"last_healthy_key_count" integer,
	"last_total_key_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render_styles" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"css_class" text NOT NULL,
	"css" text NOT NULL,
	"icon" text,
	"renderer" text DEFAULT 'streamdown' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"upstream_model_name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"headers_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"conversation_id" text,
	"user_id" text,
	"upstream_id" text,
	"platform_model_name" text,
	"routed_binding_code" text,
	"first_token_latency_ms" integer,
	"token_usage" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_type" text NOT NULL,
	"tool_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"error_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"key_kind" text,
	"model" text NOT NULL,
	"provider_ref" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"status" text DEFAULT 'success' NOT NULL,
	"first_token_latency_ms" integer,
	"provider_name" text,
	"route_id" text,
	"route_name" text,
	"upstream_model" text,
	"upstream_key_masked" text,
	"task_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"content" text NOT NULL,
	"disclosure" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1536),
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshots" ADD CONSTRAINT "context_snapshots_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_snapshots" ADD CONSTRAINT "context_snapshots_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_projects" ADD CONSTRAINT "conversation_projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD CONSTRAINT "conversation_shares_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_jobs" ADD CONSTRAINT "image_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruction_cards" ADD CONSTRAINT "instruction_cards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_catalog_id_model_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."model_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_error_logs" ADD CONSTRAINT "ops_error_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_error_logs" ADD CONSTRAINT "ops_error_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_parent_idx" ON "api_keys" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_master_unique_idx" ON "api_keys" USING btree ("user_id") WHERE kind = 'master';--> statement-breakpoint
CREATE INDEX "artifacts_msg_idx" ON "artifacts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "artifacts_conv_idx" ON "artifacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_chunks_file_idx" ON "file_chunks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_objects_user_idx" ON "file_objects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "image_jobs_user_idx" ON "image_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "instruction_cards_scope_idx" ON "instruction_cards" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "instruction_cards_user_idx" ON "instruction_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "key_model_bindings_key_idx" ON "key_model_bindings" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "key_model_bindings_unique_idx" ON "key_model_bindings" USING btree ("key_id","model_id");--> statement-breakpoint
CREATE INDEX "knowledge_bases_user_idx" ON "knowledge_bases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_idx" ON "mcp_servers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_enabled_idx" ON "mcp_servers" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_parent_idx" ON "messages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "messages_run_idx" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_catalog_canonical_model_id_unique_idx" ON "model_catalog" USING btree ("canonical_model_id");--> statement-breakpoint
CREATE INDEX "model_catalog_enabled_sort_idx" ON "model_catalog" USING btree ("enabled","sort_order");--> statement-breakpoint
CREATE INDEX "models_owner_idx" ON "models" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "models_visibility_idx" ON "models" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "models_catalog_idx" ON "models" USING btree ("catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_owner_name_idx" ON "models" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "ops_error_logs_user_idx" ON "ops_error_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ops_error_logs_created_idx" ON "ops_error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ops_error_logs_error_code_idx" ON "ops_error_logs" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "ops_error_logs_http_status_idx" ON "ops_error_logs" USING btree ("http_status");--> statement-breakpoint
CREATE INDEX "ops_error_logs_provider_ref_idx" ON "ops_error_logs" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "ops_error_logs_source_idx" ON "ops_error_logs" USING btree ("source");--> statement-breakpoint
CREATE INDEX "output_modes_enabled_idx" ON "output_modes" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "prompt_templates_scope_idx" ON "prompt_templates" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "providers_owner_idx" ON "providers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_owner_name_idx" ON "providers" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "render_styles_enabled_idx" ON "render_styles" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "render_styles_css_class_idx" ON "render_styles" USING btree ("css_class");--> statement-breakpoint
CREATE INDEX "routes_model_idx" ON "routes" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "routes_owner_idx" ON "routes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_unique_idx" ON "system_settings" USING btree ("namespace","key");--> statement-breakpoint
CREATE INDEX "usage_logs_user_idx" ON "usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_logs_created_idx" ON "usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_model_idx" ON "usage_logs" USING btree ("model");--> statement-breakpoint
CREATE UNIQUE INDEX "user_single_admin_unique_idx" ON "user" USING btree ("role") WHERE "user"."role" = 'admin';--> statement-breakpoint
CREATE INDEX "user_memories_user_idx" ON "user_memories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_unique_idx" ON "user_settings" USING btree ("user_id","key");

-- model_catalog 数据基线(由原 0015/0016/0017/0018/0019/0020 六条数据迁移合并,
-- 按 alias 上游协议与能力定义的最终态;新库原样重放,语义与历史迁移等价)

--> statement-breakpoint

INSERT INTO "model_catalog" ("id", "name", "canonical_model_id", "aliases", "model_type", "capabilities", "sort_order") VALUES
('catalog-gpt-5-chat', 'GPT-5 Chat', 'gpt-5-chat', '["openai/gpt-5-chat"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 20),
('catalog-ling-flash-2', 'Ling Flash 2.0', 'ling-flash-2.0', '["inclusionai/ling-flash-2.0"]'::jsonb, 'chat', '{"systemPrompt":true}'::jsonb, 21),
('catalog-mimo-v2-5', 'MiMo V2.5', 'mimo-v2.5', '["xiaomi/mimo-v2.5"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 22),
('catalog-mimo-v2-5-pro', 'MiMo V2.5 Pro', 'mimo-v2.5-pro', '["xiaomi/mimo-v2.5-pro"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 23),
('catalog-step-3-7-flash', 'Step 3.7 Flash', 'step-3.7-flash', '["stepfun/step-3.7-flash"]'::jsonb, 'chat', '{"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":"medium","high":"high"}}'::jsonb, 24),
('catalog-gpt-4-1', 'GPT-4.1', 'gpt-4.1', '["openai/gpt-4.1"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 30),
('catalog-gpt-4-1-mini', 'GPT-4.1 Mini', 'gpt-4.1-mini', '["openai/gpt-4.1-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 31),
('catalog-gpt-4o', 'GPT-4o', 'gpt-4o', '["openai/gpt-4o"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 32),
('catalog-gpt-4o-mini', 'GPT-4o Mini', 'gpt-4o-mini', '["openai/gpt-4o-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 33),
('catalog-o3', 'OpenAI o3', 'o3', '["openai/o3"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 34),
('catalog-o4-mini', 'OpenAI o4-mini', 'o4-mini', '["openai/o4-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 35),
('catalog-claude-sonnet-4', 'Claude Sonnet 4', 'claude-sonnet-4', '["anthropic/claude-sonnet-4","claude-sonnet-4-20250514"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 40),
('catalog-claude-opus-4', 'Claude Opus 4', 'claude-opus-4', '["anthropic/claude-opus-4","claude-opus-4-20250514"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 41),
('catalog-claude-3-5-haiku', 'Claude 3.5 Haiku', 'claude-3-5-haiku-latest', '["anthropic/claude-3.5-haiku","claude-3-5-haiku-20241022"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 42),
('catalog-gemini-2-5-pro', 'Gemini 2.5 Pro', 'gemini-2.5-pro', '["google/gemini-2.5-pro"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 50),
('catalog-gemini-2-5-flash', 'Gemini 2.5 Flash', 'gemini-2.5-flash', '["google/gemini-2.5-flash"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 51),
('catalog-deepseek-chat', 'DeepSeek Chat', 'deepseek-chat', '["deepseek/deepseek-chat","deepseek-v3"]'::jsonb, 'chat', '{"tools":true,"systemPrompt":true}'::jsonb, 60),
('catalog-deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek-reasoner', '["deepseek/deepseek-reasoner","deepseek-r1"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 61),
('catalog-qwen3-235b-a22b', 'Qwen3 235B A22B', 'qwen3-235b-a22b', '["qwen/qwen3-235b-a22b","qwen3-235b-a22b-instruct-2507"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 70),
('catalog-qwen3-32b', 'Qwen3 32B', 'qwen3-32b', '["qwen/qwen3-32b"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 71),
('catalog-qwen2-5-vl-72b', 'Qwen2.5 VL 72B', 'qwen2.5-vl-72b-instruct', '["qwen/qwen2.5-vl-72b-instruct"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 72),
('catalog-glm-4-5', 'GLM 4.5', 'glm-4.5', '["zai/glm-4.5","zhipu/glm-4.5"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 80),
('catalog-glm-4-5v', 'GLM 4.5V', 'glm-4.5v', '["zai/glm-4.5v","zhipu/glm-4.5v"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 81),
('catalog-kimi-k2', 'Kimi K2', 'kimi-k2', '["moonshot/kimi-k2","kimi-k2-0711-preview"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 90),
('catalog-moonshot-v1-8k', 'Moonshot V1 8K', 'moonshot-v1-8k', '["moonshot/moonshot-v1-8k"]'::jsonb, 'chat', '{"tools":true,"systemPrompt":true}'::jsonb, 91),
('catalog-gpt-image-1', 'GPT Image 1', 'gpt-image-1', '["openai/gpt-image-1"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 200),
('catalog-dall-e-3', 'DALL-E 3', 'dall-e-3', '["openai/dall-e-3"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 201),
('catalog-flux-1-1-pro', 'FLUX 1.1 Pro', 'flux-1.1-pro', '["black-forest-labs/flux-1.1-pro"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 202),
('catalog-cogview-4', 'CogView 4', 'cogview-4', '["zai/cogview-4","zhipu/cogview-4"]'::jsonb, 'image', '{"imageGeneration":true}'::jsonb, 203),
('catalog-text-embedding-3-small', 'Text Embedding 3 Small', 'text-embedding-3-small', '["openai/text-embedding-3-small"]'::jsonb, 'embedding', '{}'::jsonb, 300),
('catalog-text-embedding-3-large', 'Text Embedding 3 Large', 'text-embedding-3-large', '["openai/text-embedding-3-large"]'::jsonb, 'embedding', '{}'::jsonb, 301),
('catalog-bge-m3', 'BGE M3', 'bge-m3', '["baai/bge-m3"]'::jsonb, 'embedding', '{}'::jsonb, 302),
('catalog-bge-reranker-v2-m3', 'BGE Reranker V2 M3', 'bge-reranker-v2-m3', '["baai/bge-reranker-v2-m3"]'::jsonb, 'rerank', '{}'::jsonb, 400),
('catalog-rerank-v3-5', 'Rerank V3.5', 'rerank-v3.5', '["cohere/rerank-v3.5"]'::jsonb, 'rerank', '{}'::jsonb, 401),
('catalog-whisper-1', 'Whisper 1', 'whisper-1', '["openai/whisper-1"]'::jsonb, 'audio', '{}'::jsonb, 500),
('catalog-gpt-4o-mini-transcribe', 'GPT-4o Mini Transcribe', 'gpt-4o-mini-transcribe', '["openai/gpt-4o-mini-transcribe"]'::jsonb, 'audio', '{}'::jsonb, 501),
('catalog-tts-1', 'TTS 1', 'tts-1', '["openai/tts-1"]'::jsonb, 'audio', '{}'::jsonb, 502);
--> statement-breakpoint
UPDATE "models" AS "model"
SET "catalog_id" = "catalog"."id"
FROM "model_catalog" AS "catalog"
WHERE "model"."catalog_id" LIKE 'catalog-%-generic'
	AND (
		lower("catalog"."canonical_model_id") = lower("model"."name")
		OR EXISTS (
			SELECT 1 FROM jsonb_array_elements_text("catalog"."aliases") AS "alias"("value")
			WHERE lower("alias"."value") = lower("model"."name")
		)
	);

--> statement-breakpoint

INSERT INTO "model_catalog" ("id", "name", "canonical_model_id", "aliases", "model_type", "capabilities", "sort_order") VALUES
('catalog-claude-fable-5', 'Claude Fable 5', 'claude-fable-5', '["anthropic/claude-fable-5"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic","thinkingLevelMap":{"off":null,"xhigh":"xhigh","max":"max"}}'::jsonb, 40),
('catalog-claude-haiku-4-5', 'Claude Haiku 4.5', 'claude-haiku-4-5', '["anthropic/claude-haiku-4-5","claude-haiku-4-5-20251001"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb, 41),
('catalog-claude-opus-4-6', 'Claude Opus 4.6', 'claude-opus-4-6', '["anthropic/claude-opus-4-6"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic","thinkingLevelMap":{"max":"max"}}'::jsonb, 42),
('catalog-claude-opus-4-7', 'Claude Opus 4.7', 'claude-opus-4-7', '["anthropic/claude-opus-4-7"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic","thinkingLevelMap":{"xhigh":"xhigh","max":"max"}}'::jsonb, 43),
('catalog-claude-opus-4-8', 'Claude Opus 4.8', 'claude-opus-4-8', '["anthropic/claude-opus-4-8","claude-opus-4-8-fast"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic","thinkingLevelMap":{"xhigh":"xhigh","max":"max"}}'::jsonb, 44),
('catalog-claude-sonnet-4-6', 'Claude Sonnet 4.6', 'claude-sonnet-4-6', '["anthropic/claude-sonnet-4-6"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic","thinkingLevelMap":{"max":"max"}}'::jsonb, 45),
('catalog-claude-sonnet-5', 'Claude Sonnet 5', 'claude-sonnet-5', '["anthropic/claude-sonnet-5"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic","thinkingLevelMap":{"xhigh":"xhigh","max":"max"}}'::jsonb, 46),
('catalog-gemini-3-flash', 'Gemini 3 Flash', 'gemini-3-flash-preview', '["google/gemini-3-flash-preview","gemini-3-flash","gemini-flash-latest"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null}}'::jsonb, 50),
('catalog-gemini-3-1-flash-lite', 'Gemini 3.1 Flash Lite', 'gemini-3.1-flash-lite', '["google/gemini-3.1-flash-lite","gemini-3.1-flash-lite-preview","gemini-flash-lite-latest"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null}}'::jsonb, 51),
('catalog-gemini-3-1-pro', 'Gemini 3.1 Pro', 'gemini-3.1-pro-preview', '["google/gemini-3.1-pro-preview","gemini-3.1-pro-preview-customtools"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null,"minimal":null,"low":"LOW","medium":null,"high":"HIGH"}}'::jsonb, 52),
('catalog-gemini-3-5-flash', 'Gemini 3.5 Flash', 'gemini-3.5-flash', '["google/gemini-3.5-flash"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null}}'::jsonb, 53),
('catalog-gpt-5-3-codex', 'GPT-5.3 Codex', 'gpt-5.3-codex', '["openai/gpt-5.3-codex"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb, 60),
('catalog-gpt-5-4', 'GPT-5.4', 'gpt-5.4', '["openai/gpt-5.4"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb, 61),
('catalog-gpt-5-4-mini', 'GPT-5.4 Mini', 'gpt-5.4-mini', '["openai/gpt-5.4-mini"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb, 62),
('catalog-gpt-5-4-nano', 'GPT-5.4 Nano', 'gpt-5.4-nano', '["openai/gpt-5.4-nano"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb, 63),
('catalog-gpt-5-4-pro', 'GPT-5.4 Pro', 'gpt-5.4-pro', '["openai/gpt-5.4-pro"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb, 64),
('catalog-gpt-5-5', 'GPT-5.5', 'gpt-5.5', '["openai/gpt-5.5"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":"none","minimal":null,"xhigh":"xhigh"}}'::jsonb, 65),
('catalog-gpt-5-5-pro', 'GPT-5.5 Pro', 'gpt-5.5-pro', '["openai/gpt-5.5-pro"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"xhigh":"xhigh"}}'::jsonb, 66),
('catalog-grok-4-20-non-reasoning', 'Grok 4.20 Non-Reasoning', 'grok-4.20-0309-non-reasoning', '["xai/grok-4.20-0309-non-reasoning","x-ai/grok-4.20-non-reasoning"]'::jsonb, 'chat', '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb, 70),
('catalog-grok-4-20-reasoning', 'Grok 4.20 Reasoning', 'grok-4.20-0309-reasoning', '["xai/grok-4.20-0309-reasoning","x-ai/grok-4.20-reasoning"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 71),
('catalog-grok-4-3', 'Grok 4.3', 'grok-4.3', '["xai/grok-4.3","x-ai/grok-4.3"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 72),
('catalog-grok-4-5', 'Grok 4.5', 'grok-4.5', '["xai/grok-4.5","x-ai/grok-4.5"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 73),
('catalog-grok-build-0-1', 'Grok Build 0.1', 'grok-build-0.1', '["xai/grok-build-0.1","x-ai/grok-build-0.1"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 74),
('catalog-glm-4-7', 'GLM 4.7', 'glm-4.7', '["zai/glm-4.7","zhipu/glm-4.7","volcengine/glm-4.7"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 80),
('catalog-glm-5-turbo', 'GLM 5 Turbo', 'glm-5-turbo', '["zai/glm-5-turbo","zhipu/glm-5-turbo","volcengine/glm-5-turbo"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 81),
('catalog-glm-5-1', 'GLM 5.1', 'glm-5.1', '["zai/glm-5.1","zhipu/glm-5.1","volcengine/glm-5.1"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 82),
('catalog-glm-5-2', 'GLM 5.2', 'glm-5.2', '["zai/glm-5.2","zhipu/glm-5.2","volcengine/glm-5.2"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb, 83),
('catalog-glm-5v-turbo', 'GLM 5V Turbo', 'glm-5v-turbo', '["zai/glm-5v-turbo","zhipu/glm-5v-turbo","volcengine/glm-5v-turbo"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 84),
('catalog-kimi-k2-5', 'Kimi K2.5', 'kimi-k2.5', '["moonshot/kimi-k2.5","moonshotai/kimi-k2.5"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 90),
('catalog-kimi-k2-6', 'Kimi K2.6', 'kimi-k2.6', '["moonshot/kimi-k2.6","moonshotai/kimi-k2.6"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb, 91),
('catalog-kimi-k2-7-code', 'Kimi K2.7 Code', 'kimi-k2.7-code', '["moonshot/kimi-k2.7-code","moonshotai/kimi-k2.7-code"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 92),
('catalog-kimi-k2-7-code-highspeed', 'Kimi K2.7 Code HighSpeed', 'kimi-k2.7-code-highspeed', '["moonshot/kimi-k2.7-code-highspeed","moonshotai/kimi-k2.7-code-highspeed"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 93),
('catalog-minimax-m2-7', 'MiniMax M2.7', 'MiniMax-M2.7', '["minimax/MiniMax-M2.7","MiniMaxAI/MiniMax-M2.7"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb, 100),
('catalog-minimax-m2-7-highspeed', 'MiniMax M2.7 HighSpeed', 'MiniMax-M2.7-highspeed', '["minimax/MiniMax-M2.7-highspeed"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb, 101),
('catalog-minimax-m3', 'MiniMax M3', 'MiniMax-M3', '["minimax/MiniMax-M3","MiniMaxAI/MiniMax-M3"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb, 102),
('catalog-composer-2-5', 'Composer 2.5', 'composer-2.5', '["cursor/composer-2.5","composer-2.5-fast"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb, 110),
('catalog-deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek-v4-flash', '["deepseek/deepseek-v4-flash"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb, 120),
('catalog-deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek-v4-pro', '["deepseek/deepseek-v4-pro"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb, 121)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "model_type" = EXCLUDED."model_type",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true;
--> statement-breakpoint

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"anthropic-adaptive"'::jsonb)
WHERE "canonical_model_id" IN (
  'claude-fable-5', 'claude-opus-4-6', 'claude-opus-4-7',
  'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-sonnet-5'
);

--> statement-breakpoint

UPDATE "model_catalog"
SET "capabilities" = jsonb_set(
  "capabilities",
  '{thinkingLevelMap}',
  '{"off":null,"minimal":"MINIMAL","low":"LOW","medium":"MEDIUM","high":"HIGH"}'::jsonb
)
WHERE "canonical_model_id" IN (
  'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'
);

--> statement-breakpoint

UPDATE "model_catalog"
SET "capabilities" = "capabilities" || '{"reasoningEffort":true}'::jsonb
WHERE "canonical_model_id" IN ('glm-5.2', 'deepseek-v4-flash', 'deepseek-v4-pro');
--> statement-breakpoint
UPDATE "model_catalog"
SET "capabilities" = jsonb_set(
  "capabilities",
  '{thinkingLevelMap}',
  '{"minimal":null,"low":null,"medium":null,"high":"","xhigh":null,"max":null}'::jsonb
)
WHERE "canonical_model_id" IN (
  'glm-4.7', 'glm-5-turbo', 'glm-5.1', 'glm-5v-turbo', 'kimi-k2.5', 'kimi-k2.6'
);

--> statement-breakpoint

INSERT INTO "model_catalog" (
  "id", "name", "canonical_model_id", "aliases", "model_type", "capabilities",
  "context_window", "max_output_tokens", "sort_order"
) VALUES
(
  'catalog-agnes-1-5-flash', 'Agnes 1.5 Flash', 'agnes-1.5-flash', '[]'::jsonb, 'chat',
  '{"vision":true,"tools":true,"systemPrompt":true}'::jsonb,
  262144, 65536, 130
),
(
  'catalog-agnes-2-0-flash', 'Agnes 2.0 Flash', 'agnes-2.0-flash', '[]'::jsonb, 'chat',
  '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"agnes","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"2048","xhigh":null,"max":null}}'::jsonb,
  524288, 65536, 131
)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "model_type" = EXCLUDED."model_type",
  "capabilities" = EXCLUDED."capabilities",
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true;

--> statement-breakpoint

-- 0015 扩展型号与 0013 存量型号中,部分 reasoning=true 的模型缺 thinkingFormat,
-- 导致 applyReasoningToCompatibleBody / buildReasoningProviderOptions 早返回,
-- 推理档位(含 off)完全不向上游发送参数,出现"显示关但仍在思考"。
-- 按 alias 前缀映射的上游协议,幂等回填 thinkingFormat。仅 PG。
-- 原 openrouter 批量回填(step-3.7-flash / qwen3 / mimo)已下沉到各自 INSERT,
-- 按实际接入改写为厂商原生格式:step/qwen3→qwen(enable_thinking),mimo→deepseek(thinking.type)。

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"openai"'::jsonb)
WHERE "canonical_model_id" IN ('gpt-5-chat', 'o3', 'o4-mini');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"anthropic"'::jsonb)
WHERE "canonical_model_id" IN ('claude-sonnet-4', 'claude-opus-4');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"google"'::jsonb)
WHERE "canonical_model_id" IN ('gemini-2.5-pro', 'gemini-2.5-flash');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"zai"'::jsonb)
WHERE "canonical_model_id" IN ('glm-4.5', 'glm-4.5v');

UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"deepseek"'::jsonb)
WHERE "canonical_model_id" IN ('kimi-k2', 'deepseek-reasoner');

--> statement-breakpoint

-- Squashed from 0001_sync_pi_models.sql

-- 同步 pi 模型配置到 model_catalog(由 scripts/sync-pi-models.ts 生成,幂等 upsert)
-- 不改 schema;仅对齐主流 chat 模型的 reasoning/thinkingLevelMap/reasoningEffort/vision/context_window/max_output_tokens

INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1', 'GPT-4.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1-mini', 'GPT-4.1 Mini', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o', 'GPT-4o', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-mini', 'GPT-4o Mini', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5', 'MiMo V2.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null},"vision":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null},"vision":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-4-5', 'Claude Haiku 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-codex', 'GPT-5.3 Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4', 'GPT-5.4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-mini', 'GPT-5.4 Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-nano', 'GPT-5.4 Nano', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-pro', 'GPT-5.4 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5', 'GPT-5.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5-pro', 'GPT-5.5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-non-reasoning', 'Grok 4.20 Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-reasoning', 'Grok 4.20 Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.3', 'Grok 4.3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.5', 'Grok 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 500000,
  "max_output_tokens" = 500000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-build-0.1', 'Grok Build 0.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-flash-preview', 'Gemini 3 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7', 'GLM 4.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code-highspeed', 'Kimi K2.7 Code HighSpeed', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"off":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7', 'MiniMax M2.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7-highspeed', 'MiniMax M2.7 HighSpeed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M3', 'MiniMax M3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-fable-5', 'Claude Fable 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-6', 'Claude Opus 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-7', 'Claude Opus 4.7', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-8', 'Claude Opus 4.8', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-5', 'Claude Sonnet 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-flash', 'DeepSeek V4 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-pro', 'DeepSeek V4 Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.2', 'GLM 5.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5-turbo', 'GLM 5 Turbo', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.5', 'Kimi K2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.6', 'Kimi K2.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3', 'OpenAI o3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini', 'OpenAI o4-mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4', 'Claude Opus 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2', 'Kimi K2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.1', 'GLM 5.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5v-turbo', 'GLM 5V Turbo', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5-pro', 'MiMo V2.5 Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;

--> statement-breakpoint

-- Squashed from 0002_hot_puff_adder.sql

ALTER TABLE "providers" ADD COLUMN "test_model" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "upstream_models" jsonb;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "upstream_models_at" timestamp with time zone;

--> statement-breakpoint

-- Squashed from 0003_overjoyed_the_leader.sql

ALTER TABLE "providers" ADD COLUMN "last_network_ok" boolean;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_key_results" jsonb;

--> statement-breakpoint

-- Squashed from 0004_chief_raider.sql

ALTER TABLE "providers" ADD COLUMN "last_model_probe_ok" boolean;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_model_probe_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_model_probe_error" text;

--> statement-breakpoint

-- Squashed from 0005_next_ben_urich.sql

-- 维度从 1536 迁移到 1024(切换到 bge-m3);旧向量维度不兼容,清空后由后续写入重建。
-- file_chunks:文件需重新处理(processFile)以生成 1024 维向量;
-- user_memories:记忆内容保留,向量清空,召回在下次抽取/编辑时重建。
UPDATE "file_chunks" SET "embedding" = NULL;--> statement-breakpoint
UPDATE "user_memories" SET "embedding" = NULL;--> statement-breakpoint
ALTER TABLE "file_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "user_memories" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);

--> statement-breakpoint

-- Squashed from 0006_absent_wind_dancer.sql

DROP TABLE "user_memories" CASCADE;

--> statement-breakpoint

-- Squashed from 0007_fearless_jazinda.sql

ALTER TABLE "ops_error_logs" ADD COLUMN "attempt" integer;

--> statement-breakpoint

-- Squashed from 0008_model_catalog_configured.sql

-- 按当前已配置 models 补齐 model_catalog(来源: https://pi.dev/api/models)
-- 1) 缺失型号入库  2) 补 context_window / max_output_tokens  3) 将 generic 绑定改到对应目录
-- pi 未收录: diffusiongemma-26b-a4b-it、ling-flash-2.0 的窗口参数(后者仅已有目录行,不编造数值)

--> statement-breakpoint

-- 已有目录:补别名,便于自动匹配 / 回绑
UPDATE "model_catalog"
SET "aliases" = (
  SELECT jsonb_agg(DISTINCT v)
  FROM jsonb_array_elements_text(
    COALESCE("aliases", '[]'::jsonb) || '["gemini-flash-lite"]'::jsonb
  ) AS t(v)
),
"updated_at" = now()
WHERE "canonical_model_id" = 'gemini-3.1-flash-lite';
--> statement-breakpoint

UPDATE "model_catalog"
SET "aliases" = (
  SELECT jsonb_agg(DISTINCT v)
  FROM jsonb_array_elements_text(
    COALESCE("aliases", '[]'::jsonb) || '["zai-glm-4.7"]'::jsonb
  ) AS t(v)
),
"updated_at" = now()
WHERE "canonical_model_id" = 'glm-4.7';
--> statement-breakpoint

-- 已有目录但缺窗口:仅写 pi 明确给出的 contextWindow / maxTokens
UPDATE "model_catalog"
SET
  "context_window" = 128000,
  "max_output_tokens" = 16384,
  "updated_at" = now()
WHERE "canonical_model_id" = 'gpt-5-chat'
  AND ("context_window" IS NULL OR "max_output_tokens" IS NULL);
--> statement-breakpoint

-- step-3.7-flash: pi huggingface/stepfun-ai/Step-3.7-Flash
UPDATE "model_catalog"
SET
  "context_window" = 262144,
  "max_output_tokens" = 256000,
  "updated_at" = now()
WHERE "canonical_model_id" = 'step-3.7-flash'
  AND ("context_window" IS NULL OR "max_output_tokens" IS NULL);
--> statement-breakpoint

-- 新增目录(幂等 upsert)
INSERT INTO "model_catalog" (
  "id", "name", "canonical_model_id", "aliases", "model_type", "capabilities",
  "context_window", "max_output_tokens", "sort_order"
) VALUES
(
  'catalog-gpt-oss-120b', 'GPT OSS 120B', 'gpt-oss-120b',
  '["openai/gpt-oss-120b"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  131072, 131072, 140
),
(
  'catalog-gpt-oss-20b', 'GPT OSS 20B', 'gpt-oss-20b',
  '["openai/gpt-oss-20b","openai/gpt-oss-20b:free"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  131072, 32768, 141
),
(
  'catalog-gemma-4-31b', 'Gemma 4 31B', 'gemma-4-31b',
  '["gemma-4-31b-it","google/gemma-4-31b-it","google/gemma-4-31b-it:free"]'::jsonb, 'chat',
  '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null,"minimal":"MINIMAL","low":null,"medium":null,"high":"HIGH"}}'::jsonb,
  262144, 32768, 142
),
(
  'catalog-gemma-4-26b-a4b-it', 'Gemma 4 26B A4B', 'gemma-4-26b-a4b-it',
  '["google/gemma-4-26b-a4b-it","google/gemma-4-26b-a4b-it:free"]'::jsonb, 'chat',
  '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"off":null,"minimal":"MINIMAL","low":null,"medium":null,"high":"HIGH"}}'::jsonb,
  262144, 32768, 143
),
(
  'catalog-nemotron-3-nano-30b-a3b', 'Nemotron 3 Nano 30B', 'nemotron-3-nano-30b-a3b',
  '["nvidia/nemotron-3-nano-30b-a3b","nvidia/nemotron-3-nano-30b-a3b:free"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  131072, 131072, 144
),
(
  'catalog-nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B', 'nemotron-3-super-120b-a12b',
  '["nvidia/nemotron-3-super-120b-a12b","nvidia/nemotron-3-super-120b-a12b:free"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  262144, 262144, 145
),
(
  'catalog-big-pickle', 'Big Pickle', 'big-pickle',
  '["opencode/big-pickle"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  200000, 32000, 146
),
(
  'catalog-qwen3-6-27b', 'Qwen3.6 27B', 'qwen3.6-27b',
  '["qwen/qwen3.6-27b"]'::jsonb, 'chat',
  '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","xhigh":null,"max":null}}'::jsonb,
  262144, 65536, 147
),
(
  'catalog-step-3-5-flash', 'Step 3.5 Flash', 'step-3.5-flash',
  '["stepfun/step-3.5-flash"]'::jsonb, 'chat',
  '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":"medium","high":"high"}}'::jsonb,
  262144, 256000, 148
)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "model_type" = EXCLUDED."model_type",
  "capabilities" = EXCLUDED."capabilities",
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now();
--> statement-breakpoint

-- 将仍挂在通用模板上的已配置模型,按 name / 别名回绑到具体目录
UPDATE "models" AS "model"
SET
  "catalog_id" = "catalog"."id",
  "updated_at" = now()
FROM "model_catalog" AS "catalog"
WHERE "model"."catalog_id" = 'catalog-chat-generic'
  AND "catalog"."enabled" = true
  AND NOT "catalog"."canonical_model_id" LIKE '\_\_generic\_%' ESCAPE '\'
  AND (
    lower("catalog"."canonical_model_id") = lower("model"."name")
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text("catalog"."aliases") AS "alias"("value")
      WHERE lower("alias"."value") = lower("model"."name")
    )
  );

--> statement-breakpoint

-- Squashed from 0009_lethal_killmonger.sql

CREATE TABLE "message_feedback" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_feedback_user_message_unique_idx" ON "message_feedback" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "message_feedback_conversation_idx" ON "message_feedback" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_feedback_rating_idx" ON "message_feedback" USING btree ("rating");

--> statement-breakpoint

-- Squashed from 0010_lazy_gorgon.sql

ALTER TABLE "conversation_shares" ADD COLUMN "message_snapshots_json" jsonb;

--> statement-breakpoint

-- Squashed from 0011_fix_kimi_fixed_reasoning.sql

UPDATE "model_catalog"
SET "capabilities" = "capabilities" || '{"thinkingFormat":"fixed","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"default","xhigh":null,"max":null}}'::jsonb,
    "updated_at" = now()
WHERE "canonical_model_id" IN (
  'kimi-k2.7-code',
  'kimi-k2.7-code-highspeed'
);

--> statement-breakpoint

-- Squashed from 0012_add_run_lease.sql

ALTER TABLE "runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "lease_expires_at" SET DEFAULT now() + interval '2 minutes';--> statement-breakpoint
UPDATE "runs"
SET "lease_expires_at" = now() + interval '2 minutes'
WHERE "status" = 'running' AND "lease_expires_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runs_active_conversation_idx" ON "runs" USING btree ("conversation_id","lease_expires_at") WHERE "runs"."status" = 'running';

--> statement-breakpoint

-- Squashed from 0013_add_file_processing_lease.sql

ALTER TABLE "file_objects" ADD COLUMN "processing_lease_id" text;--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "processing_lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "file_objects"
SET "processing_lease_expires_at" = now()
WHERE "processing_status" IN ('extracting', 'embedding')
  AND "processing_lease_expires_at" IS NULL;--> statement-breakpoint
CREATE INDEX "file_objects_stale_processing_idx" ON "file_objects" USING btree ("processing_lease_expires_at","created_at") WHERE "file_objects"."processing_status" IN ('extracting', 'embedding');

--> statement-breakpoint

-- Squashed from 0014_conversation_title_outbox.sql

CREATE TABLE "conversation_title_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"first_user_message" text NOT NULL,
	"fallback_title" text NOT NULL,
	"chat_model" text,
	"chat_model_id" text,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_title_jobs_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_title_jobs" ADD CONSTRAINT "conversation_title_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_title_jobs" ADD CONSTRAINT "conversation_title_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_title_jobs_dispatch_idx" ON "conversation_title_jobs" USING btree ("dispatch_after","created_at");

--> statement-breakpoint

-- Squashed from 0015_pending_file_recovery.sql

CREATE INDEX "file_objects_pending_processing_idx" ON "file_objects" USING btree ("created_at","id") WHERE "file_objects"."processing_status" = 'pending';

--> statement-breakpoint

-- Squashed from 0016_conversation_share_controls.sql

CREATE TABLE "conversation_share_unlock_attempts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" text NOT NULL,
	"scope" text NOT NULL,
	"client_fingerprint" text NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "password_verifier" text;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "render_style_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "message_version_selections" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_share_unlock_attempts" ADD CONSTRAINT "conversation_share_unlock_attempts_share_id_conversation_shares_share_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."conversation_shares"("share_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_share_unlock_attempts_bucket_idx" ON "conversation_share_unlock_attempts" USING btree ("share_id","scope","client_fingerprint");--> statement-breakpoint
CREATE INDEX "conversation_share_unlock_attempts_updated_idx" ON "conversation_share_unlock_attempts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "conversation_shares_conversation_created_idx" ON "conversation_shares" USING btree ("conversation_id","created_at");

--> statement-breakpoint

-- Squashed from 0017_petite_star_brand.sql

ALTER TABLE "runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "completed_at" timestamp with time zone;

--> statement-breakpoint

-- Squashed from 0018_message_file_objects.sql

CREATE TABLE "message_file_objects" (
	"message_id" text NOT NULL,
	"file_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "message_file_objects_message_file_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "message_file_objects" ADD CONSTRAINT "message_file_objects_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_file_objects" ADD CONSTRAINT "message_file_objects_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_file_objects_message_sort_unique_idx" ON "message_file_objects" USING btree ("message_id","sort_order");--> statement-breakpoint
CREATE INDEX "message_file_objects_file_message_idx" ON "message_file_objects" USING btree ("file_id","message_id");

--> statement-breakpoint

-- Squashed from 0019_import_pi_models.sql

-- 全量导入 pi 缺失模型到 model_catalog + 更新已有行(由 scripts/sync-pi-models.ts 生成,幂等 upsert)
-- 数据源: https://pi.dev/api/models

INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-fable-5:batch', 'Anthropic: Claude Fable 5 (batch)', '["openrouter/anthropic/claude-fable-5:batch","anthropic/claude-fable-5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2395)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-haiku-4.5:batch', 'Anthropic: Claude Haiku 4.5 (batch)', '["openrouter/anthropic/claude-haiku-4.5:batch","anthropic/claude-haiku-4.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 200000, 64000, 2396)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.1:batch', 'Anthropic: Claude Opus 4.1 (batch)', '["openrouter/anthropic/claude-opus-4.1:batch","anthropic/claude-opus-4.1:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 200000, 32000, 2397)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.5:batch', 'Anthropic: Claude Opus 4.5 (batch)', '["openrouter/anthropic/claude-opus-4.5:batch","anthropic/claude-opus-4.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 200000, 64000, 2398)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.6:batch', 'Anthropic: Claude Opus 4.6 (batch)', '["openrouter/anthropic/claude-opus-4.6:batch","anthropic/claude-opus-4.6:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2399)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.7:batch', 'Anthropic: Claude Opus 4.7 (batch)', '["openrouter/anthropic/claude-opus-4.7:batch","anthropic/claude-opus-4.7:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2400)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-opus-4.8:batch', 'Anthropic: Claude Opus 4.8 (batch)', '["openrouter/anthropic/claude-opus-4.8:batch","anthropic/claude-opus-4.8:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2401)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-sonnet-4.5:batch', 'Anthropic: Claude Sonnet 4.5 (batch)', '["openrouter/anthropic/claude-sonnet-4.5:batch","anthropic/claude-sonnet-4.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 64000, 2402)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'claude-sonnet-5:batch', 'Anthropic: Claude Sonnet 5 (batch)', '["openrouter/anthropic/claude-sonnet-5:batch","anthropic/claude-sonnet-5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 128000, 2403)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'cosmos-reason2-8b', 'Cosmos Reason2 8B', '["nvidia/nvidia/cosmos-reason2-8b","nvidia/cosmos-reason2-8b"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 131072, 16384, 2404)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-2.5-flash-lite:batch', 'Google: Gemini 2.5 Flash Lite (batch)', '["openrouter/google/gemini-2.5-flash-lite:batch","google/gemini-2.5-flash-lite:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65535, 2405)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-2.5-flash:batch', 'Google: Gemini 2.5 Flash (batch)', '["openrouter/google/gemini-2.5-flash:batch","google/gemini-2.5-flash:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65535, 2406)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-2.5-pro:batch', 'Google: Gemini 2.5 Pro (batch)', '["openrouter/google/gemini-2.5-pro:batch","google/gemini-2.5-pro:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2407)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3-flash-preview:batch', 'Google: Gemini 3 Flash Preview (batch)', '["openrouter/google/gemini-3-flash-preview:batch","google/gemini-3-flash-preview:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65535, 2408)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite:batch', 'Google: Gemini 3.1 Flash Lite (batch)', '["openrouter/google/gemini-3.1-flash-lite:batch","google/gemini-3.1-flash-lite:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2409)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.1-pro-preview:batch', 'Google: Gemini 3.1 Pro Preview (batch)', '["openrouter/google/gemini-3.1-pro-preview:batch","google/gemini-3.1-pro-preview:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2410)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.5-flash-lite:batch', 'Google: Gemini 3.5 Flash Lite (batch)', '["openrouter/google/gemini-3.5-flash-lite:batch","google/gemini-3.5-flash-lite:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2411)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.5-flash:batch', 'Google: Gemini 3.5 Flash (batch)', '["openrouter/google/gemini-3.5-flash:batch","google/gemini-3.5-flash:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2412)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemini-3.6-flash:batch', 'Google: Gemini 3.6 Flash (batch)', '["openrouter/google/gemini-3.6-flash:batch","google/gemini-3.6-flash:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 65536, 2413)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gemma-3-4b-it', 'Gemma 3 4B IT', '["nvidia/google/gemma-3-4b-it","google/gemma-3-4b-it"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"vision":true}'::jsonb, 131072, 16384, 2414)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5-mini:batch', 'OpenAI: GPT-5 Mini (batch)', '["openrouter/openai/gpt-5-mini:batch","openai/gpt-5-mini:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2415)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5-nano:batch', 'OpenAI: GPT-5 Nano (batch)', '["openrouter/openai/gpt-5-nano:batch","openai/gpt-5-nano:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2416)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5:batch', 'OpenAI: GPT-5 (batch)', '["openrouter/openai/gpt-5:batch","openai/gpt-5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2417)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.1:batch', 'OpenAI: GPT-5.1 (batch)', '["openrouter/openai/gpt-5.1:batch","openai/gpt-5.1:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2418)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.2:batch', 'OpenAI: GPT-5.2 (batch)', '["openrouter/openai/gpt-5.2:batch","openai/gpt-5.2:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2419)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.4-mini:batch', 'OpenAI: GPT-5.4 Mini (batch)', '["openrouter/openai/gpt-5.4-mini:batch","openai/gpt-5.4-mini:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2420)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.4-nano:batch', 'OpenAI: GPT-5.4 Nano (batch)', '["openrouter/openai/gpt-5.4-nano:batch","openai/gpt-5.4-nano:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 400000, 128000, 2421)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.4:batch', 'OpenAI: GPT-5.4 (batch)', '["openrouter/openai/gpt-5.4:batch","openai/gpt-5.4:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1050000, 128000, 2422)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'gpt-5.5:batch', 'OpenAI: GPT-5.5 (batch)', '["openrouter/openai/gpt-5.5:batch","openai/gpt-5.5:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1050000, 128000, 2423)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'kimi-k3-fast', 'Kimi K3 Fast', '["fireworks/accounts/fireworks/routers/kimi-k3-fast","accounts/fireworks/routers/kimi-k3-fast","moonshotai/kimi-k3-fast","vercel-ai-gateway/moonshotai/kimi-k3-fast"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1048576, 131072, 2424)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-70b-instruct', 'Llama 3.1 Nemotron 70B Instruct', '["nvidia/nvidia/llama-3.1-nemotron-70b-instruct","nvidia/llama-3.1-nemotron-70b-instruct"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true}'::jsonb, 128000, 8192, 2425)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-nano-8b-v1', 'Llama 3.1 Nemotron Nano 8B v1', '["nvidia/nvidia/llama-3.1-nemotron-nano-8b-v1","nvidia/llama-3.1-nemotron-nano-8b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 131072, 16384, 2426)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-nano-vl-8b-v1', 'Llama 3.1 Nemotron Nano VL 8B v1', '["nvidia/nvidia/llama-3.1-nemotron-nano-vl-8b-v1","nvidia/llama-3.1-nemotron-nano-vl-8b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 32768, 16384, 2427)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.1-nemotron-ultra-253b-v1', 'Llama 3.1 Nemotron Ultra 253B', '["nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1","nvidia/llama-3.1-nemotron-ultra-253b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 128000, 16384, 2428)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.3-nemotron-super-49b-v1', 'Llama 3.3 Nemotron Super 49B v1', '["nvidia/nvidia/llama-3.3-nemotron-super-49b-v1","nvidia/llama-3.3-nemotron-super-49b-v1"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 131072, 65536, 2429)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'llama-3.3-nemotron-super-49b-v1.5', 'Llama 3.3 Nemotron Super 49B v1.5', '["nvidia/nvidia/llama-3.3-nemotron-super-49b-v1.5","nvidia/llama-3.3-nemotron-super-49b-v1.5"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true}'::jsonb, 131072, 65536, 2430)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'minimax-m3:batch', 'MiniMax: MiniMax M3 (batch)', '["openrouter/minimax/minimax-m3:batch","minimax/minimax-m3:batch"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 524288, 4096, 2431)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'mistral-7b-instruct-v0.3', 'Mistral-7B-Instruct-v0.3', '["nvidia/mistralai/mistral-7b-instruct-v0.3","mistralai/mistral-7b-instruct-v0.3"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true}'::jsonb, 65536, 65536, 2432)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'mistral-medium-3.5-128b', 'Mistral Medium 3.5', '["nvidia/mistralai/mistral-medium-3.5-128b","mistralai/mistral-medium-3.5-128b"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 262144, 32768, 2433)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "aliases", "model_type", "capabilities", "context_window", "max_output_tokens", "sort_order") VALUES (gen_random_uuid(), 'qwen3.7-flash', 'Qwen: Qwen3.7 Flash', '["openrouter/qwen/qwen3.7-flash","alibaba/qwen3.7-flash","qwen/qwen3.7-flash","vercel-ai-gateway/alibaba/qwen3.7-flash"]'::jsonb, 'chat', '{"systemPrompt":true,"tools":true,"reasoning":true,"vision":true}'::jsonb, 1000000, 65536, 2434)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "aliases" = EXCLUDED."aliases",
  "capabilities" = EXCLUDED."capabilities",
  "sort_order" = EXCLUDED."sort_order",
  "enabled" = true,
  "updated_at" = now(),
  "context_window" = EXCLUDED."context_window",
  "max_output_tokens" = EXCLUDED."max_output_tokens";
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7', 'GLM 4.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-120b', 'GPT OSS 120B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-20b', 'GPT OSS 20B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-4-31b', 'Gemma 4 31B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-4-26b-a4b-it', 'Gemma 4 26B A4B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"google","thinkingLevelMap":{"low":null,"off":null,"high":"HIGH","medium":null,"minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-nano-30b-a3b', 'Nemotron 3 Nano 30B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-super-120b-a12b', 'Nemotron 3 Super 120B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'big-pickle', 'Big Pickle', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-27b', 'Qwen3.6 27B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-chat', 'DeepSeek Chat', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 163840;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1', 'GPT-4.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1-mini', 'GPT-4.1 Mini', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o', 'GPT-4o', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-mini', 'GPT-4o Mini', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5', 'MiMo V2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'step-3.5-flash', 'Step 3.5 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek.v3-v1:0', 'DeepSeek-V3.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 81920;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-2', 'Devstral 2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-2512', 'Devstral 2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-latest', 'Devstral 2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-medium-2507', 'Devstral Medium', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-medium-latest', 'Devstral 2 (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-small-2', 'Devstral Small 2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-small-2505', 'Devstral Small 2505', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'devstral-small-2507', 'Devstral Small', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'free', 'Free Models Router', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'fugu-ultra', 'Sakana: Fugu Ultra', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'fusion', 'OpenRouter: Fusion', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.0-flash', 'Gemini 2.0 Flash', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.0-flash-lite', 'Gemini 2.0 Flash-Lite', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-computer-use-preview-10-2025', 'Gemini 2.5 Computer Use Preview 10-2025', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro-preview', 'Google: Gemini 2.5 Pro Preview 06-05', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro-preview-05-06', 'Google: Gemini 2.5 Pro Preview 05-06', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65535;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-pro-image', 'Google: Nano Banana Pro (Gemini 3 Pro Image)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 65536,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-pro-preview', 'Gemini 3 Pro Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 65536,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-codex', 'GPT-5.3 Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-flash-live-preview', 'Gemini 3.1 Flash Live Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-4-5', 'Claude Haiku 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4', 'GPT-5.4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-mini', 'GPT-5.4 Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'aion-2.0', 'AionLabs: Aion-2.0', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'aion-3.0', 'AionLabs: Aion-3.0', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'aion-3.0-mini', 'AionLabs: Aion-3.0-Mini', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-haiku', 'Anthropic: Claude 3 Haiku', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-opus', 'Claude Opus 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3-sonnet', 'Claude Sonnet 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-3.5-sonnet', 'Claude Sonnet 3.5 v2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-fable-latest', 'Anthropic: Claude Fable Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-haiku-latest', 'Anthropic Claude Haiku Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-1', 'Claude Opus 4.1 (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7', 'MiniMax M2.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-1-20250805', 'Claude Opus 4.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-1-20250805-v1:0', 'Claude Opus 4.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.7-highspeed', 'MiniMax M2.7 HighSpeed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M3', 'MiniMax M3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-5', 'Claude Opus 4.5 (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-5-20251101', 'Claude Opus 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-fable-5', 'Claude Fable 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-6', 'Claude Opus 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-7', 'Claude Opus 4.7', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'step-3.7-flash', 'Step 3.7 Flash', 'chat', '{"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null},"vision":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"low":"low","off":null,"high":"high","medium":"medium","minimal":null},"vision":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-5-20251101-v1:0', 'Claude Opus 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-6-v1', 'Claude Opus 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4.7-fast', 'Anthropic: Claude Opus 4.7 (Fast)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4', 'Claude Sonnet 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-5', 'Claude Opus 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.1-pro', 'Gemini 3.1 Pro Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.5', 'GLM 4.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 98304;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.5v', 'GLM 4.5V', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb,
  "context_window" = 66000,
  "max_output_tokens" = 16000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-reasoner', 'DeepSeek Reasoner', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-nano', 'GPT-5.4 Nano', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.4-pro', 'GPT-5.4 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":null,"xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5', 'GPT-5.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"off":"none","xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b', 'Qwen3 235B A22B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-32b', 'Qwen3 32B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 40960;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.5-pro', 'GPT-5.5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":null,"off":null,"xhigh":"xhigh","minimal":null}}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.5', 'Kimi K2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-non-reasoning', 'Grok 4.20 Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3', 'OpenAI o3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-0309-reasoning', 'Grok 4.20 Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.3', 'Grok 4.3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 30000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.5', 'Grok 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 500000,
  "max_output_tokens" = 500000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-build-0.1', 'Grok Build 0.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3-flash-preview', 'Gemini 3 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.5-flash', 'Gemini 3.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingLevelMap":{"low":"LOW","off":null,"high":"HIGH","medium":"MEDIUM","minimal":"MINIMAL"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4-8', 'Claude Opus 4.8', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-5', 'Claude Sonnet 5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"anthropic-adaptive","thinkingLevelMap":{"max":"max","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-flash', 'DeepSeek V4 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v4-pro', 'DeepSeek V4 Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":null,"medium":null,"high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 384000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.2', 'GLM 5.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","reasoningEffort":true,"thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5-turbo', 'GLM 5 Turbo', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.6', 'Kimi K2.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini', 'OpenAI o4-mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-4', 'Claude Opus 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2', 'Kimi K2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.1', 'GLM 5.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5v-turbo', 'GLM 5V Turbo', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5-pro', 'MiMo V2.5 Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek","thinkingLevelMap":{"low":null,"max":null,"high":"high","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-5-fast', 'Claude Opus 5 (Fast)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-opus-latest', 'Anthropic: Claude Opus Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-5', 'Claude Sonnet 4.5 (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'claude-sonnet-latest', 'Anthropic Claude Sonnet Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'codestral', 'Mistral Codestral', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'codestral-2508', 'Mistral: Codestral 2508', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'codestral-latest', 'Codestral (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'command-a', 'Command A', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'command-r-08-2024', 'Cohere: Command R (08-2024)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'command-r-plus-08-2024', 'Cohere: Command R+ (08-2024)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deep-research-max-preview-04-2026', 'Deep Research Max Preview (Apr-21-2026)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deep-research-preview-04-2026', 'Deep Research Preview (Apr-21-2026)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-chat-v3-0324', 'DeepSeek: DeepSeek V3 0324', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-chat-v3.1', 'DeepSeek: DeepSeek V3.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-r1-0528', 'DeepSeek: R1 0528', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 163840;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.1', 'DeepSeek V3.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.1-terminus', 'DeepSeek: DeepSeek V3.1 Terminus', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.2', 'DeepSeek V3.2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.2-exp', 'DeepSeek: DeepSeek V3.2 Exp', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 163840,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek-v3.2-thinking', 'DeepSeek V3.2 Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'deepseek.r1-v1:0', 'DeepSeek-R1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-3.6-flash', 'Gemini 3.6 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-pro-latest', 'Google Gemini Pro Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemini-robotics-er-1.6-preview', 'Gemini Robotics-ER 1.6 Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-3-12b-it', 'Google: Gemma 3 12B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gemma-3-27b-it', 'Google: Gemma 3 27B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.5-air', 'GLM-4.5-Air', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 98304;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.6', 'Z.ai: GLM 4.6', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.6v', 'Z.ai: GLM 4.6V', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.6v-flash', 'GLM-4.6V-Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 24000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7-flash', 'Z.ai: GLM 4.7 Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-4.7-flashx', 'GLM 4.7 FlashX', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5', 'GLM-5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5.2-fast', 'GLM 5.2 Fast', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5p2', 'GLM 5.2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048575,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'glm-5p2-fast', 'GLM 5.2 Fast', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048575,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'google.gemma-3-27b-it', 'Google Gemma 3 27B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'google.gemma-3-4b-it', 'Gemma 3 4B IT', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-3.5-turbo', 'OpenAI: GPT-3.5 Turbo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16385,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-3.5-turbo-0613', 'OpenAI: GPT-3.5 Turbo (older v0613)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 4095,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-3.5-turbo-16k', 'OpenAI: GPT-3.5 Turbo 16k', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16385,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4', 'GPT-4', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 8192,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4-turbo', 'GPT-4 Turbo', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4-turbo-preview', 'OpenAI: GPT-4 Turbo Preview', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4.1-nano', 'GPT-4.1 nano', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1047576,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-2024-05-13', 'GPT-4o (2024-05-13)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-2024-08-06', 'GPT-4o (2024-08-06)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-2024-11-20', 'GPT-4o (2024-11-20)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-4o-mini-2024-07-18', 'OpenAI: GPT-4o-mini (2024-07-18)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5', 'GPT-5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-chat-latest', 'GPT-5 Chat Latest', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-codex', 'OpenAI: GPT-5 Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-mini', 'GPT-5 Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-nano', 'GPT-5 Nano', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5-pro', 'GPT-5 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1', 'GPT-5.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-chat', 'OpenAI: GPT-5.1 Chat', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-codex', 'OpenAI: GPT-5.1-Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-codex-max', 'OpenAI: GPT-5.1-Codex-Max', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-codex-mini', 'OpenAI: GPT-5.1-Codex-Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-instant', 'GPT-5.1 Instant', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.1-thinking', 'GPT 5.1 Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2', 'GPT-5.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-chat', 'OpenAI: GPT-5.2 Chat', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-chat-latest', 'GPT-5.2 Chat', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-codex', 'OpenAI: GPT-5.2-Codex', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.2-pro', 'GPT-5.2 Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-chat', 'OpenAI: GPT-5.3 Chat', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-chat-latest', 'GPT-5.3 Chat (latest)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.3-codex-spark', 'GPT-5.3 Codex Spark', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-luna', 'GPT-5.6 Luna', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-luna-pro', 'OpenAI: GPT-5.6 Luna Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-sol', 'GPT-5.6 Sol', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-sol-pro', 'OpenAI: GPT-5.6 Sol Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-terra', 'GPT-5.6 Terra', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 272000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-5.6-terra-pro', 'OpenAI: GPT-5.6 Terra Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-audio', 'OpenAI: GPT Audio', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-audio-mini', 'OpenAI: GPT Audio Mini', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-chat-latest', 'OpenAI: GPT Chat Latest', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-latest', 'OpenAI GPT Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1050000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-mini-latest', 'OpenAI GPT Mini Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 400000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-120b-1:0', 'gpt-oss-120b', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-20b-1:0', 'gpt-oss-20b', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-safeguard-120b', 'GPT OSS Safeguard 120B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-oss-safeguard-20b', 'OpenAI: gpt-oss-safeguard-20b', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'gpt-realtime-2.1', 'GPT-Realtime-2.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'granite-4.0-h-micro', 'Granite 4.0 H Micro', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131000,
  "max_output_tokens" = 131000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'granite-4.1-8b', 'IBM: Granite 4.1 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.1-fast-non-reasoning', 'Grok 4.1 Fast Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.1-fast-reasoning', 'Grok 4.1 Fast Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20', 'xAI: Grok 4.20', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-multi-agent', 'Grok 4.20 Multi-Agent', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-multi-agent-beta', 'Grok 4.20 Multi Agent Beta', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-non-reasoning-beta', 'Grok 4.20 Beta Non-Reasoning', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-4.20-reasoning-beta', 'Grok 4.20 Beta Reasoning', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 2000000,
  "max_output_tokens" = 2000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'grok-latest', 'xAI: Grok Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 500000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'hy3', 'Tencent: Hy3', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'hy3-preview', 'Tencent: Hy3 preview', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'inkling', 'Thinking Machines: Inkling', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 524288,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'interfaze-beta', 'Interfaze Beta', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jamba-large-1.7', 'AI21: Jamba Large 1.7', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-haiku-4-5-20251001-v1:0', 'Claude Haiku 4.5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-opus-4-7', 'Claude Opus 4.7 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-opus-4-8', 'Claude Opus 4.8 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-opus-5', 'Claude Opus 5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0', 'Claude Sonnet 4.5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-sonnet-4-6', 'Claude Sonnet 4.6 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'jp.anthropic.claude-sonnet-5', 'Claude Sonnet 5 (JP)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'k3', 'Kimi K3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'k3-256k', 'Kimi K3-256K', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-air-v2.5', 'Kwaipilot: KAT-Coder-Air V2.5', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 80000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-pro-v1', 'KAT-Coder-Pro V1', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-pro-v2', 'Kwaipilot: KAT-Coder-Pro V2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kat-coder-pro-v2.5', 'Kwaipilot: KAT-Coder-Pro V2.5', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 80000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-for-coding', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-for-coding-highspeed', 'Kimi For Coding HighSpeed', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-0905', 'MoonshotAI: Kimi K2 0905', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 100352;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-0905-preview', 'Kimi K2 0905', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Kimi-K2-Instruct', 'Kimi-K2-Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Kimi-K2-Instruct-0905', 'Kimi-K2-Instruct-0905', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-thinking', 'Kimi K2 Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-thinking-turbo', 'Kimi K2 Thinking Turbo', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2-turbo-preview', 'Kimi K2 Turbo', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p6', 'Kimi K2.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p6-fast', 'Kimi K2.6 Fast', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p6-turbo', 'Kimi K2.6 Turbo', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p7-code', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2p7-code-fast', 'Kimi K2.7 Code Fast', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k3', 'Kimi K3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"openai","reasoningEffort":true,"thinkingLevelMap":{"off":null,"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"}}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-latest', 'MoonshotAI Kimi Latest', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'l3.1-euryale-70b', 'Sao10K: Llama 3.1 Euryale 70B v2.2', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'labs-devstral-small-2512', 'Devstral Small 2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'laguna-s-2.1', 'Poolside: Laguna S 2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'laguna-xs-2.1', 'Poolside: Laguna XS 2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Ling-2.6-1T', 'Ling 2.6 1T', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Ling-2.6-flash', 'Ling 2.6 Flash', 'chat', '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true,"thinkingFormat":"ant-ling"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ling-3.0-flash', 'Ling-3.0-flash (free)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-70b', 'Llama 3.1 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-70b-instruct', 'Meta: Llama 3.1 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-8b', 'Llama 3.1 8B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-8b-instant', 'Llama 3.1 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.1-8b-instruct', 'Meta: Llama 3.1 8B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.2-11b-vision-instruct', 'Llama 3.2 11b Vision Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.2-90b-vision-instruct', 'Llama-3.2-90B-Vision-Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b', 'Llama 3.3 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b-instruct', 'Meta: Llama 3.3 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b-instruct-fp8-fast', 'Llama 3.3 70B Instruct fp8 Fast', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 24000,
  "max_output_tokens" = 24000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-3.3-70b-versatile', 'Llama 3.3 70B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-4-maverick', 'Meta: Llama 4 Maverick', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-4-scout', 'Meta: Llama 4 Scout', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 327680,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B 16E', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'longcat-2.0', 'Meituan: LongCat 2.0', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048756,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'magistral-medium', 'Magistral Medium 2509', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'magistral-medium-latest', 'Magistral Medium (latest)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'magistral-small', 'Magistral Small', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mai-code-1-flash-picker', 'MAI-Code-1-Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mercury-2', 'Inception: Mercury 2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mercury-coder-small', 'Mercury Coder Small Beta', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama3-1-70b-instruct-v1:0', 'Llama 3.1 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama3-1-8b-instruct-v1:0', 'Llama 3.1 8B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama3-3-70b-instruct-v1:0', 'Llama 3.3 70B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama4-maverick-17b-instruct-v1:0', 'Llama 4 Maverick 17B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'meta.llama4-scout-17b-instruct-v1:0', 'Llama 4 Scout 17B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 3500000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2-flash', 'MiMo-V2-Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2-omni', 'MiMo-V2-Omni', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2-pro', 'MiMo-V2-Pro', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mimo-v2.5-pro-ultraspeed', 'MiMo-V2.5-Pro-UltraSpeed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"deepseek"}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m1', 'MiniMax: MiniMax M1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 40000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2', 'MiniMax: MiniMax M2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 205000,
  "max_output_tokens" = 205000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2.1', 'MiniMax: MiniMax M2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2.1-lightning', 'MiniMax M2.1 Lightning', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'MiniMax-M2.5', 'MiniMax-M2.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 196608,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2.5-highspeed', 'MiniMax M2.5 High Speed', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax-m2p7', 'MiniMax-M2.7', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 196608,
  "max_output_tokens" = 196608;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax.minimax-m2', 'MiniMax M2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204608,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax.minimax-m2.1', 'MiniMax M2.1', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 204800,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'minimax.minimax-m2.5', 'MiniMax M2.5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 196608,
  "max_output_tokens" = 98304;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-14b', 'Ministral 14B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-14b-2512', 'Mistral: Ministral 3 14B 2512', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-3b', 'Ministral 3B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-3b-2512', 'Mistral: Ministral 3 3B 2512', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-3b-latest', 'Ministral 3B (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-8b', 'Ministral 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-8b-2512', 'Mistral: Ministral 3 8B 2512', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'ministral-8b-latest', 'Ministral 8B (latest)', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large', 'Mistral Large', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-2407', 'Mistral Large 2407', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-2411', 'Mistral Large 2.1', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-2512', 'Mistral Large 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-3', 'Mistral Large 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-large-latest', 'Mistral Large (latest)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium', 'Mistral Medium 3.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-2505', 'Mistral Medium 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-2508', 'Mistral Medium 3.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-2604', 'Mistral Medium 3.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-3', 'Mistral: Mistral Medium 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-3.1', 'Mistral: Mistral Medium 3.1', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-3.5', 'Mistral Medium 3.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-medium-latest', 'Mistral Medium (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-nemo', 'Mistral Nemo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-saba', 'Mistral: Saba', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small', 'Mistral Small', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 4000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-2506', 'Mistral Small 3.2', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-2603', 'Mistral Small 4', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-3.1-24b-instruct', 'Mistral Small 3.1 24B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-3.2-24b-instruct', 'Mistral: Mistral Small 3.2 24B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral-small-latest', 'Mistral Small (latest)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.devstral-2-123b', 'Devstral 2 123B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.magistral-small-2509', 'Magistral Small 1.2', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 40000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.ministral-3-14b-instruct', 'Ministral 14B 3.0', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.ministral-3-3b-instruct', 'Ministral 3 3B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.ministral-3-8b-instruct', 'Ministral 3 8B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.mistral-large-3-675b-instruct', 'Mistral Large 3', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.pixtral-large-2502-v1:0', 'Pixtral Large (25.02)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.voxtral-mini-3b-2507', 'Voxtral Mini 3B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mistral.voxtral-small-24b-2507', 'Voxtral Small 24B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'mixtral-8x22b-instruct', 'Mistral: Mixtral 8x22B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 65536,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'moonshot.kimi-k2-thinking', 'Kimi K2 Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262143,
  "max_output_tokens" = 16000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'moonshotai.kimi-k2.5', 'Kimi K2.5', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262143,
  "max_output_tokens" = 16000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'muse-spark-1.1', 'Meta: Muse Spark 1.1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1048576,
  "max_output_tokens" = 1048576;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-120b-a12b', 'Nemotron 3 Super 120B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 256000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-nano-omni-30b-a3b-reasoning', 'NVIDIA: Nemotron 3 Nano Omni (free)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-ultra', 'Nemotron 3 Ultra Free', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-3-ultra-550b-a55b', 'NVIDIA: Nemotron 3 Ultra', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini-deep-research', 'OpenAI: o4 Mini Deep Research', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-nano-12b-v2-vl', 'NVIDIA: Nemotron Nano 12B 2 VL (free)', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nemotron-nano-9b-v2', 'NVIDIA: Nemotron Nano 9B V2 (free)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nex-n2-mini', 'Nex AGI: Nex-N2-Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nex-n2-pro', 'Nex AGI: Nex-N2-Pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'north-mini-code', 'Cohere: North Mini Code (free)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-2-lite', 'Nova 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 1000000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-2-lite-v1', 'Amazon: Nova 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65535;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-2-lite-v1:0', 'Nova 2 Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-lite', 'Nova Lite', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-lite-v1', 'Amazon: Nova Lite 1.0', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 5120;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-lite-v1:0', 'Nova Lite', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-micro', 'Nova Micro', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-micro-v1', 'Amazon: Nova Micro 1.0', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 5120;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-micro-v1:0', 'Nova Micro', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-premier-v1', 'Amazon: Nova Premier 1.0', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-pro', 'Nova Pro', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-pro-v1', 'Amazon: Nova Pro 1.0', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 5120;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nova-pro-v1:0', 'Nova Pro', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 300000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia-nemotron-nano-9b-v2', 'nvidia-nemotron-nano-9b-v2', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia.nemotron-nano-12b-v2', 'NVIDIA Nemotron Nano 12B v2 VL BF16', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia.nemotron-nano-3-30b', 'NVIDIA Nemotron Nano 3 30B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'nvidia.nemotron-super-3-120b', 'NVIDIA Nemotron 3 Super 120B A12B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o1', 'o1', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o1-pro', 'o1-pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-deep-research', 'OpenAI: o3 Deep Research', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-mini', 'o3-mini', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-mini-high', 'OpenAI: o3 Mini High', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o3-pro', 'o3-pro', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'o4-mini-high', 'OpenAI: o4 Mini High', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 100000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mistral-7b', 'Mistral 7B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 8000,
  "max_output_tokens" = 8000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mistral-nemo', 'Open Mistral Nemo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mixtral-8x22b', 'Mixtral 8x22B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 64000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'open-mixtral-8x7b', 'Mixtral 8x7B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'pixtral-12b', 'Pixtral 12B', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'pixtral-large-latest', 'Pixtral Large (latest)', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-2.5-72b-instruct', 'Qwen2.5 72B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-2.5-7b-instruct', 'Qwen: Qwen2.5 7B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-14b', 'Qwen3-14B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 40960,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-235b', 'Qwen3 235B A22B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-30b', 'Qwen3-30B-A3B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 40960,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3-32b', 'Qwen 3 32B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-3.6-max-preview', 'Qwen 3.6 Max Preview', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 240000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-plus', 'Qwen: Qwen-Plus', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-plus-2025-07-28', 'Qwen: Qwen Plus 0728', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen-plus-2025-07-28:thinking', 'Qwen: Qwen Plus 0728 (thinking)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-235b-a22b-2507-v1:0', 'Qwen3 235B A22B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-32b-v1:0', 'Qwen3 32B (dense)', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16384,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-coder-30b-a3b-v1:0', 'Qwen3 Coder 30B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-coder-480b-a35b-v1:0', 'Qwen3 Coder 480B A35B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-coder-next', 'Qwen3 Coder Next', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-next-80b-a3b', 'Qwen/Qwen3-Next-80B-A3B-Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen.qwen3-vl-235b-a22b', 'Qwen/Qwen3-VL-235B-A22B-Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262000,
  "max_output_tokens" = 262000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Qwen2.5-7B-Instruct-Turbo', 'Qwen 2.5 7B Instruct Turbo', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-14b', 'Qwen: Qwen3 14B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b-2507', 'Qwen: Qwen3 235B A22B Instruct 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b-thinking', 'Qwen3 VL 235B A22B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-235b-a22b-thinking-2507', 'Qwen: Qwen3 235B A22B Thinking 2507', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b', 'Qwen: Qwen3 30B A3B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 40960,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b-fp8', 'Qwen3 30B A3b fp8', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b-instruct-2507', 'Qwen: Qwen3 30B A3B Instruct 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 32000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-30b-a3b-thinking-2507', 'Qwen: Qwen3 30B A3B Thinking 2507', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 81920,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-8b', 'Qwen: Qwen3 8B', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder', 'Qwen: Qwen3 Coder 480B A35B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-30b-a3b', 'Qwen 3 Coder 30B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-30b-a3b-instruct', 'Qwen: Qwen3 Coder 30B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Qwen3-Coder-480B-A35B-Instruct', 'Qwen3-Coder-480B-A35B-Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 66536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-flash', 'Qwen: Qwen3 Coder Flash', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-next', 'Qwen: Qwen3 Coder Next', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-coder-plus', 'Qwen: Qwen3 Coder Plus', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-max', 'Qwen: Qwen3 Max', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-max-preview', 'Qwen3 Max Preview', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-max-thinking', 'Qwen: Qwen3 Max Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-next-80b-a3b-instruct', 'Qwen: Qwen3 Next 80B A3B Instruct', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-next-80b-a3b-thinking', 'Qwen: Qwen3 Next 80B A3B Thinking', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-235b-a22b-instruct', 'Qwen: Qwen3 VL 235B A22B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 129024;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-235b-a22b-thinking', 'Qwen: Qwen3 VL 235B A22B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-30b-a3b-instruct', 'Qwen: Qwen3 VL 30B A3B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-30b-a3b-thinking', 'Qwen: Qwen3 VL 30B A3B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-32b-instruct', 'Qwen: Qwen3 VL 32B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-8b-instruct', 'Qwen: Qwen3 VL 8B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-8b-thinking', 'Qwen: Qwen3 VL 8B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-instruct', 'Qwen3 VL 235B A22B Instruct', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 129024;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3-vl-thinking', 'Qwen3 VL 235B A22B Thinking', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-122b-a10b', 'Qwen: Qwen3.5-122B-A10B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-27b', 'Qwen: Qwen3.5-27B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-35b-a3b', 'Qwen: Qwen3.5-35B-A3B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-397b-a17b', 'Qwen: Qwen3.5 397B A17B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-9b', 'Qwen: Qwen3.5-9B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-flash', 'Qwen 3.5 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-flash-02-23', 'Qwen: Qwen3.5-Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-plus', 'Qwen 3.5 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-plus-02-15', 'Qwen: Qwen3.5 Plus 2026-02-15', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.5-plus-20260420', 'Qwen: Qwen3.5 Plus 2026-04-20', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-35b-a3b', 'Qwen: Qwen3.6 35B A3B', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-flash', 'Qwen3.6 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-max-preview', 'Qwen: Qwen3.6 Max Preview', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.6-plus', 'Qwen3.6 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.7-max', 'Qwen3.7 Max', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.7-plus', 'Qwen3.7 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3.8-max-preview', 'Qwen3.8 Max Preview', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"qwen"}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'qwen3p7-plus', 'Qwen 3.7 Plus', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'reka-edge', 'Reka Edge', 'chat', '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"systemPrompt":true}'::jsonb,
  "context_window" = 16384,
  "max_output_tokens" = 16384;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'relace-search', 'Relace: Relace Search', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 128000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'Ring-2.6-1T', 'Ring 2.6 1T', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"ant-ling","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"high","xhigh":"xhigh"}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"ant-ling","thinkingLevelMap":{"off":null,"minimal":null,"low":null,"medium":null,"high":"high","xhigh":"xhigh"}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 65536;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-1.6', 'ByteDance Seed: Seed 1.6', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-1.6-flash', 'ByteDance Seed: Seed 1.6 Flash', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-1.8', 'Bytedance Seed 1.8', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 256000,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-2.0-lite', 'ByteDance Seed: Seed-2.0-Lite', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'seed-2.0-mini', 'ByteDance Seed: Seed-2.0-Mini', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'solar-pro-3', 'Upstage: Solar Pro 3', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 128000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'trinity-large-thinking', 'Arcee AI: Trinity Large Thinking', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'trinity-mini', 'Trinity Mini', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'unslopnemo-12b', 'TheDrummer: UnslopNemo 12B', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32768,
  "max_output_tokens" = 32768;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'virtuoso-large', 'Arcee AI: Virtuoso Large', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 131072,
  "max_output_tokens" = 64000;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'voxtral-small-24b-2507', 'Mistral: Voxtral Small 24B 2507', 'chat', '{"tools":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"systemPrompt":true}'::jsonb,
  "context_window" = 32000,
  "max_output_tokens" = 4096;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'writer.palmyra-x4-v1:0', 'Palmyra X4', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 122880,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'writer.palmyra-x5-v1:0', 'Palmyra X5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1040000,
  "max_output_tokens" = 8192;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'xai.grok-4.3', 'Grok 4.3', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 1000000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'zai.glm-4.7-flash', 'GLM-4.7-Flash', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 200000,
  "max_output_tokens" = 131072;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'zai.glm-5', 'GLM-5', 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb,
  "context_window" = 202752,
  "max_output_tokens" = 101376;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code', 'Kimi K2.7 Code', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
--> statement-breakpoint
INSERT INTO "model_catalog" ("id", "canonical_model_id", "name", "model_type", "capabilities") VALUES (gen_random_uuid(), 'kimi-k2.7-code-highspeed', 'Kimi K2.7 Code HighSpeed', 'chat', '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb)
ON CONFLICT ("canonical_model_id") DO UPDATE SET
  "capabilities" = '{"tools":true,"vision":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"fixed","thinkingLevelMap":{"low":null,"max":null,"off":null,"high":"default","xhigh":null,"medium":null,"minimal":null}}'::jsonb,
  "context_window" = 262144,
  "max_output_tokens" = 262144;
