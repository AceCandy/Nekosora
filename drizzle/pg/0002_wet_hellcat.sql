CREATE TABLE "memory_extraction_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"messages" jsonb NOT NULL,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_extraction_jobs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_run_id_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_extraction_jobs_dispatch_idx" ON "memory_extraction_jobs" USING btree ("dispatch_after","created_at");