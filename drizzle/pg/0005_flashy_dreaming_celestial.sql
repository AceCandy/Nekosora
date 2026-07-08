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
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "first_token_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "route_id" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "route_name" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "upstream_model" text;--> statement-breakpoint
ALTER TABLE "ops_error_logs" ADD CONSTRAINT "ops_error_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops_error_logs" ADD CONSTRAINT "ops_error_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_error_logs_user_idx" ON "ops_error_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ops_error_logs_created_idx" ON "ops_error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ops_error_logs_error_code_idx" ON "ops_error_logs" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "ops_error_logs_http_status_idx" ON "ops_error_logs" USING btree ("http_status");--> statement-breakpoint
CREATE INDEX "ops_error_logs_provider_ref_idx" ON "ops_error_logs" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "ops_error_logs_source_idx" ON "ops_error_logs" USING btree ("source");