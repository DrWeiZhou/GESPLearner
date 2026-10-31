CREATE TABLE "knowledge_points" (
	"id" text PRIMARY KEY NOT NULL,
	"level" smallint NOT NULL,
	"block" text NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_knowledge" (
	"question_id" text PRIMARY KEY NOT NULL,
	"knowledge_point_id" text,
	"reason" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syllabi" (
	"level" smallint PRIMARY KEY NOT NULL,
	"language" text DEFAULT 'cpp' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"pdf_url" text,
	"source_url" text,
	"pages" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "syllabi_level_range" CHECK ("syllabi"."level" between 1 and 8)
);
--> statement-breakpoint
ALTER TABLE "knowledge_points" ADD CONSTRAINT "knowledge_points_level_syllabi_level_fk" FOREIGN KEY ("level") REFERENCES "public"."syllabi"("level") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_knowledge" ADD CONSTRAINT "question_knowledge_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_knowledge" ADD CONSTRAINT "question_knowledge_knowledge_point_id_knowledge_points_id_fk" FOREIGN KEY ("knowledge_point_id") REFERENCES "public"."knowledge_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_points_level_sort_order_index" ON "knowledge_points" USING btree ("level","sort_order");--> statement-breakpoint
-- Same posture as 0002/0004/0005: the app reaches Postgres directly as the table
-- owner, so RLS without policies keeps Supabase's public REST/GraphQL API out.
ALTER TABLE "syllabi" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_knowledge" ENABLE ROW LEVEL SECURITY;
