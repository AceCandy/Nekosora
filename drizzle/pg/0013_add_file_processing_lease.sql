ALTER TABLE "file_objects" ADD COLUMN "processing_lease_id" text;--> statement-breakpoint
ALTER TABLE "file_objects" ADD COLUMN "processing_lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "file_objects"
SET "processing_lease_expires_at" = now()
WHERE "processing_status" IN ('extracting', 'embedding')
  AND "processing_lease_expires_at" IS NULL;--> statement-breakpoint
CREATE INDEX "file_objects_stale_processing_idx" ON "file_objects" USING btree ("processing_lease_expires_at","created_at") WHERE "file_objects"."processing_status" IN ('extracting', 'embedding');
