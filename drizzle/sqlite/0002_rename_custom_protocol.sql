UPDATE `global_providers` SET `protocol`='openai-compatible' WHERE `protocol`='custom';--> statement-breakpoint
UPDATE `user_providers` SET `protocol`='openai-compatible' WHERE `protocol`='custom';
