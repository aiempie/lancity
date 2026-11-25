CREATE TABLE `dashboard_widgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`dashboard_id` integer NOT NULL,
	`widget_id` integer NOT NULL,
	`deleted_at` integer,
	`is_visible` integer DEFAULT true NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`widget_id`) REFERENCES `widgets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_widgets_widget_dashboard_deleted_idx` ON `dashboard_widgets` (`widget_id`,`dashboard_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_widgets_live_idx` ON `dashboard_widgets` (`widget_id`,`dashboard_id`) WHERE "dashboard_widgets"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `dashboards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`identifier` text,
	`is_default` integer DEFAULT false NOT NULL,
	`type_identifier` text DEFAULT 'home' NOT NULL,
	`owned_by_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `widgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`key` text NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL
);
