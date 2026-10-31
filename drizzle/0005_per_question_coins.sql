CREATE TABLE "question_rewards" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"score" numeric NOT NULL,
	"rate" numeric NOT NULL,
	"coins" numeric NOT NULL,
	"attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_rewards_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD COLUMN "question_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "coin_carry" numeric(6, 3) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "question_rewards" ADD CONSTRAINT "question_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_rewards" ADD CONSTRAINT "question_rewards_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_rewards" ADD CONSTRAINT "question_rewards_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_rewards_user_id_created_at_index" ON "question_rewards" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Same posture as 0002/0004: the app reaches Postgres directly as the table owner,
-- so RLS without policies keeps Supabase's public REST/GraphQL API out.
ALTER TABLE "question_rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Coins used to be redeemed per finished paper; they are now settled per question,
-- the first time each one is graded. Mark everything answered so far as settled and
-- worth nothing, so switching over doesn't retroactively pay for old work — and so
-- redoing an old question (typically from the wrong-answer book) earns nothing.
INSERT INTO "question_rewards" ("user_id", "question_id", "score", "rate", "coins", "created_at")
SELECT "user_id", "question_id", 0, 0, 0, min("created_at")
FROM "answer_records"
GROUP BY "user_id", "question_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "question_rewards" ("user_id", "question_id", "score", "rate", "coins", "created_at")
SELECT "user_id", "question_id", 0, 0, 0, min("created_at")
FROM "submissions"
GROUP BY "user_id", "question_id"
ON CONFLICT DO NOTHING;
