CREATE TABLE `job_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text(255) NOT NULL,
	`owner` text(255),
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_claims_key_unique` ON `job_claims` (`key`);