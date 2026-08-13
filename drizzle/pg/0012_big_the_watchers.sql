CREATE TABLE "gateway_retention_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_claimed_date" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_executions" ADD COLUMN "model_type" text;--> statement-breakpoint
CREATE INDEX "gateway_executions_retention_idx" ON "gateway_executions" USING btree ("status","created_at","id");