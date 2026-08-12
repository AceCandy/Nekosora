UPDATE "providers" SET "connect_timeout_ms" = NULL WHERE "connect_timeout_ms" IS NOT NULL AND "connect_timeout_ms" NOT BETWEEN 1000 AND 300000;--> statement-breakpoint
UPDATE "providers" SET "read_timeout_ms" = NULL WHERE "read_timeout_ms" IS NOT NULL AND "read_timeout_ms" NOT BETWEEN 10000 AND 3600000;--> statement-breakpoint
UPDATE "providers" SET "stream_idle_timeout_ms" = NULL WHERE "stream_idle_timeout_ms" IS NOT NULL AND "stream_idle_timeout_ms" NOT BETWEEN 5000 AND 900000;--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_connect_timeout_ms_check" CHECK ("providers"."connect_timeout_ms" between 1000 and 300000);--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_read_timeout_ms_check" CHECK ("providers"."read_timeout_ms" between 10000 and 3600000);--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_stream_idle_timeout_ms_check" CHECK ("providers"."stream_idle_timeout_ms" between 5000 and 900000);
