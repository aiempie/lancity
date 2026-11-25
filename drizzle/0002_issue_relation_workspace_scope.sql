CREATE UNIQUE INDEX `issues_id_workspace_id_unique` ON `issues` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_issue_relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`relation_type` text(20) DEFAULT 'blocked_by' NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`related_issue_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`workspace_id`) REFERENCES `issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_issue_id`,`workspace_id`) REFERENCES `issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_issue_relations`("id", "created_at", "updated_at", "created_by_id", "updated_by_id", "relation_type", "issue_id", "project_id", "related_issue_id", "workspace_id", "deleted_at") SELECT "id", "created_at", "updated_at", "created_by_id", "updated_by_id", "relation_type", "issue_id", "project_id", "related_issue_id", "workspace_id", "deleted_at" FROM `issue_relations`;--> statement-breakpoint
DROP TABLE `issue_relations`;--> statement-breakpoint
ALTER TABLE `__new_issue_relations` RENAME TO `issue_relations`;--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relations_issue_id_related_issue_id_deleted_at_unique` ON `issue_relations` (`issue_id`,`related_issue_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relation_unique_issue_related_issue_when_deleted_at_null` ON `issue_relations` (`issue_id`,`related_issue_id`) WHERE ("issue_relations"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_relations_created_by_id_idx` ON `issue_relations` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_issue_id_idx` ON `issue_relations` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_project_id_idx` ON `issue_relations` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_related_issue_id_idx` ON `issue_relations` (`related_issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_updated_by_id_idx` ON `issue_relations` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_workspace_id_idx` ON `issue_relations` (`workspace_id`);
