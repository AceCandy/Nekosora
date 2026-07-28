CREATE TABLE "message_file_objects" (
	"message_id" text NOT NULL,
	"file_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "message_file_objects_message_file_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "message_file_objects" ADD CONSTRAINT "message_file_objects_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_file_objects" ADD CONSTRAINT "message_file_objects_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_file_objects_message_sort_unique_idx" ON "message_file_objects" USING btree ("message_id","sort_order");--> statement-breakpoint
CREATE INDEX "message_file_objects_file_message_idx" ON "message_file_objects" USING btree ("file_id","message_id");