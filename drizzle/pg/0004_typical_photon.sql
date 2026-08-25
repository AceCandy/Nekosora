DROP INDEX "instruction_cards_scope_idx";--> statement-breakpoint
DELETE FROM "instruction_cards" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "instruction_cards" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "instruction_cards" DROP COLUMN "scope";
