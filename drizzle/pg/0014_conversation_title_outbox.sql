CREATE TABLE "conversation_title_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"first_user_message" text NOT NULL,
	"fallback_title" text NOT NULL,
	"chat_model" text,
	"chat_model_id" text,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_title_jobs_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_title_jobs" ADD CONSTRAINT "conversation_title_jobs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_title_jobs" ADD CONSTRAINT "conversation_title_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_title_jobs_dispatch_idx" ON "conversation_title_jobs" USING btree ("dispatch_after","created_at");