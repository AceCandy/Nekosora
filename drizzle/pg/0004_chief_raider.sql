ALTER TABLE "providers" ADD COLUMN "last_model_probe_ok" boolean;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_model_probe_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_model_probe_error" text;