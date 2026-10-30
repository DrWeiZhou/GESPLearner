CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "coin_transactions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coin_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"attempt_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"role" text DEFAULT 'student' NOT NULL,
	"target_level" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_transactions_user_id_created_at_index" ON "coin_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_tx_one_earn_per_attempt" ON "coin_transactions" USING btree ("attempt_id") WHERE "coin_transactions"."type" = 'earn';--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree (lower("username"));--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_records" ADD CONSTRAINT "answer_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Same posture as 0002: the app reaches Postgres directly as the table owner, so
-- enabling RLS without policies keeps Supabase's public REST/GraphQL API (anon /
-- authenticated roles) from reading password hashes, session tokens or balances.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coin_transactions" ENABLE ROW LEVEL SECURITY;
