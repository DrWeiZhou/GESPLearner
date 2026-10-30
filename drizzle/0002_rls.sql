-- The app accesses Postgres only from the server through Drizzle (table owner role).
-- Enabling RLS without policies closes these tables to Supabase's public REST/GraphQL API
-- (anon / authenticated roles), so answer keys, test data and user records can't leak.
ALTER TABLE "exams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "papers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "test_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "answer_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_chats" ENABLE ROW LEVEL SECURITY;
