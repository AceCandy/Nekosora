ALTER TABLE "runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "lease_expires_at" SET DEFAULT now() + interval '2 minutes';--> statement-breakpoint
UPDATE "runs"
SET "lease_expires_at" = now() + interval '2 minutes'
WHERE "status" = 'running' AND "lease_expires_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runs_active_conversation_idx" ON "runs" USING btree ("conversation_id","lease_expires_at") WHERE "runs"."status" = 'running';
