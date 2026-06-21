CREATE TYPE "public"."access_scope" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."api_key_kind" AS ENUM('master', 'sub');--> statement-breakpoint
CREATE TYPE "public"."binding_scope" AS ENUM('global', 'byo');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'streaming', 'success', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."provider_protocol" AS ENUM('openai', 'anthropic', 'gemini', 'custom', 'openai-images', 'openai-audio-stt', 'openai-audio-tts');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"kind" "api_key_kind" NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"language" text,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_artifact_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_snapshots" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_projects" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_shares" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"share_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"title_snapshot" text,
	"model_snapshot" text,
	"message_ids_json" jsonb,
	"default_message_ids_json" jsonb,
	"revoked_at" timestamp,
	"regenerated_at" timestamp,
	"last_accessed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_shares_share_id_unique" UNIQUE("share_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '新会话' NOT NULL,
	"project_id" text,
	"model_name" text,
	"context_policy" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
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
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
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
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_models" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"vendor" text,
	"icon" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"system_prompt" text,
	"description" text,
	"access_scope" "access_scope" DEFAULT 'public' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "global_models_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "global_providers" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_routes" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"upstream_model_name" text NOT NULL,
	"protocol" "provider_protocol" NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"headers_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_model_bindings" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"key_id" text NOT NULL,
	"scope" "binding_scope" NOT NULL,
	"global_model_id" text,
	"user_model_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
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
	"last_connected_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"conversation_id" text NOT NULL,
	"public_id" text NOT NULL,
	"parent_id" text,
	"source_id" text,
	"run_id" text,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_type" text DEFAULT 'text' NOT NULL,
	"branch_reason" text,
	"status" "message_status" DEFAULT 'success' NOT NULL,
	"token_usage" jsonb,
	"error_code" text,
	"error_message" text,
	"process_trace" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"run_id" text NOT NULL,
	"conversation_id" text,
	"user_id" text,
	"upstream_id" text,
	"platform_model_name" text,
	"routed_binding_code" text,
	"model_vendor" text,
	"first_token_latency_ms" integer,
	"token_usage" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_type" text NOT NULL,
	"tool_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"error_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"ban_expires" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_models" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"upstream_model_name" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_providers" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"protocol" "provider_protocol" NOT NULL,
	"base_url" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
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
ALTER TABLE "global_routes" ADD CONSTRAINT "global_routes_model_id_global_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."global_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_routes" ADD CONSTRAINT "global_routes_provider_id_global_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."global_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_global_model_id_global_models_id_fk" FOREIGN KEY ("global_model_id") REFERENCES "public"."global_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_model_bindings" ADD CONSTRAINT "key_model_bindings_user_model_id_user_models_id_fk" FOREIGN KEY ("user_model_id") REFERENCES "public"."user_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_models" ADD CONSTRAINT "user_models_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_models" ADD CONSTRAINT "user_models_provider_id_user_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."user_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_providers" ADD CONSTRAINT "user_providers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_parent_idx" ON "api_keys" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_master_unique_idx" ON "api_keys" USING btree ("user_id") WHERE kind = 'master';--> statement-breakpoint
CREATE INDEX "artifacts_msg_idx" ON "artifacts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "artifacts_conv_idx" ON "artifacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_chunks_file_idx" ON "file_chunks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_objects_user_idx" ON "file_objects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "global_routes_model_idx" ON "global_routes" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "key_model_bindings_key_idx" ON "key_model_bindings" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "key_model_bindings_unique_idx" ON "key_model_bindings" USING btree ("key_id","scope","global_model_id","user_model_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_user_idx" ON "mcp_servers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_enabled_idx" ON "mcp_servers" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_parent_idx" ON "messages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "messages_run_idx" ON "messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "prompt_templates_scope_idx" ON "prompt_templates" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_unique_idx" ON "system_settings" USING btree ("namespace","key");--> statement-breakpoint
CREATE INDEX "usage_logs_user_idx" ON "usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_logs_created_idx" ON "usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_model_idx" ON "usage_logs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "user_memories_user_idx" ON "user_memories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_unique_idx" ON "user_settings" USING btree ("user_id","key");