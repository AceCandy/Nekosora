CREATE TABLE "image_jobs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"n" integer DEFAULT 1 NOT NULL,
	"size" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_urls" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_jobs" ADD CONSTRAINT "image_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_jobs_user_idx" ON "image_jobs" USING btree ("user_id");