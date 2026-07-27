CREATE TABLE "conversation_share_unlock_attempts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" text NOT NULL,
	"scope" text NOT NULL,
	"client_fingerprint" text NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "password_verifier" text;--> statement-breakpoint
ALTER TABLE "conversation_shares" ADD COLUMN "render_style_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "message_version_selections" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_share_unlock_attempts" ADD CONSTRAINT "conversation_share_unlock_attempts_share_id_conversation_shares_share_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."conversation_shares"("share_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_share_unlock_attempts_bucket_idx" ON "conversation_share_unlock_attempts" USING btree ("share_id","scope","client_fingerprint");--> statement-breakpoint
CREATE INDEX "conversation_share_unlock_attempts_updated_idx" ON "conversation_share_unlock_attempts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "conversation_shares_conversation_created_idx" ON "conversation_shares" USING btree ("conversation_id","created_at");