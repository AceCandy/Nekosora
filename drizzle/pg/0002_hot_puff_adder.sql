ALTER TABLE "providers" ADD COLUMN "test_model" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "upstream_models" jsonb;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "upstream_models_at" timestamp with time zone;