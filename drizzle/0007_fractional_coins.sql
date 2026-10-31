-- Coins are fractional now: a 2-point question at the default rate is worth 0.6 and
-- the student is credited exactly that. Whole-coin amounts meant most questions paid
-- nothing visible, with the remainder parked in users.coin_carry.
ALTER TABLE "coin_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
-- Hand back whatever was still being saved up, before the column goes away. Runs
-- after the type change so a fractional remainder can actually be stored.
INSERT INTO "coin_transactions" ("user_id", "amount", "type", "note")
SELECT "id", "coin_carry", 'reward', '零头并入余额（金币改为可带小数）'
FROM "users"
WHERE "coin_carry" > 0;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "coin_carry";
