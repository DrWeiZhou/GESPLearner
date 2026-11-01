CREATE TABLE `ai_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_chats_userId_questionId_unique` ON `ai_chats` (`user_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `answer_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`attempt_id` text,
	`answer` text NOT NULL,
	`is_correct` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `answer_records_user_question_idx` ON `answer_records` (`user_id`,`question_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer NOT NULL,
	`submitted_at` integer,
	`score` real,
	`max_score` real,
	`detail` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_user_started_idx` ON `attempts` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `coin_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`attempt_id` text,
	`question_id` text,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `coin_tx_user_created_idx` ON `coin_transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `coin_tx_one_earn_per_attempt` ON `coin_transactions` (`attempt_id`) WHERE "coin_transactions"."type" = 'earn';--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_points` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`block` text NOT NULL,
	`name` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`level`) REFERENCES `syllabi`(`level`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_points_level_sort_idx` ON `knowledge_points` (`level`,`sort_order`);--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`language` text DEFAULT 'cpp' NOT NULL,
	`level` integer NOT NULL,
	`pdf_url` text,
	`duration_minutes` integer DEFAULT 120 NOT NULL,
	`status` text DEFAULT 'crawled' NOT NULL,
	`total_score` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "papers_level_range" CHECK("papers"."level" between 1 and 8)
);
--> statement-breakpoint
CREATE INDEX `papers_language_level_idx` ON `papers` (`language`,`level`);--> statement-breakpoint
CREATE UNIQUE INDEX `papers_examId_language_level_unique` ON `papers` (`exam_id`,`language`,`level`);--> statement-breakpoint
CREATE TABLE `question_keys` (
	`question_id` text PRIMARY KEY NOT NULL,
	`answer` text,
	`explanation` text,
	`reference_solution` text,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_knowledge` (
	`question_id` text PRIMARY KEY NOT NULL,
	`knowledge_point_id` text,
	`reason` text,
	`model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_point_id`) REFERENCES `knowledge_points`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `question_rewards` (
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`score` real NOT NULL,
	`rate` real NOT NULL,
	`coins` real NOT NULL,
	`attempt_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `question_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `question_rewards_user_created_idx` ON `question_rewards` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`type` text NOT NULL,
	`number` integer NOT NULL,
	`score` real NOT NULL,
	`stem` text DEFAULT '' NOT NULL,
	`options` text,
	`title` text,
	`time_limit_ms` integer,
	`memory_limit_mb` integer,
	`input_format` text,
	`output_format` text,
	`samples` text,
	`data_range` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`embedding` blob,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `questions_paper_sort_idx` ON `questions` (`paper_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `questions_paperId_type_number_unique` ON `questions` (`paper_id`,`type`,`number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_tokenHash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`attempt_id` text,
	`code` text NOT NULL,
	`language` text DEFAULT 'cpp' NOT NULL,
	`verdict` text NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`results` text,
	`compile_output` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `submissions_user_question_idx` ON `submissions` (`user_id`,`question_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `submissions_attempt_idx` ON `submissions` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `syllabi` (
	`level` integer PRIMARY KEY NOT NULL,
	`language` text DEFAULT 'cpp' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`pdf_url` text,
	`source_url` text,
	`pages` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "syllabi_level_range" CHECK("syllabi"."level" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` text NOT NULL,
	`idx` integer NOT NULL,
	`input` text NOT NULL,
	`expected_output` text NOT NULL,
	`is_sample` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_cases_questionId_idx_unique` ON `test_cases` (`question_id`,`idx`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'student' NOT NULL,
	`target_level` integer,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_key` ON `users` (lower("username"));