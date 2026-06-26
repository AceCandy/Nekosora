ALTER TABLE "global_providers" ADD COLUMN "last_health_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "global_providers" ADD COLUMN "last_healthy_key_count" integer;--> statement-breakpoint
ALTER TABLE "global_providers" ADD COLUMN "last_total_key_count" integer;--> statement-breakpoint
ALTER TABLE "user_providers" ADD COLUMN "last_health_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_providers" ADD COLUMN "last_healthy_key_count" integer;--> statement-breakpoint
ALTER TABLE "user_providers" ADD COLUMN "last_total_key_count" integer;