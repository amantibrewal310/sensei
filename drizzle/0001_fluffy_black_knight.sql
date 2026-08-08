CREATE TABLE "lesson_page" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"idx" integer NOT NULL,
	"page" jsonb NOT NULL,
	"board" jsonb NOT NULL,
	"beats" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_page_lesson_idx_key" UNIQUE("lesson_id","idx")
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"topic" text NOT NULL,
	"pages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_page" ADD CONSTRAINT "lesson_page_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_user_created_idx" ON "lesson" USING btree ("user_id","created_at");