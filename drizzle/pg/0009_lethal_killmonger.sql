CREATE TABLE "message_feedback" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_feedback_user_message_unique_idx" ON "message_feedback" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "message_feedback_conversation_idx" ON "message_feedback" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_feedback_rating_idx" ON "message_feedback" USING btree ("rating");