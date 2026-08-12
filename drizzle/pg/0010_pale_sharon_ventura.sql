CREATE TYPE "public"."gateway_governance_operation" AS ENUM('chat.stream', 'chat.generate', 'image.generate', 'audio.speech', 'audio.transcription', 'mcp.search');--> statement-breakpoint
CREATE TYPE "public"."gateway_quota_kind" AS ENUM('chat_tokens', 'image_count', 'tts_code_points', 'stt_seconds');--> statement-breakpoint
CREATE TABLE "gateway_governance_leases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_subject_id" text NOT NULL,
	"user_subject_id" text NOT NULL,
	"operation" "gateway_governance_operation" NOT NULL,
	"quota_kind" "gateway_quota_kind",
	"quota_month_start" timestamp with time zone,
	"reserved_units" bigint,
	"provider_started_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_governance_leases_quota_fields_check" CHECK ((
        "gateway_governance_leases"."quota_kind" is null
        and "gateway_governance_leases"."quota_month_start" is null
        and "gateway_governance_leases"."reserved_units" is null
      ) or (
        "gateway_governance_leases"."quota_kind" is not null
        and "gateway_governance_leases"."quota_month_start" is not null
        and "gateway_governance_leases"."reserved_units" > 0
      ))
);
--> statement-breakpoint
CREATE TABLE "gateway_governance_subjects" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"rate_tokens" numeric(20, 6) NOT NULL,
	"rate_refilled_at" timestamp with time zone NOT NULL,
	"policy_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_governance_subjects_identity_check" CHECK (num_nonnulls("gateway_governance_subjects"."user_id", "gateway_governance_subjects"."api_key_id") = 1),
	CONSTRAINT "gateway_governance_subjects_rate_tokens_check" CHECK ("gateway_governance_subjects"."rate_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gateway_quota_windows" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"quota_kind" "gateway_quota_kind" NOT NULL,
	"month_start" timestamp with time zone NOT NULL,
	"reserved_units" bigint DEFAULT 0 NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_quota_windows_reserved_units_check" CHECK ("gateway_quota_windows"."reserved_units" >= 0),
	CONSTRAINT "gateway_quota_windows_used_units_check" CHECK ("gateway_quota_windows"."used_units" >= 0),
	CONSTRAINT "gateway_quota_windows_month_start_check" CHECK ("gateway_quota_windows"."month_start" = date_trunc('month', "gateway_quota_windows"."month_start" at time zone 'UTC') at time zone 'UTC')
);
--> statement-breakpoint
ALTER TABLE "gateway_attempts" ADD COLUMN "image_count" integer;--> statement-breakpoint
ALTER TABLE "gateway_attempts" ADD COLUMN "tts_code_points" integer;--> statement-breakpoint
ALTER TABLE "gateway_attempts" ADD COLUMN "stt_seconds" integer;--> statement-breakpoint
ALTER TABLE "gateway_executions" ADD COLUMN "image_count" integer;--> statement-breakpoint
ALTER TABLE "gateway_executions" ADD COLUMN "tts_code_points" integer;--> statement-breakpoint
ALTER TABLE "gateway_executions" ADD COLUMN "stt_seconds" integer;--> statement-breakpoint
ALTER TABLE "gateway_governance_leases" ADD CONSTRAINT "gateway_governance_leases_key_subject_id_gateway_governance_subjects_id_fk" FOREIGN KEY ("key_subject_id") REFERENCES "public"."gateway_governance_subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_governance_leases" ADD CONSTRAINT "gateway_governance_leases_user_subject_id_gateway_governance_subjects_id_fk" FOREIGN KEY ("user_subject_id") REFERENCES "public"."gateway_governance_subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_governance_subjects" ADD CONSTRAINT "gateway_governance_subjects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_governance_subjects" ADD CONSTRAINT "gateway_governance_subjects_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_quota_windows" ADD CONSTRAINT "gateway_quota_windows_subject_id_gateway_governance_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."gateway_governance_subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_governance_leases_key_expiry_idx" ON "gateway_governance_leases" USING btree ("key_subject_id","lease_expires_at");--> statement-breakpoint
CREATE INDEX "gateway_governance_leases_user_expiry_idx" ON "gateway_governance_leases" USING btree ("user_subject_id","lease_expires_at");--> statement-breakpoint
CREATE INDEX "gateway_governance_leases_expiry_id_idx" ON "gateway_governance_leases" USING btree ("lease_expires_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_governance_subjects_user_unique_idx" ON "gateway_governance_subjects" USING btree ("user_id") WHERE "gateway_governance_subjects"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_governance_subjects_api_key_unique_idx" ON "gateway_governance_subjects" USING btree ("api_key_id") WHERE "gateway_governance_subjects"."api_key_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_quota_windows_subject_kind_month_unique_idx" ON "gateway_quota_windows" USING btree ("subject_id","quota_kind","month_start");--> statement-breakpoint
CREATE INDEX "gateway_quota_windows_subject_idx" ON "gateway_quota_windows" USING btree ("subject_id");