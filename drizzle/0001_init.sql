CREATE TABLE "ai_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_chats_userId_questionId_unique" UNIQUE("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "answer_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "answer_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"attempt_id" uuid,
	"answer" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"paper_id" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" numeric,
	"max_score" numeric,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"language" text DEFAULT 'cpp' NOT NULL,
	"level" smallint NOT NULL,
	"pdf_url" text,
	"duration_minutes" integer DEFAULT 120 NOT NULL,
	"status" text DEFAULT 'crawled' NOT NULL,
	"total_score" numeric DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "papers_examId_language_level_unique" UNIQUE("exam_id","language","level"),
	CONSTRAINT "papers_level_range" CHECK ("papers"."level" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'student' NOT NULL,
	"target_level" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_keys" (
	"question_id" text PRIMARY KEY NOT NULL,
	"answer" text,
	"explanation" text,
	"reference_solution" text
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"type" text NOT NULL,
	"number" smallint NOT NULL,
	"score" numeric NOT NULL,
	"stem" text DEFAULT '' NOT NULL,
	"options" jsonb,
	"title" text,
	"time_limit_ms" integer,
	"memory_limit_mb" integer,
	"input_format" text,
	"output_format" text,
	"samples" jsonb,
	"data_range" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"embedding" vector(1024),
	CONSTRAINT "questions_paperId_type_number_unique" UNIQUE("paper_id","type","number")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"attempt_id" uuid,
	"code" text NOT NULL,
	"language" text DEFAULT 'cpp' NOT NULL,
	"verdict" text NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"results" jsonb,
	"compile_output" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_cases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"question_id" text NOT NULL,
	"idx" integer NOT NULL,
	"input" text NOT NULL,
	"expected_output" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "test_cases_questionId_idx_unique" UNIQUE("question_id","idx")
);
--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_records" ADD CONSTRAINT "answer_records_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_records" ADD CONSTRAINT "answer_records_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_keys" ADD CONSTRAINT "question_keys_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_records_user_id_question_id_created_at_index" ON "answer_records" USING btree ("user_id","question_id","created_at");--> statement-breakpoint
CREATE INDEX "attempts_user_id_started_at_index" ON "attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "papers_language_level_index" ON "papers" USING btree ("language","level");--> statement-breakpoint
CREATE INDEX "questions_paper_id_sort_order_index" ON "questions" USING btree ("paper_id","sort_order");--> statement-breakpoint
CREATE INDEX "questions_embedding_idx" ON "questions" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "submissions_user_id_question_id_created_at_index" ON "submissions" USING btree ("user_id","question_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_attempt_id_index" ON "submissions" USING btree ("attempt_id");