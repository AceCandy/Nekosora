CREATE TABLE "gateway_attempts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"provider_ref" text,
	"provider_name" text,
	"provider_protocol" text,
	"route_id" text,
	"route_name" text,
	"upstream_model" text,
	"upstream_key_masked" text,
	"http_status" integer,
	"error_code" text,
	"error_message" text,
	"error_phase" text,
	"error_type" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"first_token_latency_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_executions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"operation" text NOT NULL,
	"source" text NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"key_kind" text,
	"model" text NOT NULL,
	"model_id" text,
	"provider_ref" text,
	"provider_name" text,
	"route_id" text,
	"route_name" text,
	"upstream_model" text,
	"upstream_key_masked" text,
	"request_path" text,
	"stream" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"http_status" integer,
	"error_code" text,
	"error_message" text,
	"error_phase" text,
	"error_type" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"first_token_latency_ms" integer,
	"task_kind" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "ops_error_logs";--> statement-breakpoint
DROP TABLE "usage_logs";--> statement-breakpoint
ALTER TABLE "gateway_attempts" ADD CONSTRAINT "gateway_attempts_execution_id_gateway_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."gateway_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_executions" ADD CONSTRAINT "gateway_executions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_executions" ADD CONSTRAINT "gateway_executions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_attempts_execution_attempt_unique_idx" ON "gateway_attempts" USING btree ("execution_id","attempt");--> statement-breakpoint
CREATE INDEX "gateway_attempts_execution_idx" ON "gateway_attempts" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "gateway_attempts_created_idx" ON "gateway_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gateway_attempts_provider_ref_idx" ON "gateway_attempts" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "gateway_attempts_status_idx" ON "gateway_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gateway_executions_user_idx" ON "gateway_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gateway_executions_created_idx" ON "gateway_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gateway_executions_model_idx" ON "gateway_executions" USING btree ("model");--> statement-breakpoint
CREATE INDEX "gateway_executions_request_idx" ON "gateway_executions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "gateway_executions_status_idx" ON "gateway_executions" USING btree ("status");
