DROP INDEX "api_keys_parent_idx";--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "parent_id";
