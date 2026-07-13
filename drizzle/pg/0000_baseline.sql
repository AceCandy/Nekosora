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
('catalog-mimo-v2-5', 'MiMo V2.5', 'mimo-v2.5', '["xiaomi/mimo-v2.5"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 22),
('catalog-mimo-v2-5-pro', 'MiMo V2.5 Pro', 'mimo-v2.5-pro', '["xiaomi/mimo-v2.5-pro"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 23),
('catalog-step-3-7-flash', 'Step 3.7 Flash', 'step-3.7-flash', '["stepfun/step-3.7-flash"]'::jsonb, 'chat', '{"reasoning":true,"systemPrompt":true}'::jsonb, 24),
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
('catalog-qwen3-235b-a22b', 'Qwen3 235B A22B', 'qwen3-235b-a22b', '["qwen/qwen3-235b-a22b","qwen3-235b-a22b-instruct-2507"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 70),
('catalog-qwen3-32b', 'Qwen3 32B', 'qwen3-32b', '["qwen/qwen3-32b"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true}'::jsonb, 71),
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
('catalog-glm-4-7', 'GLM 4.7', 'glm-4.7', '["zai/glm-4.7","zhipu/glm-4.7","volcengine/glm-4.7"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb, 80),
('catalog-glm-5-turbo', 'GLM 5 Turbo', 'glm-5-turbo', '["zai/glm-5-turbo","zhipu/glm-5-turbo","volcengine/glm-5-turbo"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb, 81),
('catalog-glm-5-1', 'GLM 5.1', 'glm-5.1', '["zai/glm-5.1","zhipu/glm-5.1","volcengine/glm-5.1"]'::jsonb, 'chat', '{"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb, 82),
('catalog-glm-5-2', 'GLM 5.2', 'glm-5.2', '["zai/glm-5.2","zhipu/glm-5.2","volcengine/glm-5.2"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai","thinkingLevelMap":{"minimal":null,"low":"high","medium":"high","high":"high","max":"max"}}'::jsonb, 83),
('catalog-glm-5v-turbo', 'GLM 5V Turbo', 'glm-5v-turbo', '["zai/glm-5v-turbo","zhipu/glm-5v-turbo","volcengine/glm-5v-turbo"]'::jsonb, 'chat', '{"vision":true,"tools":true,"reasoning":true,"systemPrompt":true,"thinkingFormat":"zai"}'::jsonb, 84),
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
UPDATE "model_catalog"
SET "capabilities" = jsonb_set("capabilities", '{thinkingFormat}', '"openrouter"'::jsonb)
WHERE "canonical_model_id" IN ('step-3.7-flash', 'mimo-v2.5', 'mimo-v2.5-pro', 'qwen3-235b-a22b', 'qwen3-32b');

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
