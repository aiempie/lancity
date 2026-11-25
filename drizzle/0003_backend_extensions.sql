CREATE TABLE `auth_counters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text(255) NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_counters_key_key` ON `auth_counters` (`key`);--> statement-breakpoint
CREATE INDEX `auth_counters_expires_at_idx` ON `auth_counters` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_security` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`user_id` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`is_password_autoset` integer DEFAULT false NOT NULL,
	`last_login_medium` text(20),
	`last_login_time` integer,
	`last_login_ip` text,
	`last_login_uagent` text,
	`last_logout_time` integer,
	`last_logout_ip` text,
	`last_active` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_security_user_id_key` ON `user_security` (`user_id`);--> statement-breakpoint
CREATE TABLE `cache_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_key_unique` ON `cache_entries` (`key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text(255) NOT NULL,
	`hit_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_hits_key_hit_at_idx` ON `rate_limit_hits` (`key`,`hit_at`);--> statement-breakpoint
CREATE TABLE `cycle_progress_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`snapshot_date` text(10) NOT NULL,
	`total_issues` integer DEFAULT 0 NOT NULL,
	`completed_issues` integer DEFAULT 0 NOT NULL,
	`cancelled_issues` integer DEFAULT 0 NOT NULL,
	`started_issues` integer DEFAULT 0 NOT NULL,
	`unstarted_issues` integer DEFAULT 0 NOT NULL,
	`backlog_issues` integer DEFAULT 0 NOT NULL,
	`total_estimate_points` real DEFAULT 0 NOT NULL,
	`completed_estimate_points` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_progress_snapshots_cycle_id_snapshot_date_unique` ON `cycle_progress_snapshots` (`cycle_id`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `cycle_progress_snapshots_project_id_idx` ON `cycle_progress_snapshots` (`project_id`);--> statement-breakpoint
CREATE INDEX `cycle_progress_snapshots_workspace_id_idx` ON `cycle_progress_snapshots` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `notification_email_locks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text(255) NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_email_locks_key_unique` ON `notification_email_locks` (`key`);--> statement-breakpoint
CREATE INDEX `notification_email_locks_expires_at_idx` ON `notification_email_locks` (`expires_at`);--> statement-breakpoint
CREATE TABLE `analytic_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`workspace_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`email` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`status` text(20) DEFAULT 'queued' NOT NULL,
	`object_key` text,
	`error` text,
	`completed_at` integer,
	`emailed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytic_exports_status_values" CHECK("analytic_exports"."status" in ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "analytic_exports_params_json" CHECK(json_valid("analytic_exports"."params"))
);
--> statement-breakpoint
CREATE INDEX `analytic_exports_workspace_id_idx` ON `analytic_exports` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `analytic_exports_user_id_idx` ON `analytic_exports` (`user_id`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`workspace_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`initiated_by_id` integer NOT NULL,
	`source` text(20) DEFAULT 'file' NOT NULL,
	`format` text(10) NOT NULL,
	`status` text(50) DEFAULT 'queued' NOT NULL,
	`file_name` text(255) NOT NULL,
	`file_key` text DEFAULT '' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`processed_rows` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "import_jobs_source_values" CHECK("import_jobs"."source" in ('file', 'plane')),
	CONSTRAINT "import_jobs_format_values" CHECK("import_jobs"."format" in ('csv', 'json', 'xlsx')),
	CONSTRAINT "import_jobs_status_values" CHECK("import_jobs"."status" in ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "import_jobs_errors_json" CHECK(json_valid("import_jobs"."errors") and json_type("import_jobs"."errors") = 'array')
);
--> statement-breakpoint
CREATE INDEX `import_jobs_workspace_id_idx` ON `import_jobs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `import_jobs_project_id_idx` ON `import_jobs` (`project_id`);--> statement-breakpoint
CREATE INDEX `import_jobs_initiated_by_id_idx` ON `import_jobs` (`initiated_by_id`);--> statement-breakpoint
CREATE INDEX `import_jobs_created_by_id_idx` ON `import_jobs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `import_jobs_updated_by_id_idx` ON `import_jobs` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `instance_job_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`key` text(100) NOT NULL,
	`value` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_job_state_key_key` ON `instance_job_state` (`key`);--> statement-breakpoint
CREATE TABLE `maintenance_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text(100) NOT NULL,
	`status` text(20) DEFAULT 'running' NOT NULL,
	`actor_id` integer,
	`result` text,
	`error` text,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `maintenance_runs_task_started_at_idx` ON `maintenance_runs` (`task`,`started_at`);--> statement-breakpoint
-- Backfill: every existing user gets a security row (is_active = true).
INSERT OR IGNORE INTO `user_security` (`user_id`) SELECT `id` FROM `user`;
