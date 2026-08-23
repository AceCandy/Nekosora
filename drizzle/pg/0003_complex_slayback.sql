CREATE TYPE "public"."gateway_governance_scope" AS ENUM('key', 'user');--> statement-breakpoint
CREATE TYPE "public"."settings_change_set_kind" AS ENUM('edit', 'rollback');--> statement-breakpoint
CREATE TYPE "public"."settings_change_set_status" AS ENUM('draft', 'applied', 'abandoned');--> statement-breakpoint
CREATE TABLE "gateway_governance_hourly" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"scope" "gateway_governance_scope" NOT NULL,
	"request_count" bigint DEFAULT 0 NOT NULL,
	"rpm_peak" integer DEFAULT 0 NOT NULL,
	"concurrency_peak" integer DEFAULT 0 NOT NULL,
	"rate_rejected" bigint DEFAULT 0 NOT NULL,
	"concurrency_rejected" bigint DEFAULT 0 NOT NULL,
	"quota_chat_tokens_rejected" bigint DEFAULT 0 NOT NULL,
	"quota_image_count_rejected" bigint DEFAULT 0 NOT NULL,
	"quota_tts_code_points_rejected" bigint DEFAULT 0 NOT NULL,
	"quota_stt_seconds_rejected" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_governance_hourly_bucket_start_check" CHECK ("gateway_governance_hourly"."bucket_start" = date_trunc('hour', "gateway_governance_hourly"."bucket_start" at time zone 'UTC') at time zone 'UTC'),
	CONSTRAINT "gateway_governance_hourly_non_negative_check" CHECK ("gateway_governance_hourly"."request_count" >= 0
        and "gateway_governance_hourly"."rpm_peak" >= 0
        and "gateway_governance_hourly"."concurrency_peak" >= 0
        and "gateway_governance_hourly"."rate_rejected" >= 0
        and "gateway_governance_hourly"."concurrency_rejected" >= 0
        and "gateway_governance_hourly"."quota_chat_tokens_rejected" >= 0
        and "gateway_governance_hourly"."quota_image_count_rejected" >= 0
        and "gateway_governance_hourly"."quota_tts_code_points_rejected" >= 0
        and "gateway_governance_hourly"."quota_stt_seconds_rejected" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settings_change_sets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "settings_change_set_status" DEFAULT 'draft' NOT NULL,
	"kind" "settings_change_set_kind" DEFAULT 'edit' NOT NULL,
	"rollback_of" text,
	"actor_id" text NOT NULL,
	"base_revision" bigint NOT NULL,
	"applied_revision" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	CONSTRAINT "settings_change_sets_base_revision_check" CHECK ("settings_change_sets"."base_revision" >= 0),
	CONSTRAINT "settings_change_sets_version_check" CHECK ("settings_change_sets"."version" > 0),
	CONSTRAINT "settings_change_sets_changes_array_check" CHECK (jsonb_typeof("settings_change_sets"."changes") = 'array'),
	CONSTRAINT "settings_change_sets_rollback_check" CHECK (("settings_change_sets"."kind" = 'edit' and "settings_change_sets"."rollback_of" is null)
        or ("settings_change_sets"."kind" = 'rollback' and "settings_change_sets"."rollback_of" is not null)),
	CONSTRAINT "settings_change_sets_status_check" CHECK (("settings_change_sets"."status" = 'draft'
          and "settings_change_sets"."applied_revision" is null
          and "settings_change_sets"."applied_at" is null
          and "settings_change_sets"."abandoned_at" is null)
        or ("settings_change_sets"."status" = 'applied'
          and "settings_change_sets"."applied_revision" is not null
          and "settings_change_sets"."applied_at" is not null
          and "settings_change_sets"."abandoned_at" is null)
        or ("settings_change_sets"."status" = 'abandoned'
          and "settings_change_sets"."applied_revision" is null
          and "settings_change_sets"."applied_at" is null
          and "settings_change_sets"."abandoned_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "settings_control_state" (
	"id" text PRIMARY KEY NOT NULL,
	"current_revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_control_state_singleton_check" CHECK ("settings_control_state"."id" = 'global'),
	CONSTRAINT "settings_control_state_revision_check" CHECK ("settings_control_state"."current_revision" >= 0)
);
--> statement-breakpoint
INSERT INTO "settings_control_state" ("id", "current_revision") VALUES ('global', 0);--> statement-breakpoint
ALTER TABLE "gateway_governance_subjects" ADD COLUMN "metrics_minute_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateway_governance_subjects" ADD COLUMN "metrics_minute_requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings_change_sets" ADD CONSTRAINT "settings_change_sets_rollback_of_settings_change_sets_id_fk" FOREIGN KEY ("rollback_of") REFERENCES "public"."settings_change_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_change_sets" ADD CONSTRAINT "settings_change_sets_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_governance_hourly_bucket_scope_idx" ON "gateway_governance_hourly" USING btree ("bucket_start","scope");--> statement-breakpoint
CREATE INDEX "gateway_governance_hourly_bucket_idx" ON "gateway_governance_hourly" USING btree ("bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_change_sets_single_draft_idx" ON "settings_change_sets" USING btree ("status") WHERE "settings_change_sets"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "settings_change_sets_applied_revision_idx" ON "settings_change_sets" USING btree ("applied_revision");--> statement-breakpoint
CREATE INDEX "settings_change_sets_applied_at_idx" ON "settings_change_sets" USING btree ("applied_at");--> statement-breakpoint
ALTER TABLE "gateway_governance_subjects" ADD CONSTRAINT "gateway_governance_subjects_metrics_requests_check" CHECK ("gateway_governance_subjects"."metrics_minute_requests" >= 0);--> statement-breakpoint
CREATE FUNCTION "prevent_applied_settings_change_set_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."status" = 'applied' THEN
		RAISE EXCEPTION 'applied settings change sets are immutable' USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "settings_change_sets_applied_immutable"
BEFORE UPDATE OR DELETE ON "settings_change_sets"
FOR EACH ROW EXECUTE FUNCTION "prevent_applied_settings_change_set_mutation"();
