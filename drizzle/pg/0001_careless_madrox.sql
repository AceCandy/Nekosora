CREATE TABLE "instruction_cards" (
	"id" text PRIMARY KEY DEFAULT '(gen_random_uuid())' NOT NULL,
	"user_id" text,
	"scope" text NOT NULL,
	"trigger" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instruction_cards" ADD CONSTRAINT "instruction_cards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instruction_cards_scope_idx" ON "instruction_cards" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "instruction_cards_user_idx" ON "instruction_cards" USING btree ("user_id");