-- 仅清除未生效记录，保留当前配置和全部已生效历史。
DELETE FROM "settings_change_sets" WHERE "status" IN ('draft', 'abandoned');--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_applied_settings_change_set_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'applied settings change sets are immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
ALTER TABLE "settings_change_sets" DROP CONSTRAINT "settings_change_sets_version_check";--> statement-breakpoint
ALTER TABLE "settings_change_sets" DROP CONSTRAINT "settings_change_sets_status_check";--> statement-breakpoint
DROP INDEX "settings_change_sets_single_draft_idx";--> statement-breakpoint
ALTER TABLE "settings_change_sets" ALTER COLUMN "applied_revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings_change_sets" ALTER COLUMN "applied_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings_change_sets" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "settings_change_sets" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "settings_change_sets" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "settings_change_sets" DROP COLUMN "abandoned_at";--> statement-breakpoint
DROP TYPE "public"."settings_change_set_status";
