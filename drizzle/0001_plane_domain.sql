CREATE TABLE `device_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`user_agent` text(255),
	`ip_address` text,
	`start_time` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`end_time` integer,
	`device_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `device_sessions_created_by_id_idx` ON `device_sessions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `device_sessions_device_id_idx` ON `device_sessions` (`device_id`);--> statement-breakpoint
CREATE INDEX `device_sessions_session_id_idx` ON `device_sessions` (`session_id`);--> statement-breakpoint
CREATE INDEX `device_sessions_updated_by_id_idx` ON `device_sessions` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`device_id` text(255),
	`device_type` text(255) NOT NULL,
	`push_token` text(255),
	`is_active` integer DEFAULT true NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "devices_device_type_values" CHECK("devices"."device_type" in ('ANDROID', 'IOS', 'WEB', 'DESKTOP'))
);
--> statement-breakpoint
CREATE INDEX `devices_created_by_id_idx` ON `devices` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `devices_updated_by_id_idx` ON `devices` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `devices_user_id_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`theme` text DEFAULT '{}' NOT NULL,
	`is_tour_completed` integer DEFAULT false NOT NULL,
	`onboarding_step` text DEFAULT '{}' NOT NULL,
	`use_case` text,
	`role` text(300),
	`is_onboarded` integer DEFAULT false NOT NULL,
	`last_workspace_id` integer,
	`billing_address_country` text(255) DEFAULT 'INDIA' NOT NULL,
	`billing_address` text,
	`has_billing_address` integer DEFAULT false NOT NULL,
	`company_name` text(255) DEFAULT '' NOT NULL,
	`user_id` integer NOT NULL,
	`is_mobile_onboarded` integer DEFAULT false NOT NULL,
	`mobile_onboarding_step` text DEFAULT '{}' NOT NULL,
	`mobile_timezone_auto_set` integer DEFAULT false NOT NULL,
	`language` text(255) DEFAULT 'en' NOT NULL,
	`is_smooth_cursor_enabled` integer DEFAULT false NOT NULL,
	`start_of_the_week` integer DEFAULT 0 NOT NULL,
	`is_app_rail_docked` integer DEFAULT true NOT NULL,
	`background_color` text(255) DEFAULT '#64748b' NOT NULL,
	`goals` text DEFAULT '{}' NOT NULL,
	`has_marketing_email_consent` integer DEFAULT false NOT NULL,
	`is_navigation_tour_completed` integer DEFAULT false NOT NULL,
	`is_subscribed_to_changelog` integer DEFAULT false NOT NULL,
	`notification_view_mode` text(255) DEFAULT 'full' NOT NULL,
	`product_tour` text DEFAULT '{}' NOT NULL,
	`first_name` text(255),
	`last_name` text(255),
	`mobile_number` text(255),
	`user_timezone` text(255),
	`cover_image` text(800),
	`avatar_asset_id` integer,
	`cover_image_asset_id` integer,
	FOREIGN KEY (`last_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`avatar_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_image_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "profiles_theme_json" CHECK(json_valid("profiles"."theme")),
	CONSTRAINT "profiles_onboarding_step_json" CHECK(json_valid("profiles"."onboarding_step")),
	CONSTRAINT "profiles_billing_address_json" CHECK(json_valid("profiles"."billing_address") or "profiles"."billing_address" is null),
	CONSTRAINT "profiles_mobile_onboarding_step_json" CHECK(json_valid("profiles"."mobile_onboarding_step")),
	CONSTRAINT "profiles_start_of_the_week_values" CHECK("profiles"."start_of_the_week" in (0, 1, 2, 3, 4, 5, 6)),
	CONSTRAINT "profiles_goals_json" CHECK(json_valid("profiles"."goals")),
	CONSTRAINT "profiles_notification_view_mode_values" CHECK("profiles"."notification_view_mode" in ('full', 'compact')),
	CONSTRAINT "profiles_product_tour_json" CHECK(json_valid("profiles"."product_tour")),
	CONSTRAINT "profiles_start_of_the_week_check" CHECK("profiles"."start_of_the_week" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_id_key` ON `profiles` (`user_id`);--> statement-breakpoint
CREATE INDEX `profiles_avatar_asset_id_idx` ON `profiles` (`avatar_asset_id`);--> statement-breakpoint
CREATE INDEX `profiles_cover_image_asset_id_idx` ON `profiles` (`cover_image_asset_id`);--> statement-breakpoint
CREATE INDEX `profiles_last_workspace_id_idx` ON `profiles` (`last_workspace_id`);--> statement-breakpoint
CREATE TABLE `social_login_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`medium` text(20) NOT NULL,
	`last_login_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
	`last_received_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)),
	`token_data` text,
	`extra_data` text,
	`user_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "social_login_connections_medium_values" CHECK("social_login_connections"."medium" in ('Google', 'Github', 'GitLab', 'Jira')),
	CONSTRAINT "social_login_connections_token_data_json" CHECK(json_valid("social_login_connections"."token_data") or "social_login_connections"."token_data" is null),
	CONSTRAINT "social_login_connections_extra_data_json" CHECK(json_valid("social_login_connections"."extra_data") or "social_login_connections"."extra_data" is null)
);
--> statement-breakpoint
CREATE INDEX `social_login_connections_created_by_id_idx` ON `social_login_connections` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `social_login_connections_updated_by_id_idx` ON `social_login_connections` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `social_login_connections_user_id_idx` ON `social_login_connections` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_identifiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(12) NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_identifier_project_id_key` ON `project_identifiers` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_identifiers_name_workspace_id_deleted_at_unique` ON `project_identifiers` (`name`,`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `project_identifiers_created_by_id_idx` ON `project_identifiers` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_identifiers_updated_by_id_idx` ON `project_identifiers` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_identifiers_workspace_id_idx` ON `project_identifiers` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `project_identifiers_name_idx` ON `project_identifiers` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_name_workspace_when_deleted_at_null` ON `project_identifiers` (`name`,`workspace_id`) WHERE ("project_identifiers"."deleted_at" IS NULL);--> statement-breakpoint
CREATE TABLE `project_member_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`email` text(255) NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	`token` text(255) NOT NULL,
	`message` text,
	`responded_at` integer,
	`role` integer DEFAULT 5 NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_member_invites_role_values" CHECK("project_member_invites"."role" in (20, 15, 5)),
	CONSTRAINT "project_member_invite_role_check" CHECK("project_member_invites"."role" >= 0)
);
--> statement-breakpoint
CREATE INDEX `project_member_invites_created_by_id_idx` ON `project_member_invites` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_member_invites_project_id_idx` ON `project_member_invites` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_member_invites_updated_by_id_idx` ON `project_member_invites` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_member_invites_workspace_id_idx` ON `project_member_invites` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`comment` text,
	`role` integer DEFAULT 5 NOT NULL,
	`member_id` integer,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`view_props` text DEFAULT '{}' NOT NULL,
	`default_props` text DEFAULT '{}' NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_members_role_values" CHECK("project_members"."role" in (20, 15, 5)),
	CONSTRAINT "project_members_view_props_json" CHECK(json_valid("project_members"."view_props")),
	CONSTRAINT "project_members_default_props_json" CHECK(json_valid("project_members"."default_props")),
	CONSTRAINT "project_members_preferences_json" CHECK(json_valid("project_members"."preferences")),
	CONSTRAINT "project_member_role_check" CHECK("project_members"."role" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_id_member_id_deleted_at_unique` ON `project_members` (`project_id`,`member_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `project_members_created_by_id_idx` ON `project_members` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_members_member_id_idx` ON `project_members` (`member_id`);--> statement-breakpoint
CREATE INDEX `project_members_project_id_idx` ON `project_members` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_member_unique_project_member_when_deleted_at_null` ON `project_members` (`project_id`,`member_id`) WHERE ("project_members"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `project_members_updated_by_id_idx` ON `project_members` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_members_workspace_id_idx` ON `project_members` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_user_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`display_properties` text DEFAULT '{}' NOT NULL,
	`display_filters` text DEFAULT '{}' NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	`rich_filters` text DEFAULT '{}' NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_user_properties_display_properties_json" CHECK(json_valid("project_user_properties"."display_properties")),
	CONSTRAINT "project_user_properties_display_filters_json" CHECK(json_valid("project_user_properties"."display_filters")),
	CONSTRAINT "project_user_properties_filters_json" CHECK(json_valid("project_user_properties"."filters")),
	CONSTRAINT "project_user_properties_rich_filters_json" CHECK(json_valid("project_user_properties"."rich_filters")),
	CONSTRAINT "project_user_properties_preferences_json" CHECK(json_valid("project_user_properties"."preferences"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_user_properties_user_id_project_id_deleted_at_unique` ON `project_user_properties` (`user_id`,`project_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `project_user_properties_created_by_id_idx` ON `project_user_properties` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_user_properties_project_id_idx` ON `project_user_properties` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_user_properties_updated_by_id_idx` ON `project_user_properties` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_user_properties_user_id_idx` ON `project_user_properties` (`user_id`);--> statement-breakpoint
CREATE INDEX `project_user_properties_workspace_id_idx` ON `project_user_properties` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_user_property_unique_user_project_when_deleted_at_null` ON `project_user_properties` (`user_id`,`project_id`) WHERE ("project_user_properties"."deleted_at" IS NULL);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`description_html` text,
	`network` integer DEFAULT 2 NOT NULL,
	`identifier` text(12) NOT NULL,
	`default_assignee_id` integer,
	`project_lead_id` integer,
	`workspace_id` integer NOT NULL,
	`description_text` text,
	`cycle_view` integer DEFAULT false NOT NULL,
	`module_view` integer DEFAULT false NOT NULL,
	`cover_image` text,
	`issue_views_view` integer DEFAULT false NOT NULL,
	`page_view` integer DEFAULT true NOT NULL,
	`estimate_id` integer,
	`emoji` text(255),
	`icon_prop` text,
	`archive_in` integer DEFAULT 0 NOT NULL,
	`close_in` integer DEFAULT 0 NOT NULL,
	`default_state_id` integer,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`archived_at` integer,
	`is_time_tracking_enabled` integer DEFAULT false NOT NULL,
	`is_issue_type_enabled` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`guest_view_all_features` integer DEFAULT false NOT NULL,
	`timezone` text(255) DEFAULT 'UTC' NOT NULL,
	`cover_image_asset_id` integer,
	`intake_view` integer DEFAULT false NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_lead_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_image_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_id`,`id`) REFERENCES `estimates`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_state_id`,`id`) REFERENCES `states`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_description_html_json" CHECK(json_valid("projects"."description_html") or "projects"."description_html" is null),
	CONSTRAINT "projects_network_values" CHECK("projects"."network" in (0, 2)),
	CONSTRAINT "projects_description_text_json" CHECK(json_valid("projects"."description_text") or "projects"."description_text" is null),
	CONSTRAINT "projects_icon_prop_json" CHECK(json_valid("projects"."icon_prop") or "projects"."icon_prop" is null),
	CONSTRAINT "projects_logo_props_json" CHECK(json_valid("projects"."logo_props")),
	CONSTRAINT "project_network_check" CHECK("projects"."network" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_identifier_workspace_id_deleted_at_unique` ON `projects` (`identifier`,`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_workspace_id_deleted_at_unique` ON `projects` (`name`,`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_id_workspace_id_unique` ON `projects` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `projects_created_by_id_idx` ON `projects` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `projects_default_assignee_id_idx` ON `projects` (`default_assignee_id`);--> statement-breakpoint
CREATE INDEX `projects_project_lead_id_idx` ON `projects` (`project_lead_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_unique_identifier_workspace_when_deleted_at_null` ON `projects` (`identifier`,`workspace_id`) WHERE ("projects"."deleted_at" IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX `project_unique_name_workspace_when_deleted_at_null` ON `projects` (`name`,`workspace_id`) WHERE ("projects"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `projects_updated_by_id_idx` ON `projects` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `projects_workspace_id_idx` ON `projects` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `projects_cover_image_asset_id_idx` ON `projects` (`cover_image_asset_id`);--> statement-breakpoint
CREATE INDEX `projects_default_state_id_idx` ON `projects` (`default_state_id`);--> statement-breakpoint
CREATE INDEX `projects_estimate_id_idx` ON `projects` (`estimate_id`);--> statement-breakpoint
CREATE INDEX `projects_identifier_idx` ON `projects` (`identifier`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`workspace_id` integer NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "teams_logo_props_json" CHECK(json_valid("teams"."logo_props"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_name_workspace_id_deleted_at_unique` ON `teams` (`name`,`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `teams_created_by_id_idx` ON `teams` (`created_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_unique_name_workspace_when_deleted_at_null` ON `teams` (`name`,`workspace_id`) WHERE ("teams"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `teams_updated_by_id_idx` ON `teams` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `teams_workspace_id_idx` ON `teams` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_home_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`key` text(255) NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_home_preferences_config_json" CHECK(json_valid("workspace_home_preferences"."config"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_home_preferences_workspace_id_user_id_key_deleted_at_unique` ON `workspace_home_preferences` (`workspace_id`,`user_id`,`key`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `workspace_home_preferences_created_by_id_idx` ON `workspace_home_preferences` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_home_preferences_updated_by_id_idx` ON `workspace_home_preferences` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_home_preferences_user_id_idx` ON `workspace_home_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `workspace_home_preferences_workspace_id_idx` ON `workspace_home_preferences` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_user_home_preferences_unique_workspace_user_key_when_` ON `workspace_home_preferences` (`workspace_id`,`user_id`,`key`) WHERE ("workspace_home_preferences"."deleted_at" IS NULL);--> statement-breakpoint
CREATE TABLE `workspace_member_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`email` text(255) NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	`token` text(255) NOT NULL,
	`message` text,
	`responded_at` integer,
	`role` integer DEFAULT 5 NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_member_invites_role_values" CHECK("workspace_member_invites"."role" in (20, 15, 5)),
	CONSTRAINT "workspace_member_invite_role_check" CHECK("workspace_member_invites"."role" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_member_invites_email_workspace_id_deleted_at_unique` ON `workspace_member_invites` (`email`,`workspace_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `workspace_member_invites_created_by_id_idx` ON `workspace_member_invites` (`created_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_member_invite_unique_email_workspace_when_deleted_at_` ON `workspace_member_invites` (`email`,`workspace_id`) WHERE ("workspace_member_invites"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `workspace_member_invites_updated_by_id_idx` ON `workspace_member_invites` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_member_invites_workspace_id_idx` ON `workspace_member_invites` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`role` integer DEFAULT 5 NOT NULL,
	`member_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`company_role` text,
	`view_props` text DEFAULT '{}' NOT NULL,
	`default_props` text DEFAULT '{}' NOT NULL,
	`issue_props` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`explored_features` text DEFAULT '{}' NOT NULL,
	`getting_started_checklist` text DEFAULT '{}' NOT NULL,
	`tips` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_members_role_values" CHECK("workspace_members"."role" in (20, 15, 5)),
	CONSTRAINT "workspace_members_view_props_json" CHECK(json_valid("workspace_members"."view_props")),
	CONSTRAINT "workspace_members_default_props_json" CHECK(json_valid("workspace_members"."default_props")),
	CONSTRAINT "workspace_members_issue_props_json" CHECK(json_valid("workspace_members"."issue_props")),
	CONSTRAINT "workspace_members_explored_features_json" CHECK(json_valid("workspace_members"."explored_features")),
	CONSTRAINT "workspace_members_getting_started_checklist_json" CHECK(json_valid("workspace_members"."getting_started_checklist")),
	CONSTRAINT "workspace_members_tips_json" CHECK(json_valid("workspace_members"."tips")),
	CONSTRAINT "workspace_member_role_check" CHECK("workspace_members"."role" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_workspace_id_member_id_deleted_at_unique` ON `workspace_members` (`workspace_id`,`member_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `workspace_members_created_by_id_idx` ON `workspace_members` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_members_member_id_idx` ON `workspace_members` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_member_unique_workspace_member_when_deleted_at_null` ON `workspace_members` (`workspace_id`,`member_id`) WHERE ("workspace_members"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `workspace_members_updated_by_id_idx` ON `workspace_members` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_members_workspace_id_idx` ON `workspace_members` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_themes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(300) NOT NULL,
	`colors` text DEFAULT '{}' NOT NULL,
	`actor_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_themes_colors_json" CHECK(json_valid("workspace_themes"."colors"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_themes_workspace_id_name_deleted_at_unique` ON `workspace_themes` (`workspace_id`,`name`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_theme_unique_workspace_name_when_deleted_at_null` ON `workspace_themes` (`workspace_id`,`name`) WHERE ("workspace_themes"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `workspace_themes_actor_id_idx` ON `workspace_themes` (`actor_id`);--> statement-breakpoint
CREATE INDEX `workspace_themes_created_by_id_idx` ON `workspace_themes` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_themes_updated_by_id_idx` ON `workspace_themes` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_themes_workspace_id_idx` ON `workspace_themes` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_user_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`title` text(255),
	`url` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`owner_id` integer NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_user_links_metadata_json" CHECK(json_valid("workspace_user_links"."metadata"))
);
--> statement-breakpoint
CREATE INDEX `workspace_user_links_created_by_id_idx` ON `workspace_user_links` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_links_owner_id_idx` ON `workspace_user_links` (`owner_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_links_project_id_idx` ON `workspace_user_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_links_updated_by_id_idx` ON `workspace_user_links` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_links_workspace_id_idx` ON `workspace_user_links` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_user_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`key` text(255) NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_user_preferences_workspace_id_user_id_key_deleted_at_unique` ON `workspace_user_preferences` (`workspace_id`,`user_id`,`key`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `workspace_user_preferences_created_by_id_idx` ON `workspace_user_preferences` (`created_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_user_preferences_unique_workspace_user_key_when_delet` ON `workspace_user_preferences` (`workspace_id`,`user_id`,`key`) WHERE ("workspace_user_preferences"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `workspace_user_preferences_updated_by_id_idx` ON `workspace_user_preferences` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_preferences_user_id_idx` ON `workspace_user_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_preferences_workspace_id_idx` ON `workspace_user_preferences` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_user_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`filters` text DEFAULT '{}' NOT NULL,
	`display_filters` text DEFAULT '{}' NOT NULL,
	`display_properties` text DEFAULT '{}' NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`rich_filters` text DEFAULT '{}' NOT NULL,
	`navigation_control_preference` text(25) DEFAULT 'ACCORDION' NOT NULL,
	`navigation_project_limit` integer DEFAULT 10 NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_user_properties_filters_json" CHECK(json_valid("workspace_user_properties"."filters")),
	CONSTRAINT "workspace_user_properties_display_filters_json" CHECK(json_valid("workspace_user_properties"."display_filters")),
	CONSTRAINT "workspace_user_properties_display_properties_json" CHECK(json_valid("workspace_user_properties"."display_properties")),
	CONSTRAINT "workspace_user_properties_rich_filters_json" CHECK(json_valid("workspace_user_properties"."rich_filters")),
	CONSTRAINT "workspace_user_properties_navigation_control_preference_values" CHECK("workspace_user_properties"."navigation_control_preference" in ('ACCORDION', 'TABBED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_user_properties_workspace_id_user_id_deleted_at_unique` ON `workspace_user_properties` (`workspace_id`,`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `workspace_user_properties_created_by_id_idx` ON `workspace_user_properties` (`created_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_user_properties_unique_workspace_user_when_deleted_at` ON `workspace_user_properties` (`workspace_id`,`user_id`) WHERE ("workspace_user_properties"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `workspace_user_properties_updated_by_id_idx` ON `workspace_user_properties` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_properties_user_id_idx` ON `workspace_user_properties` (`user_id`);--> statement-breakpoint
CREATE INDEX `workspace_user_properties_workspace_id_idx` ON `workspace_user_properties` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(80) NOT NULL,
	`logo` text,
	`slug` text(48) NOT NULL,
	`owner_id` integer NOT NULL,
	`organization_size` text(20),
	`deleted_at` integer,
	`logo_asset_id` integer,
	`timezone` text(255) DEFAULT 'UTC' NOT NULL,
	`background_color` text(255) DEFAULT '#64748b' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`logo_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_slug_key` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE INDEX `workspaces_created_by_id_idx` ON `workspaces` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `workspaces_owner_id_idx` ON `workspaces` (`owner_id`);--> statement-breakpoint
CREATE INDEX `workspaces_updated_by_id_idx` ON `workspaces` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspaces_logo_asset_id_idx` ON `workspaces` (`logo_asset_id`);--> statement-breakpoint
CREATE TABLE `comment_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`reaction` text NOT NULL,
	`actor_id` integer NOT NULL,
	`comment_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`,`project_id`) REFERENCES `issue_comments`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_reactions_comment_id_actor_id_reaction_deleted_at_unique` ON `comment_reactions` (`comment_id`,`actor_id`,`reaction`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `comment_reaction_unique_comment_actor_reaction_when_deleted_at_` ON `comment_reactions` (`comment_id`,`actor_id`,`reaction`) WHERE ("comment_reactions"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `comment_reactions_actor_id_idx` ON `comment_reactions` (`actor_id`);--> statement-breakpoint
CREATE INDEX `comment_reactions_comment_id_idx` ON `comment_reactions` (`comment_id`);--> statement-breakpoint
CREATE INDEX `comment_reactions_created_by_id_idx` ON `comment_reactions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `comment_reactions_project_id_idx` ON `comment_reactions` (`project_id`);--> statement-breakpoint
CREATE INDEX `comment_reactions_updated_by_id_idx` ON `comment_reactions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `comment_reactions_workspace_id_idx` ON `comment_reactions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`verb` text(255) DEFAULT 'created' NOT NULL,
	`field` text(255),
	`old_value` text,
	`new_value` text,
	`comment` text DEFAULT '' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`issue_id` integer,
	`issue_comment_id` integer,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`actor_id` integer,
	`new_identifier` integer,
	`old_identifier` integer,
	`epoch` real,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_comment_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_comment_id`,`project_id`) REFERENCES `issue_comments`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_activities_attachments_json" CHECK(json_valid("issue_activities"."attachments") and json_type("issue_activities"."attachments") = 'array' and json_type("issue_activities"."attachments") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_activities_id_project_id_unique` ON `issue_activities` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_actor_id_idx` ON `issue_activities` (`actor_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_created_by_id_idx` ON `issue_activities` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_issue_comment_id_idx` ON `issue_activities` (`issue_comment_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_issue_id_idx` ON `issue_activities` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_project_id_idx` ON `issue_activities` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_updated_by_id_idx` ON `issue_activities` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_activities_workspace_id_idx` ON `issue_activities` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_assignees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`assignee_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_assignees_issue_id_assignee_id_deleted_at_unique` ON `issue_assignees` (`issue_id`,`assignee_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `issue_assignees_assignee_id_idx` ON `issue_assignees` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `issue_assignees_created_by_id_idx` ON `issue_assignees` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_assignees_issue_id_idx` ON `issue_assignees` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_assignees_project_id_idx` ON `issue_assignees` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_assignee_unique_issue_assignee_when_deleted_at_null` ON `issue_assignees` (`issue_id`,`assignee_id`) WHERE ("issue_assignees"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_assignees_updated_by_id_idx` ON `issue_assignees` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_assignees_workspace_id_idx` ON `issue_assignees` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`attributes` text DEFAULT '{}' NOT NULL,
	`asset` text(100) NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_attachments_attributes_json" CHECK(json_valid("issue_attachments"."attributes"))
);
--> statement-breakpoint
CREATE INDEX `issue_attachments_created_by_id_idx` ON `issue_attachments` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_attachments_issue_id_idx` ON `issue_attachments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_attachments_project_id_idx` ON `issue_attachments` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_attachments_updated_by_id_idx` ON `issue_attachments` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_attachments_workspace_id_idx` ON `issue_attachments` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_blockers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`block_id` integer NOT NULL,
	`blocked_by_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`block_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_by_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_by_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_blockers_block_id_idx` ON `issue_blockers` (`block_id`);--> statement-breakpoint
CREATE INDEX `issue_blockers_blocked_by_id_idx` ON `issue_blockers` (`blocked_by_id`);--> statement-breakpoint
CREATE INDEX `issue_blockers_created_by_id_idx` ON `issue_blockers` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_blockers_project_id_idx` ON `issue_blockers` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_blockers_updated_by_id_idx` ON `issue_blockers` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_blockers_workspace_id_idx` ON `issue_blockers` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`attachments` text DEFAULT '[]' NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`actor_id` integer,
	`comment_stripped` text DEFAULT '' NOT NULL,
	`comment_html` text DEFAULT '<p></p>' NOT NULL,
	`comment_json` text DEFAULT '{}' NOT NULL,
	`access` text(100) DEFAULT 'INTERNAL' NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`deleted_at` integer,
	`edited_at` integer,
	`description_id` integer,
	`parent_id` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`description_id`) REFERENCES `descriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`description_id`,`workspace_id`) REFERENCES `descriptions`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`,`project_id`) REFERENCES `issue_comments`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_comments_attachments_json" CHECK(json_valid("issue_comments"."attachments") and json_type("issue_comments"."attachments") = 'array' and json_type("issue_comments"."attachments") = 'array'),
	CONSTRAINT "issue_comments_comment_json_json" CHECK(json_valid("issue_comments"."comment_json")),
	CONSTRAINT "issue_comments_access_values" CHECK("issue_comments"."access" in ('INTERNAL', 'EXTERNAL'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_comments_description_id_key` ON `issue_comments` (`description_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_comments_id_project_id_unique` ON `issue_comments` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_actor_id_idx` ON `issue_comments` (`actor_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_created_by_id_idx` ON `issue_comments` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_issue_id_idx` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_project_id_idx` ON `issue_comments` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_updated_by_id_idx` ON `issue_comments` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_workspace_id_idx` ON `issue_comments` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_parent_id_idx` ON `issue_comments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `issue_description_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`description_binary` blob,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_stripped` text,
	`description_json` text DEFAULT '{}' NOT NULL,
	`last_saved_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`issue_id` integer NOT NULL,
	`owned_by_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_description_versions_description_json_json" CHECK(json_valid("issue_description_versions"."description_json"))
);
--> statement-breakpoint
CREATE INDEX `issue_description_versions_created_by_id_idx` ON `issue_description_versions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_description_versions_issue_id_idx` ON `issue_description_versions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_description_versions_owned_by_id_idx` ON `issue_description_versions` (`owned_by_id`);--> statement-breakpoint
CREATE INDEX `issue_description_versions_project_id_idx` ON `issue_description_versions` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_description_versions_updated_by_id_idx` ON `issue_description_versions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_description_versions_workspace_id_idx` ON `issue_description_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`issue_id` integer NOT NULL,
	`label_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_id`,`workspace_id`) REFERENCES `labels`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_labels_created_by_id_idx` ON `issue_labels` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_labels_issue_id_idx` ON `issue_labels` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_labels_label_id_idx` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE INDEX `issue_labels_project_id_idx` ON `issue_labels` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_labels_updated_by_id_idx` ON `issue_labels` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_labels_workspace_id_idx` ON `issue_labels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`title` text(255),
	`url` text NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_links_metadata_json" CHECK(json_valid("issue_links"."metadata"))
);
--> statement-breakpoint
CREATE INDEX `issue_links_created_by_id_idx` ON `issue_links` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_links_issue_id_idx` ON `issue_links` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_links_project_id_idx` ON `issue_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_links_updated_by_id_idx` ON `issue_links` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_links_workspace_id_idx` ON `issue_links` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_mentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`issue_id` integer NOT NULL,
	`mention_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mention_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_mentions_issue_id_mention_id_deleted_at_unique` ON `issue_mentions` (`issue_id`,`mention_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_mention_unique_issue_mention_when_deleted_at_null` ON `issue_mentions` (`issue_id`,`mention_id`) WHERE ("issue_mentions"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_mentions_created_by_id_idx` ON `issue_mentions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_mentions_issue_id_idx` ON `issue_mentions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_mentions_mention_id_idx` ON `issue_mentions` (`mention_id`);--> statement-breakpoint
CREATE INDEX `issue_mentions_project_id_idx` ON `issue_mentions` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_mentions_updated_by_id_idx` ON `issue_mentions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_mentions_workspace_id_idx` ON `issue_mentions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`reaction` text NOT NULL,
	`actor_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_reactions_issue_id_actor_id_reaction_deleted_at_unique` ON `issue_reactions` (`issue_id`,`actor_id`,`reaction`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_reaction_unique_issue_actor_reaction_when_deleted_at_null` ON `issue_reactions` (`issue_id`,`actor_id`,`reaction`) WHERE ("issue_reactions"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_reactions_actor_id_idx` ON `issue_reactions` (`actor_id`);--> statement-breakpoint
CREATE INDEX `issue_reactions_created_by_id_idx` ON `issue_reactions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_reactions_issue_id_idx` ON `issue_reactions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_reactions_project_id_idx` ON `issue_reactions` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_reactions_updated_by_id_idx` ON `issue_reactions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_reactions_workspace_id_idx` ON `issue_reactions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_relations` (
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
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relations_issue_id_related_issue_id_deleted_at_unique` ON `issue_relations` (`issue_id`,`related_issue_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_relation_unique_issue_related_issue_when_deleted_at_null` ON `issue_relations` (`issue_id`,`related_issue_id`) WHERE ("issue_relations"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_relations_created_by_id_idx` ON `issue_relations` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_issue_id_idx` ON `issue_relations` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_project_id_idx` ON `issue_relations` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_related_issue_id_idx` ON `issue_relations` (`related_issue_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_updated_by_id_idx` ON `issue_relations` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_relations_workspace_id_idx` ON `issue_relations` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`sequence` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`issue_id` integer,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_sequence_sequence_check" CHECK("issue_sequences"."sequence" >= 0),
	CONSTRAINT "issue_sequences_sequence_positive" CHECK("issue_sequences"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_sequences_project_sequence_unique` ON `issue_sequences` (`project_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_sequences_issue_unique` ON `issue_sequences` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_sequences_created_by_id_idx` ON `issue_sequences` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_sequences_project_id_idx` ON `issue_sequences` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_sequences_updated_by_id_idx` ON `issue_sequences` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_sequences_workspace_id_idx` ON `issue_sequences` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `issue_sequences_sequence_idx` ON `issue_sequences` (`sequence`);--> statement-breakpoint
CREATE TABLE `issue_subscribers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`subscriber_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscriber_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_subscribers_issue_id_subscriber_id_deleted_at_unique` ON `issue_subscribers` (`issue_id`,`subscriber_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_subscriber_unique_issue_subscriber_when_deleted_at_null` ON `issue_subscribers` (`issue_id`,`subscriber_id`) WHERE ("issue_subscribers"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_subscribers_created_by_id_idx` ON `issue_subscribers` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_subscribers_issue_id_idx` ON `issue_subscribers` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_subscribers_project_id_idx` ON `issue_subscribers` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_subscribers_subscriber_id_idx` ON `issue_subscribers` (`subscriber_id`);--> statement-breakpoint
CREATE INDEX `issue_subscribers_updated_by_id_idx` ON `issue_subscribers` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_subscribers_workspace_id_idx` ON `issue_subscribers` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`parent` integer,
	`state` integer,
	`estimate_point` integer,
	`name` text(255) NOT NULL,
	`priority` text(30) DEFAULT 'none' NOT NULL,
	`start_date` text,
	`target_date` text,
	`sequence_id` integer DEFAULT 1 NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`completed_at` integer,
	`archived_at` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`external_source` text(255),
	`external_id` text(255),
	`type` integer,
	`last_saved_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`owned_by_id` integer NOT NULL,
	`assignees` text DEFAULT '[]' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`cycle` integer,
	`modules` text DEFAULT '[]' NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`activity_id` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `issue_activities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`activity_id`,`project_id`) REFERENCES `issue_activities`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_versions_priority_values" CHECK("issue_versions"."priority" in ('urgent', 'high', 'medium', 'low', 'none')),
	CONSTRAINT "issue_versions_assignees_json" CHECK(json_valid("issue_versions"."assignees") and json_type("issue_versions"."assignees") = 'array'),
	CONSTRAINT "issue_versions_labels_json" CHECK(json_valid("issue_versions"."labels") and json_type("issue_versions"."labels") = 'array'),
	CONSTRAINT "issue_versions_modules_json" CHECK(json_valid("issue_versions"."modules") and json_type("issue_versions"."modules") = 'array'),
	CONSTRAINT "issue_versions_properties_json" CHECK(json_valid("issue_versions"."properties")),
	CONSTRAINT "issue_versions_meta_json" CHECK(json_valid("issue_versions"."meta"))
);
--> statement-breakpoint
CREATE INDEX `issue_versions_activity_id_idx` ON `issue_versions` (`activity_id`);--> statement-breakpoint
CREATE INDEX `issue_versions_created_by_id_idx` ON `issue_versions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_versions_issue_id_idx` ON `issue_versions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_versions_owned_by_id_idx` ON `issue_versions` (`owned_by_id`);--> statement-breakpoint
CREATE INDEX `issue_versions_project_id_idx` ON `issue_versions` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_versions_updated_by_id_idx` ON `issue_versions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_versions_workspace_id_idx` ON `issue_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issue_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`vote` integer DEFAULT 1 NOT NULL,
	`actor_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_votes_vote_values" CHECK("issue_votes"."vote" in (-1, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_votes_issue_id_actor_id_deleted_at_unique` ON `issue_votes` (`issue_id`,`actor_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_vote_unique_issue_actor_when_deleted_at_null` ON `issue_votes` (`issue_id`,`actor_id`) WHERE ("issue_votes"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `issue_votes_actor_id_idx` ON `issue_votes` (`actor_id`);--> statement-breakpoint
CREATE INDEX `issue_votes_created_by_id_idx` ON `issue_votes` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_votes_issue_id_idx` ON `issue_votes` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_votes_project_id_idx` ON `issue_votes` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_votes_updated_by_id_idx` ON `issue_votes` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_votes_workspace_id_idx` ON `issue_votes` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`priority` text(30) DEFAULT 'none' NOT NULL,
	`start_date` text,
	`target_date` text,
	`sequence_id` integer NOT NULL,
	`parent_id` integer,
	`project_id` integer NOT NULL,
	`state_id` integer,
	`workspace_id` integer NOT NULL,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_stripped` text,
	`completed_at` integer,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`archived_at` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`description_binary` blob,
	`point` integer,
	`estimate_point_id` integer,
	`type_id` integer,
	`deleted_at` integer,
	`description_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_point_id`) REFERENCES `estimate_points`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`type_id`) REFERENCES `issue_types`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`state_id`,`project_id`) REFERENCES `states`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`estimate_point_id`,`project_id`) REFERENCES `estimate_points`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`,`workspace_id`) REFERENCES `issue_types`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issues_priority_values" CHECK("issues"."priority" in ('urgent', 'high', 'medium', 'low', 'none')),
	CONSTRAINT "issues_description_json_json" CHECK(json_valid("issues"."description_json")),
	CONSTRAINT "issues_sequence_id_positive" CHECK("issues"."sequence_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_project_sequence_unique` ON `issues` (`project_id`,`sequence_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_id_project_id_unique` ON `issues` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `issues_created_by_id_idx` ON `issues` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issues_parent_id_idx` ON `issues` (`parent_id`);--> statement-breakpoint
CREATE INDEX `issues_project_id_idx` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `issues_state_id_idx` ON `issues` (`state_id`);--> statement-breakpoint
CREATE INDEX `issues_updated_by_id_idx` ON `issues` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issues_workspace_id_idx` ON `issues` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `issues_estimate_point_id_idx` ON `issues` (`estimate_point_id`);--> statement-breakpoint
CREATE INDEX `issues_type_id_idx` ON `issues` (`type_id`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	`parent_id` integer,
	`color` text(255) DEFAULT '' NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`,`workspace_id`) REFERENCES `labels`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_id_workspace_id_unique` ON `labels` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `labels_created_by_id_idx` ON `labels` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `labels_parent_id_idx` ON `labels` (`parent_id`);--> statement-breakpoint
CREATE INDEX `labels_project_id_idx` ON `labels` (`project_id`);--> statement-breakpoint
CREATE INDEX `labels_updated_by_id_idx` ON `labels` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `labels_workspace_id_idx` ON `labels` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `labels_workspace_name_live_unique` ON `labels` (`workspace_id`,`name`) WHERE (("labels"."deleted_at" IS NULL) AND ("labels"."project_id" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX `unique_project_name_when_not_deleted` ON `labels` (`project_id`,`name`) WHERE (("labels"."deleted_at" IS NULL) AND ("labels"."project_id" IS NOT NULL));--> statement-breakpoint
CREATE TABLE `project_issue_counters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_issue_counters_last_sequence_check" CHECK("project_issue_counters"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_issue_counters_project_unique` ON `project_issue_counters` (`project_id`);--> statement-breakpoint
CREATE TABLE `states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text(255) NOT NULL,
	`slug` text(100) NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`sequence` real DEFAULT 65535 NOT NULL,
	`group` text(20) DEFAULT 'backlog' NOT NULL,
	`default` integer DEFAULT false NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`is_triage` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "states_group_values" CHECK("states"."group" in ('backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `states_name_project_id_deleted_at_unique` ON `states` (`name`,`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `states_id_project_id_unique` ON `states` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `states_created_by_id_idx` ON `states` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `states_project_id_idx` ON `states` (`project_id`);--> statement-breakpoint
CREATE INDEX `states_slug_idx` ON `states` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `state_unique_name_project_when_deleted_at_null` ON `states` (`name`,`project_id`) WHERE ("states"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `states_updated_by_id_idx` ON `states` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `states_workspace_id_idx` ON `states` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `cycle_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`cycle_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`,`project_id`) REFERENCES `cycles`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_issues_issue_id_cycle_id_deleted_at_unique` ON `cycle_issues` (`issue_id`,`cycle_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cycle_issues_created_by_id_idx` ON `cycle_issues` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `cycle_issues_cycle_id_idx` ON `cycle_issues` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `cycle_issues_project_id_idx` ON `cycle_issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `cycle_issues_updated_by_id_idx` ON `cycle_issues` (`updated_by_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_issue_when_deleted_at_null` ON `cycle_issues` (`cycle_id`,`issue_id`) WHERE ("cycle_issues"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `cycle_issues_workspace_id_idx` ON `cycle_issues` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `cycle_issues_issue_id_idx` ON `cycle_issues` (`issue_id`);--> statement-breakpoint
CREATE TABLE `cycle_user_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`filters` text DEFAULT '{}' NOT NULL,
	`display_filters` text DEFAULT '{}' NOT NULL,
	`display_properties` text DEFAULT '{}' NOT NULL,
	`cycle_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`rich_filters` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`,`project_id`) REFERENCES `cycles`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_user_properties_filters_json" CHECK(json_valid("cycle_user_properties"."filters")),
	CONSTRAINT "cycle_user_properties_display_filters_json" CHECK(json_valid("cycle_user_properties"."display_filters")),
	CONSTRAINT "cycle_user_properties_display_properties_json" CHECK(json_valid("cycle_user_properties"."display_properties")),
	CONSTRAINT "cycle_user_properties_rich_filters_json" CHECK(json_valid("cycle_user_properties"."rich_filters"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_user_properties_cycle_id_user_id_deleted_at_unique` ON `cycle_user_properties` (`cycle_id`,`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `cycle_user_properties_created_by_id_idx` ON `cycle_user_properties` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `cycle_user_properties_cycle_id_idx` ON `cycle_user_properties` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `cycle_user_properties_project_id_idx` ON `cycle_user_properties` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cycle_user_properties_unique_cycle_user_when_deleted_at_null` ON `cycle_user_properties` (`cycle_id`,`user_id`) WHERE ("cycle_user_properties"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `cycle_user_properties_updated_by_id_idx` ON `cycle_user_properties` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `cycle_user_properties_user_id_idx` ON `cycle_user_properties` (`user_id`);--> statement-breakpoint
CREATE INDEX `cycle_user_properties_workspace_id_idx` ON `cycle_user_properties` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`start_date` integer,
	`end_date` integer,
	`owned_by_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`view_props` text DEFAULT '{}' NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`progress_snapshot` text DEFAULT '{}' NOT NULL,
	`archived_at` integer,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	`timezone` text(255) DEFAULT 'UTC' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycles_view_props_json" CHECK(json_valid("cycles"."view_props")),
	CONSTRAINT "cycles_progress_snapshot_json" CHECK(json_valid("cycles"."progress_snapshot")),
	CONSTRAINT "cycles_logo_props_json" CHECK(json_valid("cycles"."logo_props"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cycles_id_project_id_unique` ON `cycles` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `cycles_created_by_id_idx` ON `cycles` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `cycles_owned_by_id_idx` ON `cycles` (`owned_by_id`);--> statement-breakpoint
CREATE INDEX `cycles_project_id_idx` ON `cycles` (`project_id`);--> statement-breakpoint
CREATE INDEX `cycles_updated_by_id_idx` ON `cycles` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `cycles_workspace_id_idx` ON `cycles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `draft_issue_assignees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`assignee_id` integer NOT NULL,
	`draft_issue_id` integer NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_issue_id`) REFERENCES `draft_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_issue_id`,`workspace_id`) REFERENCES `draft_issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_issue_assignees_draft_issue_id_assignee_id_deleted_at_unique` ON `draft_issue_assignees` (`draft_issue_id`,`assignee_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_issue_assignee_unique_issue_assignee_when_deleted_at_null` ON `draft_issue_assignees` (`draft_issue_id`,`assignee_id`) WHERE ("draft_issue_assignees"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `draft_issue_assignees_assignee_id_idx` ON `draft_issue_assignees` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_assignees_created_by_id_idx` ON `draft_issue_assignees` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_assignees_draft_issue_id_idx` ON `draft_issue_assignees` (`draft_issue_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_assignees_project_id_idx` ON `draft_issue_assignees` (`project_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_assignees_updated_by_id_idx` ON `draft_issue_assignees` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_assignees_workspace_id_idx` ON `draft_issue_assignees` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `draft_issue_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`cycle_id` integer NOT NULL,
	`draft_issue_id` integer NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_issue_id`) REFERENCES `draft_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`,`project_id`) REFERENCES `cycles`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_issue_id`,`workspace_id`) REFERENCES `draft_issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_issue_cycles_draft_issue_id_cycle_id_deleted_at_unique` ON `draft_issue_cycles` (`draft_issue_id`,`cycle_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_issue_cycle_when_deleted_at_null` ON `draft_issue_cycles` (`draft_issue_id`,`cycle_id`) WHERE ("draft_issue_cycles"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `draft_issue_cycles_created_by_id_idx` ON `draft_issue_cycles` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_cycles_cycle_id_idx` ON `draft_issue_cycles` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_cycles_draft_issue_id_idx` ON `draft_issue_cycles` (`draft_issue_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_cycles_project_id_idx` ON `draft_issue_cycles` (`project_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_cycles_updated_by_id_idx` ON `draft_issue_cycles` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_cycles_workspace_id_idx` ON `draft_issue_cycles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `draft_issue_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`draft_issue_id` integer NOT NULL,
	`label_id` integer NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`draft_issue_id`) REFERENCES `draft_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_issue_id`,`workspace_id`) REFERENCES `draft_issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_id`,`workspace_id`) REFERENCES `labels`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `draft_issue_labels_created_by_id_idx` ON `draft_issue_labels` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_labels_draft_issue_id_idx` ON `draft_issue_labels` (`draft_issue_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_labels_label_id_idx` ON `draft_issue_labels` (`label_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_labels_project_id_idx` ON `draft_issue_labels` (`project_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_labels_updated_by_id_idx` ON `draft_issue_labels` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_labels_workspace_id_idx` ON `draft_issue_labels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `draft_issue_modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`draft_issue_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`draft_issue_id`) REFERENCES `draft_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_issue_id`,`workspace_id`) REFERENCES `draft_issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`,`project_id`) REFERENCES `modules`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_issue_modules_draft_issue_id_module_id_deleted_at_unique` ON `draft_issue_modules` (`draft_issue_id`,`module_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `draft_issue_modules_created_by_id_idx` ON `draft_issue_modules` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_modules_draft_issue_id_idx` ON `draft_issue_modules` (`draft_issue_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_modules_module_id_idx` ON `draft_issue_modules` (`module_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_modules_project_id_idx` ON `draft_issue_modules` (`project_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_modules_updated_by_id_idx` ON `draft_issue_modules` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issue_modules_workspace_id_idx` ON `draft_issue_modules` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_draft_issue_unique_issue_module_when_deleted_at_null` ON `draft_issue_modules` (`draft_issue_id`,`module_id`) WHERE ("draft_issue_modules"."deleted_at" IS NULL);--> statement-breakpoint
CREATE TABLE `draft_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`name` text(255),
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_stripped` text,
	`description_binary` blob,
	`priority` text(30) DEFAULT 'none' NOT NULL,
	`start_date` text,
	`target_date` text,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`completed_at` integer,
	`external_source` text(255),
	`external_id` text(255),
	`estimate_point_id` integer,
	`parent_id` integer,
	`project_id` integer,
	`state_id` integer,
	`type_id` integer,
	`workspace_id` integer NOT NULL,
	`description_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_point_id`) REFERENCES `estimate_points`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `issue_types`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_point_id`,`project_id`) REFERENCES `estimate_points`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`state_id`,`project_id`) REFERENCES `states`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`,`workspace_id`) REFERENCES `issue_types`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "draft_issues_priority_values" CHECK("draft_issues"."priority" in ('urgent', 'high', 'medium', 'low', 'none')),
	CONSTRAINT "draft_issues_description_json_json" CHECK(json_valid("draft_issues"."description_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_issues_id_workspace_id_unique` ON `draft_issues` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_created_by_id_idx` ON `draft_issues` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_estimate_point_id_idx` ON `draft_issues` (`estimate_point_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_parent_id_idx` ON `draft_issues` (`parent_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_project_id_idx` ON `draft_issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_state_id_idx` ON `draft_issues` (`state_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_type_id_idx` ON `draft_issues` (`type_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_updated_by_id_idx` ON `draft_issues` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `draft_issues_workspace_id_idx` ON `draft_issues` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `estimate_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`key` integer DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`value` text(255) NOT NULL,
	`estimate_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`estimate_id`) REFERENCES `estimates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`estimate_id`,`project_id`) REFERENCES `estimates`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_points_id_project_id_unique` ON `estimate_points` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `estimate_points_created_by_id_idx` ON `estimate_points` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `estimate_points_estimate_id_idx` ON `estimate_points` (`estimate_id`);--> statement-breakpoint
CREATE INDEX `estimate_points_project_id_idx` ON `estimate_points` (`project_id`);--> statement-breakpoint
CREATE INDEX `estimate_points_updated_by_id_idx` ON `estimate_points` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `estimate_points_workspace_id_idx` ON `estimate_points` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`type` text(255) DEFAULT 'categories' NOT NULL,
	`last_used` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "estimates_type_values" CHECK("estimates"."type" in ('categories', 'points'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `estimates_name_project_id_deleted_at_unique` ON `estimates` (`name`,`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimates_id_project_id_unique` ON `estimates` (`id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `estimate_unique_name_project_when_deleted_at_null` ON `estimates` (`name`,`project_id`) WHERE ("estimates"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `estimates_created_by_id_idx` ON `estimates` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `estimates_project_id_idx` ON `estimates` (`project_id`);--> statement-breakpoint
CREATE INDEX `estimates_updated_by_id_idx` ON `estimates` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `estimates_workspace_id_idx` ON `estimates` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `intake_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`status` integer DEFAULT -2 NOT NULL,
	`snoozed_till` integer,
	`source` text(255) DEFAULT 'IN_APP',
	`duplicate_to_id` integer,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`deleted_at` integer,
	`extra` text DEFAULT '{}' NOT NULL,
	`source_email` text,
	`intake_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duplicate_to_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`duplicate_to_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intake_id`,`project_id`) REFERENCES `intakes`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_issues_status_values" CHECK("intake_issues"."status" in (-2, -1, 0, 1, 2)),
	CONSTRAINT "intake_issues_extra_json" CHECK(json_valid("intake_issues"."extra"))
);
--> statement-breakpoint
CREATE INDEX `intake_issues_created_by_id_idx` ON `intake_issues` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `intake_issues_duplicate_to_id_idx` ON `intake_issues` (`duplicate_to_id`);--> statement-breakpoint
CREATE INDEX `intake_issues_intake_id_idx` ON `intake_issues` (`intake_id`);--> statement-breakpoint
CREATE INDEX `intake_issues_issue_id_idx` ON `intake_issues` (`issue_id`);--> statement-breakpoint
CREATE INDEX `intake_issues_project_id_idx` ON `intake_issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `intake_issues_updated_by_id_idx` ON `intake_issues` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `intake_issues_workspace_id_idx` ON `intake_issues` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `intake_issue_snoozed_till_idx` ON `intake_issues` (`snoozed_till`) WHERE ("intake_issues"."status" = 0);--> statement-breakpoint
CREATE TABLE `intakes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`view_props` text DEFAULT '{}' NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intakes_view_props_json" CHECK(json_valid("intakes"."view_props")),
	CONSTRAINT "intakes_logo_props_json" CHECK(json_valid("intakes"."logo_props"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intakes_name_project_id_deleted_at_unique` ON `intakes` (`name`,`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `intakes_id_project_id_unique` ON `intakes` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `intakes_created_by_id_idx` ON `intakes` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `intakes_project_id_idx` ON `intakes` (`project_id`);--> statement-breakpoint
CREATE INDEX `intakes_updated_by_id_idx` ON `intakes` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `intakes_workspace_id_idx` ON `intakes` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `intake_unique_name_project_when_deleted_at_null` ON `intakes` (`name`,`project_id`) WHERE ("intakes"."deleted_at" IS NULL);--> statement-breakpoint
CREATE TABLE `issue_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`workspace_id` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`is_default` integer DEFAULT false NOT NULL,
	`level` real DEFAULT 0 NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`is_epic` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "issue_types_logo_props_json" CHECK(json_valid("issue_types"."logo_props"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_types_id_workspace_id_unique` ON `issue_types` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `issue_types_created_by_id_idx` ON `issue_types` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_types_updated_by_id_idx` ON `issue_types` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_types_workspace_id_idx` ON `issue_types` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `module_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`issue_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`,`project_id`) REFERENCES `modules`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_issues_issue_id_module_id_deleted_at_unique` ON `module_issues` (`issue_id`,`module_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_issue_unique_issue_module_when_deleted_at_null` ON `module_issues` (`issue_id`,`module_id`) WHERE ("module_issues"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `module_issues_created_by_id_idx` ON `module_issues` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `module_issues_issue_id_idx` ON `module_issues` (`issue_id`);--> statement-breakpoint
CREATE INDEX `module_issues_module_id_idx` ON `module_issues` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_issues_project_id_idx` ON `module_issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `module_issues_updated_by_id_idx` ON `module_issues` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `module_issues_workspace_id_idx` ON `module_issues` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `module_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`title` text(255),
	`url` text(200) NOT NULL,
	`module_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`,`project_id`) REFERENCES `modules`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "module_links_metadata_json" CHECK(json_valid("module_links"."metadata"))
);
--> statement-breakpoint
CREATE INDEX `module_links_created_by_id_idx` ON `module_links` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `module_links_module_id_idx` ON `module_links` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_links_project_id_idx` ON `module_links` (`project_id`);--> statement-breakpoint
CREATE INDEX `module_links_updated_by_id_idx` ON `module_links` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `module_links_workspace_id_idx` ON `module_links` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `module_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`member_id` integer NOT NULL,
	`module_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`,`project_id`) REFERENCES `modules`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_members_module_id_member_id_deleted_at_unique` ON `module_members` (`module_id`,`member_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `module_members_created_by_id_idx` ON `module_members` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `module_members_member_id_idx` ON `module_members` (`member_id`);--> statement-breakpoint
CREATE INDEX `module_members_module_id_idx` ON `module_members` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_members_project_id_idx` ON `module_members` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_member_unique_module_member_when_deleted_at_null` ON `module_members` (`module_id`,`member_id`) WHERE ("module_members"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `module_members_updated_by_id_idx` ON `module_members` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `module_members_workspace_id_idx` ON `module_members` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `module_user_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`filters` text DEFAULT '{}' NOT NULL,
	`display_filters` text DEFAULT '{}' NOT NULL,
	`display_properties` text DEFAULT '{}' NOT NULL,
	`module_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`rich_filters` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`,`project_id`) REFERENCES `modules`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "module_user_properties_filters_json" CHECK(json_valid("module_user_properties"."filters")),
	CONSTRAINT "module_user_properties_display_filters_json" CHECK(json_valid("module_user_properties"."display_filters")),
	CONSTRAINT "module_user_properties_display_properties_json" CHECK(json_valid("module_user_properties"."display_properties")),
	CONSTRAINT "module_user_properties_rich_filters_json" CHECK(json_valid("module_user_properties"."rich_filters"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_user_properties_module_id_user_id_deleted_at_unique` ON `module_user_properties` (`module_id`,`user_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `module_user_properties_created_by_id_idx` ON `module_user_properties` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `module_user_properties_module_id_idx` ON `module_user_properties` (`module_id`);--> statement-breakpoint
CREATE INDEX `module_user_properties_project_id_idx` ON `module_user_properties` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_user_properties_unique_module_user_when_deleted_at_null` ON `module_user_properties` (`module_id`,`user_id`) WHERE ("module_user_properties"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `module_user_properties_updated_by_id_idx` ON `module_user_properties` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `module_user_properties_user_id_idx` ON `module_user_properties` (`user_id`);--> statement-breakpoint
CREATE INDEX `module_user_properties_workspace_id_idx` ON `module_user_properties` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`description_text` text,
	`description_html` text,
	`start_date` text,
	`target_date` text,
	`status` text(20) DEFAULT 'planned' NOT NULL,
	`lead_id` integer,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`view_props` text DEFAULT '{}' NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`external_id` text(255),
	`external_source` text(255),
	`archived_at` integer,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lead_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "modules_description_text_json" CHECK(json_valid("modules"."description_text") or "modules"."description_text" is null),
	CONSTRAINT "modules_description_html_json" CHECK(json_valid("modules"."description_html") or "modules"."description_html" is null),
	CONSTRAINT "modules_status_values" CHECK("modules"."status" in ('backlog', 'planned', 'in-progress', 'paused', 'completed', 'cancelled')),
	CONSTRAINT "modules_view_props_json" CHECK(json_valid("modules"."view_props")),
	CONSTRAINT "modules_logo_props_json" CHECK(json_valid("modules"."logo_props"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modules_name_project_id_deleted_at_unique` ON `modules` (`name`,`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `modules_id_project_id_unique` ON `modules` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `modules_created_by_id_idx` ON `modules` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `modules_lead_id_idx` ON `modules` (`lead_id`);--> statement-breakpoint
CREATE INDEX `modules_project_id_idx` ON `modules` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `module_unique_name_project_when_deleted_at_null` ON `modules` (`name`,`project_id`) WHERE ("modules"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `modules_updated_by_id_idx` ON `modules` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `modules_workspace_id_idx` ON `modules` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_issue_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`level` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`issue_type_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_type_id`) REFERENCES `issue_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_type_id`,`workspace_id`) REFERENCES `issue_types`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_issue_types_level_check" CHECK("project_issue_types"."level" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_issue_types_project_id_issue_type_id_deleted_at_unique` ON `project_issue_types` (`project_id`,`issue_type_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_issue_type_unique_project_issue_type_when_deleted_at_nu` ON `project_issue_types` (`project_id`,`issue_type_id`) WHERE ("project_issue_types"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `project_issue_types_created_by_id_idx` ON `project_issue_types` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_issue_types_issue_type_id_idx` ON `project_issue_types` (`issue_type_id`);--> statement-breakpoint
CREATE INDEX `project_issue_types_project_id_idx` ON `project_issue_types` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_issue_types_updated_by_id_idx` ON `project_issue_types` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_issue_types_workspace_id_idx` ON `project_issue_types` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `deploy_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`entity_identifier` integer,
	`entity_name` text(30),
	`anchor` text(255) NOT NULL,
	`is_comments_enabled` integer DEFAULT false NOT NULL,
	`is_reactions_enabled` integer DEFAULT false NOT NULL,
	`is_votes_enabled` integer DEFAULT false NOT NULL,
	`view_props` text DEFAULT '{}' NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`is_activity_enabled` integer DEFAULT true NOT NULL,
	`is_disabled` integer DEFAULT false NOT NULL,
	`intake_id` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intake_id`,`project_id`) REFERENCES `intakes`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deploy_boards_view_props_json" CHECK(json_valid("deploy_boards"."view_props"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_boards_anchor_key` ON `deploy_boards` (`anchor`);--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_boards_entity_name_entity_identifier_deleted_at_unique` ON `deploy_boards` (`entity_name`,`entity_identifier`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_board_unique_entity_name_entity_identifier_when_deleted_` ON `deploy_boards` (`entity_name`,`entity_identifier`) WHERE ("deploy_boards"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `deploy_boards_created_by_id_idx` ON `deploy_boards` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `deploy_boards_intake_id_idx` ON `deploy_boards` (`intake_id`);--> statement-breakpoint
CREATE INDEX `deploy_boards_project_id_idx` ON `deploy_boards` (`project_id`);--> statement-breakpoint
CREATE INDEX `deploy_boards_updated_by_id_idx` ON `deploy_boards` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `deploy_boards_workspace_id_idx` ON `deploy_boards` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `description_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`description_json` text DEFAULT '{}' NOT NULL,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_binary` blob,
	`description_stripped` text,
	`description_id` integer NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`description_id`) REFERENCES `descriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`description_id`,`workspace_id`) REFERENCES `descriptions`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "description_versions_description_json_json" CHECK(json_valid("description_versions"."description_json"))
);
--> statement-breakpoint
CREATE INDEX `description_versions_created_by_id_idx` ON `description_versions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `description_versions_description_id_idx` ON `description_versions` (`description_id`);--> statement-breakpoint
CREATE INDEX `description_versions_project_id_idx` ON `description_versions` (`project_id`);--> statement-breakpoint
CREATE INDEX `description_versions_updated_by_id_idx` ON `description_versions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `description_versions_workspace_id_idx` ON `description_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `descriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`description_json` text DEFAULT '{}' NOT NULL,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_binary` blob,
	`description_stripped` text,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "descriptions_description_json_json" CHECK(json_valid("descriptions"."description_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `descriptions_id_workspace_id_unique` ON `descriptions` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `descriptions_created_by_id_idx` ON `descriptions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `descriptions_project_id_idx` ON `descriptions` (`project_id`);--> statement-breakpoint
CREATE INDEX `descriptions_updated_by_id_idx` ON `descriptions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `descriptions_workspace_id_idx` ON `descriptions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `file_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`attributes` text DEFAULT '{}' NOT NULL,
	`asset` text(800) NOT NULL,
	`workspace_id` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`is_archived` integer DEFAULT false NOT NULL,
	`comment_id` integer,
	`entity_type` text(255),
	`external_id` text(255),
	`external_source` text(255),
	`is_uploaded` integer DEFAULT false NOT NULL,
	`issue_id` integer,
	`page_id` integer,
	`project_id` integer,
	`size` real DEFAULT 0 NOT NULL,
	`storage_metadata` text DEFAULT '{}',
	`user_id` integer,
	`draft_issue_id` integer,
	`entity_identifier` text(255),
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_issue_id`) REFERENCES `draft_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`,`project_id`) REFERENCES `issue_comments`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`,`workspace_id`) REFERENCES `pages`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`draft_issue_id`,`workspace_id`) REFERENCES `draft_issues`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "file_assets_attributes_json" CHECK(json_valid("file_assets"."attributes")),
	CONSTRAINT "file_assets_storage_metadata_json" CHECK(json_valid("file_assets"."storage_metadata") or "file_assets"."storage_metadata" is null)
);
--> statement-breakpoint
CREATE INDEX `asset_asset_idx` ON `file_assets` (`asset`);--> statement-breakpoint
CREATE INDEX `asset_entity_identifier_idx` ON `file_assets` (`entity_identifier`);--> statement-breakpoint
CREATE INDEX `asset_entity_idx` ON `file_assets` (`entity_type`,`entity_identifier`);--> statement-breakpoint
CREATE INDEX `asset_entity_type_idx` ON `file_assets` (`entity_type`);--> statement-breakpoint
CREATE INDEX `file_assets_created_by_id_idx` ON `file_assets` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `file_assets_updated_by_id_idx` ON `file_assets` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `file_assets_comment_id_idx` ON `file_assets` (`comment_id`);--> statement-breakpoint
CREATE INDEX `file_assets_draft_issue_id_idx` ON `file_assets` (`draft_issue_id`);--> statement-breakpoint
CREATE INDEX `file_assets_issue_id_idx` ON `file_assets` (`issue_id`);--> statement-breakpoint
CREATE INDEX `file_assets_page_id_idx` ON `file_assets` (`page_id`);--> statement-breakpoint
CREATE INDEX `file_assets_project_id_idx` ON `file_assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `file_assets_user_id_idx` ON `file_assets` (`user_id`);--> statement-breakpoint
CREATE INDEX `file_assets_workspace_id_idx` ON `file_assets` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `page_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`label_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`,`workspace_id`) REFERENCES `labels`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`page_id`,`workspace_id`) REFERENCES `pages`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `page_labels_created_by_id_idx` ON `page_labels` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `page_labels_label_id_idx` ON `page_labels` (`label_id`);--> statement-breakpoint
CREATE INDEX `page_labels_page_id_idx` ON `page_labels` (`page_id`);--> statement-breakpoint
CREATE INDEX `page_labels_updated_by_id_idx` ON `page_labels` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `page_labels_workspace_id_idx` ON `page_labels` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `page_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`transaction` text NOT NULL,
	`entity_identifier` integer,
	`entity_name` text(30) NOT NULL,
	`page_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`entity_type` text(30),
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`,`workspace_id`) REFERENCES `pages`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_logs_page_id_transaction_unique` ON `page_logs` (`page_id`,`transaction`);--> statement-breakpoint
CREATE INDEX `page_logs_created_by_id_idx` ON `page_logs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `page_logs_page_id_idx` ON `page_logs` (`page_id`);--> statement-breakpoint
CREATE INDEX `page_logs_updated_by_id_idx` ON `page_logs` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `page_logs_workspace_id_idx` ON `page_logs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `pagelog_entity_id_idx` ON `page_logs` (`entity_identifier`);--> statement-breakpoint
CREATE INDEX `pagelog_entity_name_idx` ON `page_logs` (`entity_name`);--> statement-breakpoint
CREATE INDEX `pagelog_entity_type_idx` ON `page_logs` (`entity_type`);--> statement-breakpoint
CREATE INDEX `pagelog_name_id_idx` ON `page_logs` (`entity_name`,`entity_identifier`);--> statement-breakpoint
CREATE INDEX `pagelog_type_id_idx` ON `page_logs` (`entity_type`,`entity_identifier`);--> statement-breakpoint
CREATE TABLE `page_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`last_saved_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`description_binary` blob,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_stripped` text,
	`description_json` text DEFAULT '{}' NOT NULL,
	`owned_by_id` integer NOT NULL,
	`page_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`sub_pages_data` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`,`workspace_id`) REFERENCES `pages`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "page_versions_description_json_json" CHECK(json_valid("page_versions"."description_json")),
	CONSTRAINT "page_versions_sub_pages_data_json" CHECK(json_valid("page_versions"."sub_pages_data"))
);
--> statement-breakpoint
CREATE INDEX `page_versions_created_by_id_idx` ON `page_versions` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `page_versions_owned_by_id_idx` ON `page_versions` (`owned_by_id`);--> statement-breakpoint
CREATE INDEX `page_versions_page_id_idx` ON `page_versions` (`page_id`);--> statement-breakpoint
CREATE INDEX `page_versions_updated_by_id_idx` ON `page_versions` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `page_versions_workspace_id_idx` ON `page_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text DEFAULT '' NOT NULL,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_stripped` text,
	`access` integer DEFAULT 0 NOT NULL,
	`owned_by_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`color` text(255) DEFAULT '' NOT NULL,
	`archived_at` text,
	`is_locked` integer DEFAULT false NOT NULL,
	`parent_id` integer,
	`view_props` text DEFAULT '{}' NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`description_binary` blob,
	`is_global` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`moved_to_page` integer,
	`moved_to_project` integer,
	`external_id` text(255),
	`external_source` text(255),
	`sort_order` real DEFAULT 65535 NOT NULL,
	`description_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`,`workspace_id`) REFERENCES `pages`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pages_access_values" CHECK("pages"."access" in (0, 1)),
	CONSTRAINT "pages_view_props_json" CHECK(json_valid("pages"."view_props")),
	CONSTRAINT "pages_logo_props_json" CHECK(json_valid("pages"."logo_props")),
	CONSTRAINT "pages_description_json_json" CHECK(json_valid("pages"."description_json")),
	CONSTRAINT "pages_access_check" CHECK("pages"."access" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_id_workspace_id_unique` ON `pages` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `pages_created_by_id_idx` ON `pages` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `pages_owned_by_id_idx` ON `pages` (`owned_by_id`);--> statement-breakpoint
CREATE INDEX `pages_parent_id_idx` ON `pages` (`parent_id`);--> statement-breakpoint
CREATE INDEX `pages_updated_by_id_idx` ON `pages` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `pages_workspace_id_idx` ON `pages` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_deploy_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`anchor` text(255) NOT NULL,
	`comments` integer DEFAULT false NOT NULL,
	`reactions` integer DEFAULT false NOT NULL,
	`votes` integer DEFAULT false NOT NULL,
	`views` text DEFAULT '{}' NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`intake_id` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intake_id`) REFERENCES `intakes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`intake_id`,`project_id`) REFERENCES `intakes`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_deploy_boards_views_json" CHECK(json_valid("project_deploy_boards"."views"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_deploy_boards_anchor_key` ON `project_deploy_boards` (`anchor`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_deploy_boards_project_id_anchor_unique` ON `project_deploy_boards` (`project_id`,`anchor`);--> statement-breakpoint
CREATE INDEX `project_deploy_boards_created_by_id_idx` ON `project_deploy_boards` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_deploy_boards_intake_id_idx` ON `project_deploy_boards` (`intake_id`);--> statement-breakpoint
CREATE INDEX `project_deploy_boards_project_id_idx` ON `project_deploy_boards` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_deploy_boards_updated_by_id_idx` ON `project_deploy_boards` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_deploy_boards_workspace_id_idx` ON `project_deploy_boards` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`page_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`,`workspace_id`) REFERENCES `pages`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_pages_project_id_page_id_deleted_at_unique` ON `project_pages` (`project_id`,`page_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_page_unique_project_page_when_deleted_at_null` ON `project_pages` (`project_id`,`page_id`) WHERE ("project_pages"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `project_pages_created_by_id_idx` ON `project_pages` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_pages_page_id_idx` ON `project_pages` (`page_id`);--> statement-breakpoint
CREATE INDEX `project_pages_project_id_idx` ON `project_pages` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_pages_updated_by_id_idx` ON `project_pages` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_pages_workspace_id_idx` ON `project_pages` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `project_public_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`member_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`member_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_public_members_project_id_member_id_deleted_at_unique` ON `project_public_members` (`project_id`,`member_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_public_member_unique_project_member_when_deleted_at_nul` ON `project_public_members` (`project_id`,`member_id`) WHERE ("project_public_members"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `project_public_members_created_by_id_idx` ON `project_public_members` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_public_members_member_id_idx` ON `project_public_members` (`member_id`);--> statement-breakpoint
CREATE INDEX `project_public_members_project_id_idx` ON `project_public_members` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_public_members_updated_by_id_idx` ON `project_public_members` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_public_members_workspace_id_idx` ON `project_public_members` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `analytic_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`query` text NOT NULL,
	`query_dict` text DEFAULT '{}' NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "analytic_views_query_json" CHECK(json_valid("analytic_views"."query")),
	CONSTRAINT "analytic_views_query_dict_json" CHECK(json_valid("analytic_views"."query_dict"))
);
--> statement-breakpoint
CREATE INDEX `analytic_views_created_by_id_idx` ON `analytic_views` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `analytic_views_updated_by_id_idx` ON `analytic_views` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `analytic_views_workspace_id_idx` ON `analytic_views` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `email_notification_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`entity_identifier` integer,
	`entity_name` text(255) NOT NULL,
	`data` text,
	`processed_at` integer,
	`sent_at` integer,
	`entity` text(200) NOT NULL,
	`old_value` text(300),
	`new_value` text(300),
	`receiver_id` integer NOT NULL,
	`triggered_by_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`receiver_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_notification_logs_data_json" CHECK(json_valid("email_notification_logs"."data") or "email_notification_logs"."data" is null)
);
--> statement-breakpoint
CREATE INDEX `email_notification_logs_created_by_id_idx` ON `email_notification_logs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `email_notification_logs_receiver_id_idx` ON `email_notification_logs` (`receiver_id`);--> statement-breakpoint
CREATE INDEX `email_notification_logs_triggered_by_id_idx` ON `email_notification_logs` (`triggered_by_id`);--> statement-breakpoint
CREATE INDEX `email_notification_logs_updated_by_id_idx` ON `email_notification_logs` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `issue_views` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`query` text NOT NULL,
	`access` integer DEFAULT 1 NOT NULL,
	`project_id` integer,
	`workspace_id` integer NOT NULL,
	`filters` text DEFAULT '{}' NOT NULL,
	`display_filters` text DEFAULT '{}' NOT NULL,
	`display_properties` text DEFAULT '{}' NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`owned_by_id` integer NOT NULL,
	`deleted_at` integer,
	`rich_filters` text DEFAULT '{}' NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owned_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_views_query_json" CHECK(json_valid("issue_views"."query")),
	CONSTRAINT "issue_views_access_values" CHECK("issue_views"."access" in (0, 1)),
	CONSTRAINT "issue_views_filters_json" CHECK(json_valid("issue_views"."filters")),
	CONSTRAINT "issue_views_display_filters_json" CHECK(json_valid("issue_views"."display_filters")),
	CONSTRAINT "issue_views_display_properties_json" CHECK(json_valid("issue_views"."display_properties")),
	CONSTRAINT "issue_views_logo_props_json" CHECK(json_valid("issue_views"."logo_props")),
	CONSTRAINT "issue_views_rich_filters_json" CHECK(json_valid("issue_views"."rich_filters")),
	CONSTRAINT "issue_views_access_check" CHECK("issue_views"."access" >= 0)
);
--> statement-breakpoint
CREATE INDEX `issue_views_created_by_id_idx` ON `issue_views` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `issue_views_owned_by_id_idx` ON `issue_views` (`owned_by_id`);--> statement-breakpoint
CREATE INDEX `issue_views_project_id_idx` ON `issue_views` (`project_id`);--> statement-breakpoint
CREATE INDEX `issue_views_updated_by_id_idx` ON `issue_views` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `issue_views_workspace_id_idx` ON `issue_views` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`data` text,
	`entity_identifier` integer,
	`entity_name` text(255) NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`message_html` text DEFAULT '<p></p>' NOT NULL,
	`message_stripped` text,
	`sender` text(255) NOT NULL,
	`read_at` integer,
	`snoozed_till` integer,
	`archived_at` integer,
	`project_id` integer,
	`receiver_id` integer NOT NULL,
	`triggered_by_id` integer,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receiver_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggered_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notifications_data_json" CHECK(json_valid("notifications"."data") or "notifications"."data" is null),
	CONSTRAINT "notifications_message_json" CHECK(json_valid("notifications"."message") or "notifications"."message" is null)
);
--> statement-breakpoint
CREATE INDEX `notif_entity_identifier_idx` ON `notifications` (`entity_identifier`);--> statement-breakpoint
CREATE INDEX `notif_entity_idx` ON `notifications` (`receiver_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notif_entity_lookup_idx` ON `notifications` (`workspace_id`,`entity_identifier`,`entity_name`);--> statement-breakpoint
CREATE INDEX `notif_entity_name_idx` ON `notifications` (`entity_name`);--> statement-breakpoint
CREATE INDEX `notif_read_at_idx` ON `notifications` (`read_at`);--> statement-breakpoint
CREATE INDEX `notif_receiver_entity_idx` ON `notifications` (`receiver_id`,`workspace_id`,`entity_name`,`read_at`);--> statement-breakpoint
CREATE INDEX `notif_receiver_sender_idx` ON `notifications` (`receiver_id`,`workspace_id`,`sender`);--> statement-breakpoint
CREATE INDEX `notif_receiver_state_idx` ON `notifications` (`receiver_id`,`workspace_id`,`snoozed_till`,`archived_at`);--> statement-breakpoint
CREATE INDEX `notif_receiver_status_idx` ON `notifications` (`receiver_id`,`workspace_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_created_by_id_idx` ON `notifications` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `notifications_project_id_idx` ON `notifications` (`project_id`);--> statement-breakpoint
CREATE INDEX `notifications_receiver_id_idx` ON `notifications` (`receiver_id`);--> statement-breakpoint
CREATE INDEX `notifications_triggered_by_id_idx` ON `notifications` (`triggered_by_id`);--> statement-breakpoint
CREATE INDEX `notifications_updated_by_id_idx` ON `notifications` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `notifications_workspace_id_idx` ON `notifications` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `stickies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`name` text,
	`description` text DEFAULT '{}' NOT NULL,
	`description_html` text DEFAULT '<p></p>' NOT NULL,
	`description_stripped` text,
	`description_binary` blob,
	`logo_props` text DEFAULT '{}' NOT NULL,
	`color` text(255),
	`background_color` text(255),
	`owner_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`sort_order` real DEFAULT 65535 NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stickies_description_json" CHECK(json_valid("stickies"."description")),
	CONSTRAINT "stickies_logo_props_json" CHECK(json_valid("stickies"."logo_props"))
);
--> statement-breakpoint
CREATE INDEX `stickies_created_by_id_idx` ON `stickies` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `stickies_owner_id_idx` ON `stickies` (`owner_id`);--> statement-breakpoint
CREATE INDEX `stickies_updated_by_id_idx` ON `stickies` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `stickies_workspace_id_idx` ON `stickies` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user_favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`entity_type` text(100) NOT NULL,
	`entity_identifier` integer,
	`name` text(255),
	`is_folder` integer DEFAULT false NOT NULL,
	`sequence` real DEFAULT 65535 NOT NULL,
	`parent_id` integer,
	`project_id` integer,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_id`) REFERENCES `user_favorites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`,`workspace_id`) REFERENCES `user_favorites`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_favorites_entity_type_user_id_entity_identifier_deleted_at_unique` ON `user_favorites` (`entity_type`,`user_id`,`entity_identifier`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_favorites_id_workspace_id_unique` ON `user_favorites` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `fav_entity_identifier_idx` ON `user_favorites` (`entity_identifier`);--> statement-breakpoint
CREATE INDEX `fav_entity_idx` ON `user_favorites` (`entity_type`,`entity_identifier`);--> statement-breakpoint
CREATE INDEX `fav_entity_type_idx` ON `user_favorites` (`entity_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_favorite_unique_entity_type_entity_identifier_user_when_de` ON `user_favorites` (`entity_type`,`entity_identifier`,`user_id`) WHERE ("user_favorites"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `user_favorites_created_by_id_idx` ON `user_favorites` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `user_favorites_parent_id_idx` ON `user_favorites` (`parent_id`);--> statement-breakpoint
CREATE INDEX `user_favorites_project_id_idx` ON `user_favorites` (`project_id`);--> statement-breakpoint
CREATE INDEX `user_favorites_updated_by_id_idx` ON `user_favorites` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `user_favorites_user_id_idx` ON `user_favorites` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_favorites_workspace_id_idx` ON `user_favorites` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user_notification_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`property_change` integer DEFAULT true NOT NULL,
	`state_change` integer DEFAULT true NOT NULL,
	`comment` integer DEFAULT true NOT NULL,
	`mention` integer DEFAULT true NOT NULL,
	`issue_completed` integer DEFAULT true NOT NULL,
	`project_id` integer,
	`user_id` integer NOT NULL,
	`workspace_id` integer,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_notification_preferences_created_by_id_idx` ON `user_notification_preferences` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `user_notification_preferences_project_id_idx` ON `user_notification_preferences` (`project_id`);--> statement-breakpoint
CREATE INDEX `user_notification_preferences_updated_by_id_idx` ON `user_notification_preferences` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `user_notification_preferences_user_id_idx` ON `user_notification_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_notification_preferences_workspace_id_idx` ON `user_notification_preferences` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user_recent_visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`entity_identifier` integer,
	`entity_name` text(30) NOT NULL,
	`visited_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`project_id` integer,
	`user_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_recent_visits_created_by_id_idx` ON `user_recent_visits` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `user_recent_visits_project_id_idx` ON `user_recent_visits` (`project_id`);--> statement-breakpoint
CREATE INDEX `user_recent_visits_updated_by_id_idx` ON `user_recent_visits` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `user_recent_visits_user_id_idx` ON `user_recent_visits` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_recent_visits_workspace_id_idx` ON `user_recent_visits` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `api_activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`token_identifier` text(255) NOT NULL,
	`path` text(255) NOT NULL,
	`method` text(10) NOT NULL,
	`query_params` text,
	`headers` text,
	`body` text,
	`response_code` integer NOT NULL,
	`response_body` text,
	`ip_address` text,
	`user_agent` text(512),
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "api_activity_logs_response_code_check" CHECK("api_activity_logs"."response_code" >= 0)
);
--> statement-breakpoint
CREATE INDEX `api_activity_logs_created_by_id_idx` ON `api_activity_logs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `api_activity_logs_updated_by_id_idx` ON `api_activity_logs` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`token` text(255) NOT NULL,
	`label` text(255) NOT NULL,
	`user_type` integer DEFAULT 0 NOT NULL,
	`user_id` integer NOT NULL,
	`workspace_id` integer,
	`description` text DEFAULT '' NOT NULL,
	`expired_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used` integer,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "api_tokens_user_type_values" CHECK("api_tokens"."user_type" in (0, 1)),
	CONSTRAINT "api_tokens_user_type_check" CHECK("api_tokens"."user_type" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_key` ON `api_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `api_tokens_created_by_id_idx` ON `api_tokens` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_updated_by_id_idx` ON `api_tokens` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_user_id_idx` ON `api_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `api_tokens_workspace_id_idx` ON `api_tokens` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `exporters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`project` text,
	`provider` text(50) NOT NULL,
	`status` text(50) DEFAULT 'queued' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`url` text(800),
	`token` text(255) NOT NULL,
	`initiated_by_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`filters` text,
	`name` text(255),
	`type` text(50) DEFAULT 'issue_exports' NOT NULL,
	`deleted_at` integer,
	`rich_filters` text DEFAULT '{}',
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`initiated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exporters_project_json" CHECK(json_valid("exporters"."project") and json_type("exporters"."project") = 'array' or "exporters"."project" is null),
	CONSTRAINT "exporters_provider_values" CHECK("exporters"."provider" in ('json', 'csv', 'xlsx')),
	CONSTRAINT "exporters_status_values" CHECK("exporters"."status" in ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "exporters_filters_json" CHECK(json_valid("exporters"."filters") or "exporters"."filters" is null),
	CONSTRAINT "exporters_type_values" CHECK("exporters"."type" in ('issue_exports', 'issue_worklogs')),
	CONSTRAINT "exporters_rich_filters_json" CHECK(json_valid("exporters"."rich_filters") or "exporters"."rich_filters" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exporters_token_key` ON `exporters` (`token`);--> statement-breakpoint
CREATE INDEX `exporters_created_by_id_idx` ON `exporters` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `exporters_initiated_by_id_idx` ON `exporters` (`initiated_by_id`);--> statement-breakpoint
CREATE INDEX `exporters_updated_by_id_idx` ON `exporters` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `exporters_workspace_id_idx` ON `exporters` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `github_comment_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`repo_comment_id` integer NOT NULL,
	`comment_id` integer NOT NULL,
	`issue_sync_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`comment_id`) REFERENCES `issue_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_sync_id`) REFERENCES `github_issue_syncs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`,`project_id`) REFERENCES `issue_comments`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_sync_id`,`project_id`) REFERENCES `github_issue_syncs`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_comment_syncs_issue_sync_id_comment_id_unique` ON `github_comment_syncs` (`issue_sync_id`,`comment_id`);--> statement-breakpoint
CREATE INDEX `github_comment_syncs_comment_id_idx` ON `github_comment_syncs` (`comment_id`);--> statement-breakpoint
CREATE INDEX `github_comment_syncs_created_by_id_idx` ON `github_comment_syncs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `github_comment_syncs_issue_sync_id_idx` ON `github_comment_syncs` (`issue_sync_id`);--> statement-breakpoint
CREATE INDEX `github_comment_syncs_project_id_idx` ON `github_comment_syncs` (`project_id`);--> statement-breakpoint
CREATE INDEX `github_comment_syncs_updated_by_id_idx` ON `github_comment_syncs` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `github_comment_syncs_workspace_id_idx` ON `github_comment_syncs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `github_issue_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`repo_issue_id` integer NOT NULL,
	`github_issue_id` integer NOT NULL,
	`issue_url` text(200) NOT NULL,
	`issue_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`repository_sync_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_sync_id`) REFERENCES `github_repository_syncs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`,`project_id`) REFERENCES `issues`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_sync_id`,`project_id`) REFERENCES `github_repository_syncs`(`id`,`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_issue_syncs_repository_sync_id_issue_id_unique` ON `github_issue_syncs` (`repository_sync_id`,`issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_issue_syncs_id_project_id_unique` ON `github_issue_syncs` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `github_issue_syncs_created_by_id_idx` ON `github_issue_syncs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `github_issue_syncs_issue_id_idx` ON `github_issue_syncs` (`issue_id`);--> statement-breakpoint
CREATE INDEX `github_issue_syncs_project_id_idx` ON `github_issue_syncs` (`project_id`);--> statement-breakpoint
CREATE INDEX `github_issue_syncs_repository_sync_id_idx` ON `github_issue_syncs` (`repository_sync_id`);--> statement-breakpoint
CREATE INDEX `github_issue_syncs_updated_by_id_idx` ON `github_issue_syncs` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `github_issue_syncs_workspace_id_idx` ON `github_issue_syncs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `github_repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`name` text(500) NOT NULL,
	`url` text(200),
	`config` text DEFAULT '{}' NOT NULL,
	`repository_id` integer NOT NULL,
	`owner` text(500) NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "github_repositories_config_json" CHECK(json_valid("github_repositories"."config"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_repositories_id_project_id_unique` ON `github_repositories` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `github_repositories_created_by_id_idx` ON `github_repositories` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `github_repositories_project_id_idx` ON `github_repositories` (`project_id`);--> statement-breakpoint
CREATE INDEX `github_repositories_updated_by_id_idx` ON `github_repositories` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `github_repositories_workspace_id_idx` ON `github_repositories` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `github_repository_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`credentials` text DEFAULT '{}' NOT NULL,
	`actor_id` integer NOT NULL,
	`label_id` integer,
	`project_id` integer NOT NULL,
	`repository_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`workspace_integration_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `github_repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_integration_id`) REFERENCES `workspace_integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`,`workspace_id`) REFERENCES `labels`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_id`,`project_id`) REFERENCES `github_repositories`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_integration_id`,`workspace_id`) REFERENCES `workspace_integrations`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "github_repository_syncs_credentials_json" CHECK(json_valid("github_repository_syncs"."credentials"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_repository_syncs_project_id_repository_id_unique` ON `github_repository_syncs` (`project_id`,`repository_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_repository_syncs_repository_id_key` ON `github_repository_syncs` (`repository_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `github_repository_syncs_id_project_id_unique` ON `github_repository_syncs` (`id`,`project_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_actor_id_idx` ON `github_repository_syncs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_created_by_id_idx` ON `github_repository_syncs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_label_id_idx` ON `github_repository_syncs` (`label_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_project_id_idx` ON `github_repository_syncs` (`project_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_updated_by_id_idx` ON `github_repository_syncs` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_workspace_id_idx` ON `github_repository_syncs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `github_repository_syncs_workspace_integration_id_idx` ON `github_repository_syncs` (`workspace_integration_id`);--> statement-breakpoint
CREATE TABLE `importers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`service` text(50) NOT NULL,
	`status` text(50) DEFAULT 'queued' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`initiated_by_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`token_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`imported_data` text,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`initiated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "importers_service_values" CHECK("importers"."service" in ('github', 'jira')),
	CONSTRAINT "importers_status_values" CHECK("importers"."status" in ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "importers_metadata_json" CHECK(json_valid("importers"."metadata")),
	CONSTRAINT "importers_config_json" CHECK(json_valid("importers"."config")),
	CONSTRAINT "importers_data_json" CHECK(json_valid("importers"."data")),
	CONSTRAINT "importers_imported_data_json" CHECK(json_valid("importers"."imported_data") or "importers"."imported_data" is null)
);
--> statement-breakpoint
CREATE INDEX `importers_created_by_id_idx` ON `importers` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `importers_initiated_by_id_idx` ON `importers` (`initiated_by_id`);--> statement-breakpoint
CREATE INDEX `importers_project_id_idx` ON `importers` (`project_id`);--> statement-breakpoint
CREATE INDEX `importers_token_id_idx` ON `importers` (`token_id`);--> statement-breakpoint
CREATE INDEX `importers_updated_by_id_idx` ON `importers` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `importers_workspace_id_idx` ON `importers` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`title` text(400) NOT NULL,
	`provider` text(400) NOT NULL,
	`network` integer DEFAULT 1 NOT NULL,
	`description` text DEFAULT '{}' NOT NULL,
	`author` text(400) DEFAULT '' NOT NULL,
	`webhook_url` text DEFAULT '' NOT NULL,
	`webhook_secret` text DEFAULT '' NOT NULL,
	`redirect_url` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`avatar_url` text,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "integrations_network_values" CHECK("integrations"."network" in (1, 2)),
	CONSTRAINT "integrations_description_json" CHECK(json_valid("integrations"."description")),
	CONSTRAINT "integrations_metadata_json" CHECK(json_valid("integrations"."metadata")),
	CONSTRAINT "integrations_network_check" CHECK("integrations"."network" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_provider_key` ON `integrations` (`provider`);--> statement-breakpoint
CREATE INDEX `integrations_created_by_id_idx` ON `integrations` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `integrations_updated_by_id_idx` ON `integrations` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `project_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`deleted_at` integer,
	`project_id` integer NOT NULL,
	`webhook_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`webhook_id`,`workspace_id`) REFERENCES `webhooks`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_webhooks_project_id_webhook_id_deleted_at_unique` ON `project_webhooks` (`project_id`,`webhook_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_webhook_unique_project_webhook_when_deleted_at_null` ON `project_webhooks` (`project_id`,`webhook_id`) WHERE ("project_webhooks"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `project_webhooks_created_by_id_idx` ON `project_webhooks` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `project_webhooks_project_id_idx` ON `project_webhooks` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_webhooks_updated_by_id_idx` ON `project_webhooks` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `project_webhooks_webhook_id_idx` ON `project_webhooks` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `project_webhooks_workspace_id_idx` ON `project_webhooks` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `slack_project_syncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`access_token` text(300) NOT NULL,
	`scopes` text NOT NULL,
	`bot_user_id` text(50) NOT NULL,
	`webhook_url` text(1000) NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`team_id` text(30) NOT NULL,
	`team_name` text(300) NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`workspace_integration_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_integration_id`) REFERENCES `workspace_integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_integration_id`,`workspace_id`) REFERENCES `workspace_integrations`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "slack_project_syncs_data_json" CHECK(json_valid("slack_project_syncs"."data"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_project_syncs_team_id_project_id_unique` ON `slack_project_syncs` (`team_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `slack_project_syncs_created_by_id_idx` ON `slack_project_syncs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `slack_project_syncs_project_id_idx` ON `slack_project_syncs` (`project_id`);--> statement-breakpoint
CREATE INDEX `slack_project_syncs_updated_by_id_idx` ON `slack_project_syncs` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `slack_project_syncs_workspace_id_idx` ON `slack_project_syncs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `slack_project_syncs_workspace_integration_id_idx` ON `slack_project_syncs` (`workspace_integration_id`);--> statement-breakpoint
CREATE TABLE `webhook_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`event_type` text(255),
	`request_method` text(10),
	`request_headers` text,
	`request_body` text,
	`response_status` text,
	`response_headers` text,
	`response_body` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`webhook` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "webhook_logs_retry_count_check" CHECK("webhook_logs"."retry_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `webhook_logs_created_by_id_idx` ON `webhook_logs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `webhook_logs_updated_by_id_idx` ON `webhook_logs` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `webhook_logs_workspace_id_idx` ON `webhook_logs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`url` text(1024) NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`secret_key` text(255) NOT NULL,
	`project` integer DEFAULT false NOT NULL,
	`issue` integer DEFAULT false NOT NULL,
	`module` integer DEFAULT false NOT NULL,
	`cycle` integer DEFAULT false NOT NULL,
	`issue_comment` integer DEFAULT false NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	`is_internal` integer DEFAULT false NOT NULL,
	`version` text(50) DEFAULT 'v1' NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_workspace_id_url_deleted_at_unique` ON `webhooks` (`workspace_id`,`url`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhooks_id_workspace_id_unique` ON `webhooks` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_url_unique_url_when_deleted_at_null` ON `webhooks` (`workspace_id`,`url`) WHERE ("webhooks"."deleted_at" IS NULL);--> statement-breakpoint
CREATE INDEX `webhooks_created_by_id_idx` ON `webhooks` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `webhooks_updated_by_id_idx` ON `webhooks` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `webhooks_workspace_id_idx` ON `webhooks` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_integrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`actor_id` integer NOT NULL,
	`api_token_id` integer NOT NULL,
	`integration_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_integrations_metadata_json" CHECK(json_valid("workspace_integrations"."metadata")),
	CONSTRAINT "workspace_integrations_config_json" CHECK(json_valid("workspace_integrations"."config"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_integrations_workspace_id_integration_id_unique` ON `workspace_integrations` (`workspace_id`,`integration_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_integrations_id_workspace_id_unique` ON `workspace_integrations` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_integrations_actor_id_idx` ON `workspace_integrations` (`actor_id`);--> statement-breakpoint
CREATE INDEX `workspace_integrations_api_token_id_idx` ON `workspace_integrations` (`api_token_id`);--> statement-breakpoint
CREATE INDEX `workspace_integrations_created_by_id_idx` ON `workspace_integrations` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_integrations_integration_id_idx` ON `workspace_integrations` (`integration_id`);--> statement-breakpoint
CREATE INDEX `workspace_integrations_updated_by_id_idx` ON `workspace_integrations` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `workspace_integrations_workspace_id_idx` ON `workspace_integrations` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `changelogs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`title` text(255) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`version` text(255) NOT NULL,
	`tags` text DEFAULT '{}' NOT NULL,
	`release_date` integer,
	`is_release_candidate` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "changelogs_tags_json" CHECK(json_valid("changelogs"."tags"))
);
--> statement-breakpoint
CREATE INDEX `changelogs_created_by_id_idx` ON `changelogs` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `changelogs_updated_by_id_idx` ON `changelogs` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `instance_admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`role` integer DEFAULT 20 NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`instance_id` integer NOT NULL,
	`user_id` integer,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "instance_admins_role_values" CHECK("instance_admins"."role" in (20)),
	CONSTRAINT "instance_admins_role_check" CHECK("instance_admins"."role" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_admins_instance_id_user_id_unique` ON `instance_admins` (`instance_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `instance_admins_created_by_id_idx` ON `instance_admins` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `instance_admins_instance_id_idx` ON `instance_admins` (`instance_id`);--> statement-breakpoint
CREATE INDEX `instance_admins_updated_by_id_idx` ON `instance_admins` (`updated_by_id`);--> statement-breakpoint
CREATE INDEX `instance_admins_user_id_idx` ON `instance_admins` (`user_id`);--> statement-breakpoint
CREATE TABLE `instance_configurations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`key` text(100) NOT NULL,
	`value` text,
	`category` text NOT NULL,
	`is_encrypted` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instance_configurations_key_key` ON `instance_configurations` (`key`);--> statement-breakpoint
CREATE INDEX `instance_configurations_created_by_id_idx` ON `instance_configurations` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `instance_configurations_updated_by_id_idx` ON `instance_configurations` (`updated_by_id`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by_id` integer,
	`updated_by_id` integer,
	`instance_name` text(255) NOT NULL,
	`whitelist_emails` text,
	`instance_id` text(255) NOT NULL,
	`last_checked_at` integer NOT NULL,
	`namespace` text(255),
	`is_telemetry_enabled` integer DEFAULT true NOT NULL,
	`is_support_required` integer DEFAULT true NOT NULL,
	`is_setup_done` integer DEFAULT false NOT NULL,
	`is_signup_screen_visited` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`current_version` text(255) NOT NULL,
	`domain` text DEFAULT '' NOT NULL,
	`latest_version` text(255),
	`deleted_at` integer,
	`edition` text(255) DEFAULT 'PLANE_COMMUNITY' NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`is_current_version_deprecated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_instance_id_key` ON `instances` (`instance_id`);--> statement-breakpoint
CREATE INDEX `instances_created_by_id_idx` ON `instances` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `instances_updated_by_id_idx` ON `instances` (`updated_by_id`);