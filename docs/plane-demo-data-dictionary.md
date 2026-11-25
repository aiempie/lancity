# Từ điển dữ liệu Plane Demo

[Xem ERD và phương án Lancity trên D1](./plane-demo-erd.md)

Nguồn là schema `public` sau khi chạy toàn bộ migration của checkout `da21a8ff8b` trên một PostgreSQL 17 tạm. Có **110 bảng, 1.476 cột và 474 khóa ngoại**. Tên cột, kiểu dữ liệu và ràng buộc được đối chiếu với trạng thái migration Django. Phạm vi là cấu trúc database và bảng phụ do Django tạo, không gồm dữ liệu từng bản cài đặt.

## Cách đọc

- **NULL** ghi khả năng nhận SQL NULL. `PK` trong cột ghi chú là khóa chính. `IDENTITY` là cột số do PostgreSQL cấp.
- **Tham chiếu** ghi khóa ngoại và hành vi xóa theo model Django. Các FK thực tế trong PostgreSQL dùng `DEFERRABLE INITIALLY DEFERRED` và hành động `NO ACTION` mặc định của SQL. Django thực hiện `CASCADE` hay `SET_NULL` ở tầng ORM khi xóa qua model. Xóa mềm thường cập nhật `deleted_at`.
- **Ghi chú** có default và các lựa chọn Django nếu được khai báo. Giá trị default thường được gán ở ứng dụng. `auto_now_add` gán lúc tạo, `auto_now` cập nhật khi Django lưu. Lựa chọn trong model là quy tắc ứng dụng trừ khi có `CHECK` tương ứng.
- **Ràng buộc và chỉ mục** liệt kê UNIQUE, CHECK, chỉ mục B-tree có điều kiện và các chỉ mục khác. Các B-tree đơn tiêu chuẩn được gộp theo cột. PostgreSQL tự tạo B-tree phục vụ PK và UNIQUE.

## Danh mục

- [Danh tính và thiết bị](#danh-tinh-va-thiet-bi) · 7 bảng
- [Workspace và project](#workspace-va-project) · 14 bảng
- [Issue và cộng tác](#issue-va-cong-tac) · 19 bảng
- [Lập kế hoạch và intake](#lap-ke-hoach-va-intake) · 19 bảng
- [Tài liệu, tệp và chia sẻ](#tai-lieu-tep-va-chia-se) · 11 bảng
- [Tùy chọn và thông báo](#tuy-chon-va-thong-bao) · 8 bảng
- [Tích hợp và nhập xuất](#tich-hop-va-nhap-xuat) · 14 bảng
- [Quản trị instance](#quan-tri-instance) · 4 bảng
- [Hạ tầng Django và Celery](#ha-tang-django-va-celery) · 14 bảng

<a name="danh-tinh-va-thiet-bi"></a>

## Danh tính và thiết bị

[users](#users) · [profiles](#profiles) · [accounts](#accounts) · [sessions](#sessions) · [devices](#devices) · [device_sessions](#device_sessions) · [social_login_connections](#social_login_connections)

### users

Danh tính người dùng, thông tin đăng nhập và liên kết ảnh đại diện.

| Cột                          | Kiểu PostgreSQL            | NULL  | Tham chiếu                                    | Ghi chú                                       |
| ---------------------------- | -------------------------- | ----- | --------------------------------------------- | --------------------------------------------- |
| `password`                   | `varchar(128)`             | Không | —                                             | —                                             |
| `last_login`                 | `timestamp with time zone` | Có    | —                                             | —                                             |
| `id`                         | `uuid`                     | Không | —                                             | PK · Django mặc định `uuid.uuid4()`           |
| `username`                   | `varchar(128)`             | Không | —                                             | —                                             |
| `mobile_number`              | `varchar(255)`             | Có    | —                                             | —                                             |
| `email`                      | `varchar(255)`             | Có    | —                                             | —                                             |
| `first_name`                 | `varchar(255)`             | Không | —                                             | —                                             |
| `last_name`                  | `varchar(255)`             | Không | —                                             | —                                             |
| `avatar`                     | `text`                     | Không | —                                             | —                                             |
| `date_joined`                | `timestamp with time zone` | Không | —                                             | `auto_now_add`                                |
| `created_at`                 | `timestamp with time zone` | Không | —                                             | `auto_now_add`                                |
| `updated_at`                 | `timestamp with time zone` | Không | —                                             | `auto_now`                                    |
| `last_location`              | `varchar(255)`             | Không | —                                             | —                                             |
| `created_location`           | `varchar(255)`             | Không | —                                             | —                                             |
| `is_superuser`               | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `is_managed`                 | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `is_password_expired`        | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `is_active`                  | `boolean`                  | Không | —                                             | Django mặc định `true`                        |
| `is_staff`                   | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `is_email_verified`          | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `is_password_autoset`        | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `token`                      | `varchar(64)`              | Không | —                                             | —                                             |
| `user_timezone`              | `varchar(255)`             | Không | —                                             | Django mặc định `"UTC"` · 433 lựa chọn        |
| `last_active`                | `timestamp with time zone` | Có    | —                                             | Django mặc định `django.utils.timezone.now()` |
| `last_login_time`            | `timestamp with time zone` | Có    | —                                             | —                                             |
| `last_logout_time`           | `timestamp with time zone` | Có    | —                                             | —                                             |
| `last_login_ip`              | `varchar(255)`             | Không | —                                             | —                                             |
| `last_logout_ip`             | `varchar(255)`             | Không | —                                             | —                                             |
| `last_login_medium`          | `varchar(20)`              | Không | —                                             | Django mặc định `"email"`                     |
| `last_login_uagent`          | `text`                     | Không | —                                             | —                                             |
| `token_updated_at`           | `timestamp with time zone` | Có    | —                                             | —                                             |
| `is_bot`                     | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `cover_image`                | `varchar(800)`             | Có    | —                                             | —                                             |
| `display_name`               | `varchar(255)`             | Không | —                                             | Django mặc định `""`                          |
| `avatar_asset_id`            | `uuid`                     | Có    | [file_assets](#file_assets).`id` · `SET_NULL` | —                                             |
| `cover_image_asset_id`       | `uuid`                     | Có    | [file_assets](#file_assets).`id` · `SET_NULL` | —                                             |
| `bot_type`                   | `varchar(30)`              | Có    | —                                             | —                                             |
| `is_email_valid`             | `boolean`                  | Không | —                                             | Django mặc định `false`                       |
| `masked_at`                  | `timestamp with time zone` | Có    | —                                             | —                                             |
| `is_password_reset_required` | `boolean`                  | Không | —                                             | Django mặc định `false`                       |

**Ràng buộc và chỉ mục**

- UNIQUE `user_email_key` · `(email)`
- UNIQUE `user_username_key` · `(username)`
- B-tree đơn · `avatar_asset_id`, `cover_image_asset_id`
- INDEX `user_email_54dc62b2_like` · `btree (email varchar_pattern_ops)`
- INDEX `user_username_cf016618_like` · `btree (username varchar_pattern_ops)`

**Quan hệ nhiều–nhiều trong Django**

- `groups` qua [users_groups](#users_groups).
- `user_permissions` qua [users_user_permissions](#users_user_permissions).

### profiles

Hồ sơ mở rộng, ngôn ngữ và tùy chọn cá nhân.

| Cột                            | Kiểu PostgreSQL            | NULL  | Tham chiếu                       | Ghi chú                                                                |
| ------------------------------ | -------------------------- | ----- | -------------------------------- | ---------------------------------------------------------------------- |
| `created_at`                   | `timestamp with time zone` | Không | —                                | `auto_now_add`                                                         |
| `updated_at`                   | `timestamp with time zone` | Không | —                                | `auto_now`                                                             |
| `id`                           | `uuid`                     | Không | —                                | PK · Django mặc định `uuid.uuid4()`                                    |
| `theme`                        | `jsonb`                    | Không | —                                | Django mặc định `{}`                                                   |
| `is_tour_completed`            | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `onboarding_step`              | `jsonb`                    | Không | —                                | Django mặc định `plane.db.models.user.get_default_onboarding()`        |
| `use_case`                     | `text`                     | Có    | —                                | —                                                                      |
| `role`                         | `varchar(300)`             | Có    | —                                | —                                                                      |
| `is_onboarded`                 | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `last_workspace_id`            | `uuid`                     | Có    | —                                | —                                                                      |
| `billing_address_country`      | `varchar(255)`             | Không | —                                | Django mặc định `"INDIA"`                                              |
| `billing_address`              | `jsonb`                    | Có    | —                                | —                                                                      |
| `has_billing_address`          | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `company_name`                 | `varchar(255)`             | Không | —                                | —                                                                      |
| `user_id`                      | `uuid`                     | Không | [users](#users).`id` · `CASCADE` | —                                                                      |
| `is_mobile_onboarded`          | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `mobile_onboarding_step`       | `jsonb`                    | Không | —                                | Django mặc định `plane.db.models.user.get_mobile_default_onboarding()` |
| `mobile_timezone_auto_set`     | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `language`                     | `varchar(255)`             | Không | —                                | Django mặc định `"en"`                                                 |
| `is_smooth_cursor_enabled`     | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `start_of_the_week`            | `smallint`                 | Không | —                                | Django mặc định `0` · Giá trị `0`, `1`, `2`, `3`, `4`, `5`, `6`        |
| `is_app_rail_docked`           | `boolean`                  | Không | —                                | Django mặc định `true`                                                 |
| `background_color`             | `varchar(255)`             | Không | —                                | Django mặc định `plane.utils.color.get_random_color()`                 |
| `goals`                        | `jsonb`                    | Không | —                                | Django mặc định `{}`                                                   |
| `has_marketing_email_consent`  | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `is_navigation_tour_completed` | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `is_subscribed_to_changelog`   | `boolean`                  | Không | —                                | Django mặc định `false`                                                |
| `notification_view_mode`       | `varchar(255)`             | Không | —                                | Django mặc định `"full"` · Giá trị `"full"`, `"compact"`               |
| `product_tour`                 | `jsonb`                    | Không | —                                | Django mặc định `plane.db.models.user.get_default_product_tour()`      |

**Ràng buộc và chỉ mục**

- UNIQUE `profiles_user_id_key` · `(user_id)`
- `profiles_start_of_the_week_check` · `CHECK ((start_of_the_week >= 0))`

### accounts

Tài khoản đã liên kết tại nhà cung cấp danh tính.

| Cột                        | Kiểu PostgreSQL            | NULL  | Tham chiếu                       | Ghi chú                                       |
| -------------------------- | -------------------------- | ----- | -------------------------------- | --------------------------------------------- |
| `created_at`               | `timestamp with time zone` | Không | —                                | `auto_now_add`                                |
| `updated_at`               | `timestamp with time zone` | Không | —                                | `auto_now`                                    |
| `id`                       | `uuid`                     | Không | —                                | PK · Django mặc định `uuid.uuid4()`           |
| `provider_account_id`      | `varchar(255)`             | Không | —                                | —                                             |
| `provider`                 | `varchar`                  | Không | —                                | Giá trị `"google"`, `"github"`, `"gitlab"`    |
| `access_token`             | `text`                     | Không | —                                | —                                             |
| `access_token_expired_at`  | `timestamp with time zone` | Có    | —                                | —                                             |
| `refresh_token`            | `text`                     | Có    | —                                | —                                             |
| `refresh_token_expired_at` | `timestamp with time zone` | Có    | —                                | —                                             |
| `last_connected_at`        | `timestamp with time zone` | Không | —                                | Django mặc định `django.utils.timezone.now()` |
| `metadata`                 | `jsonb`                    | Không | —                                | Django mặc định `{}`                          |
| `user_id`                  | `uuid`                     | Không | [users](#users).`id` · `CASCADE` | —                                             |
| `id_token`                 | `text`                     | Không | —                                | —                                             |

**Ràng buộc và chỉ mục**

- UNIQUE `accounts_provider_provider_account_id_daac1f10_uniq` · `(provider, provider_account_id)`
- B-tree đơn · `user_id`

### sessions

Phiên của backend xác thực Plane.

| Cột            | Kiểu PostgreSQL            | NULL  | Tham chiếu | Ghi chú                |
| -------------- | -------------------------- | ----- | ---------- | ---------------------- |
| `session_data` | `text`                     | Không | —          | —                      |
| `expire_date`  | `timestamp with time zone` | Không | —          | —                      |
| `device_info`  | `jsonb`                    | Có    | —          | Django mặc định `null` |
| `session_key`  | `varchar(128)`             | Không | —          | PK                     |
| `user_id`      | `varchar(50)`              | Có    | —          | —                      |

**Ràng buộc và chỉ mục**

- B-tree đơn · `expire_date`, `user_id`
- INDEX `sessions_session_key_58f9471b_like` · `btree (session_key varchar_pattern_ops)`
- INDEX `sessions_user_id_05e26f4a_like` · `btree (user_id varchar_pattern_ops)`

### devices

Thiết bị hoặc trình duyệt của người dùng.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                                            |
| --------------- | -------------------------- | ----- | --------------------------------- | -------------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                 | `auto_now_add`                                     |
| `updated_at`    | `timestamp with time zone` | Không | —                                 | `auto_now`                                         |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                 | —                                                  |
| `id`            | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()`                |
| `device_id`     | `varchar(255)`             | Có    | —                                 | —                                                  |
| `device_type`   | `varchar(255)`             | Không | —                                 | Giá trị `"ANDROID"`, `"IOS"`, `"WEB"`, `"DESKTOP"` |
| `push_token`    | `varchar(255)`             | Có    | —                                 | —                                                  |
| `is_active`     | `boolean`                  | Không | —                                 | Django mặc định `true`                             |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                                  |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                                  |
| `user_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`  | —                                                  |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `updated_by_id`, `user_id`

### device_sessions

Phiên được ghi nhận theo thiết bị.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                      | Ghi chú                             |
| --------------- | -------------------------- | ----- | ----------------------------------------------- | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                               | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                               | `auto_now`                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                               | —                                   |
| `id`            | `uuid`                     | Không | —                                               | PK · Django mặc định `uuid.uuid4()` |
| `is_active`     | `boolean`                  | Không | —                                               | Django mặc định `true`              |
| `user_agent`    | `varchar(255)`             | Có    | —                                               | —                                   |
| `ip_address`    | `inet`                     | Có    | —                                               | —                                   |
| `start_time`    | `timestamp with time zone` | Không | —                                               | `auto_now_add`                      |
| `end_time`      | `timestamp with time zone` | Có    | —                                               | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`               | —                                   |
| `device_id`     | `uuid`                     | Không | [devices](#devices).`id` · `CASCADE`            | —                                   |
| `session_id`    | `varchar(128)`             | Không | [sessions](#sessions).`session_key` · `CASCADE` | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`               | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `device_id`, `session_id`, `updated_by_id`
- INDEX `device_sessions_session_id_5382b02b_like` · `btree (session_id varchar_pattern_ops)`

### social_login_connections

Kết nối đến dịch vụ đăng nhập xã hội.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                                                                       |
| ------------------ | -------------------------- | ----- | --------------------------------- | ----------------------------------------------------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                 | `auto_now_add`                                                                |
| `updated_at`       | `timestamp with time zone` | Không | —                                 | `auto_now`                                                                    |
| `id`               | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()`                                           |
| `medium`           | `varchar(20)`              | Không | —                                 | Django mặc định `null` · Giá trị `"Google"`, `"Github"`, `"GitLab"`, `"Jira"` |
| `last_login_at`    | `timestamp with time zone` | Có    | —                                 | Django mặc định `django.utils.timezone.now()`                                 |
| `last_received_at` | `timestamp with time zone` | Có    | —                                 | Django mặc định `django.utils.timezone.now()`                                 |
| `token_data`       | `jsonb`                    | Có    | —                                 | —                                                                             |
| `extra_data`       | `jsonb`                    | Có    | —                                 | —                                                                             |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                                                             |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                                                             |
| `user_id`          | `uuid`                     | Không | [users](#users).`id` · `CASCADE`  | —                                                                             |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                 | —                                                                             |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `updated_by_id`, `user_id`

<a name="workspace-va-project"></a>

## Workspace và project

[workspaces](#workspaces) · [workspace_members](#workspace_members) · [workspace_member_invites](#workspace_member_invites) · [teams](#teams) · [workspace_themes](#workspace_themes) · [workspace_user_properties](#workspace_user_properties) · [workspace_user_links](#workspace_user_links) · [workspace_home_preferences](#workspace_home_preferences) · [workspace_user_preferences](#workspace_user_preferences) · [projects](#projects) · [project_identifiers](#project_identifiers) · [project_members](#project_members) · [project_member_invites](#project_member_invites) · [project_user_properties](#project_user_properties)

### workspaces

Không gian làm việc chứa project.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                    | Ghi chú                                                |
| ------------------- | -------------------------- | ----- | --------------------------------------------- | ------------------------------------------------------ |
| `created_at`        | `timestamp with time zone` | Không | —                                             | `auto_now_add`                                         |
| `updated_at`        | `timestamp with time zone` | Không | —                                             | `auto_now`                                             |
| `id`                | `uuid`                     | Không | —                                             | PK · Django mặc định `uuid.uuid4()`                    |
| `name`              | `varchar(80)`              | Không | —                                             | —                                                      |
| `logo`              | `text`                     | Có    | —                                             | —                                                      |
| `slug`              | `varchar(48)`              | Không | —                                             | —                                                      |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`             | —                                                      |
| `owner_id`          | `uuid`                     | Không | [users](#users).`id` · `CASCADE`              | —                                                      |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`             | —                                                      |
| `organization_size` | `varchar(20)`              | Có    | —                                             | —                                                      |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                             | —                                                      |
| `logo_asset_id`     | `uuid`                     | Có    | [file_assets](#file_assets).`id` · `SET_NULL` | —                                                      |
| `timezone`          | `varchar(255)`             | Không | —                                             | Django mặc định `"UTC"` · 433 lựa chọn                 |
| `background_color`  | `varchar(255)`             | Không | —                                             | Django mặc định `plane.utils.color.get_random_color()` |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_slug_key` · `(slug)`
- B-tree đơn · `created_by_id`, `logo_asset_id`, `owner_id`, `updated_by_id`
- INDEX `workspace_slug_4d89d459_like` · `btree (slug varchar_pattern_ops)`

### workspace_members

Vai trò và trạng thái thành viên workspace.

| Cột                         | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                         |
| --------------------------- | -------------------------- | ----- | ------------------------------------------ | --------------------------------------------------------------- |
| `created_at`                | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                  |
| `updated_at`                | `timestamp with time zone` | Không | —                                          | `auto_now`                                                      |
| `id`                        | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                             |
| `role`                      | `smallint`                 | Không | —                                          | Django mặc định `5` · Giá trị `20`, `15`, `5`                   |
| `created_by_id`             | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                               |
| `member_id`                 | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                               |
| `updated_by_id`             | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                               |
| `workspace_id`              | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                               |
| `company_role`              | `text`                     | Có    | —                                          | —                                                               |
| `view_props`                | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.workspace.get_default_props()` |
| `default_props`             | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.workspace.get_default_props()` |
| `issue_props`               | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.workspace.get_issue_props()`   |
| `is_active`                 | `boolean`                  | Không | —                                          | Django mặc định `true`                                          |
| `deleted_at`                | `timestamp with time zone` | Có    | —                                          | —                                                               |
| `explored_features`         | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                            |
| `getting_started_checklist` | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                            |
| `tips`                      | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                            |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_members_workspace_id_member_id_d_d7bfa872_uniq` · `(workspace_id, member_id, deleted_at)`
- `workspace_member_role_check` · `CHECK ((role >= 0))`
- B-tree đơn · `created_by_id`, `member_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `workspace_member_unique_workspace_member_when_deleted_at_null` · `btree (workspace_id, member_id) WHERE (deleted_at IS NULL)`

### workspace_member_invites

Lời mời vào workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                       |
| --------------- | -------------------------- | ----- | ------------------------------------------ | --------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                    |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`           |
| `email`         | `varchar(255)`             | Không | —                                          | —                                             |
| `accepted`      | `boolean`                  | Không | —                                          | Django mặc định `false`                       |
| `token`         | `varchar(255)`             | Không | —                                          | —                                             |
| `message`       | `text`                     | Có    | —                                          | —                                             |
| `responded_at`  | `timestamp with time zone` | Có    | —                                          | —                                             |
| `role`          | `smallint`                 | Không | —                                          | Django mặc định `5` · Giá trị `20`, `15`, `5` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                             |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                             |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_member_invites_email_workspace_id_delet_2f03573e_uniq` · `(email, workspace_id, deleted_at)`
- `workspace_member_invite_role_check` · `CHECK ((role >= 0))`
- B-tree đơn · `created_by_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `workspace_member_invite_unique_email_workspace_when_deleted_at_` · `btree (email, workspace_id) WHERE (deleted_at IS NULL)`

### teams

Nhóm trong workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`          | `varchar(255)`             | Không | —                                          | —                                   |
| `description`   | `text`                     | Không | —                                          | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `logo_props`    | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `teams_name_workspace_id_deleted_at_4b131aa2_uniq` · `(name, workspace_id, deleted_at)`
- B-tree đơn · `created_by_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `team_unique_name_workspace_when_deleted_at_null` · `btree (name, workspace_id) WHERE (deleted_at IS NULL)`

### workspace_themes

Chủ đề giao diện trong workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`          | `varchar(300)`             | Không | —                                          | —                                   |
| `colors`        | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `actor_id`      | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_themes_workspace_id_name_deleted_at_b536ffd3_uniq` · `(workspace_id, name, deleted_at)`
- B-tree đơn · `actor_id`, `created_by_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `workspace_theme_unique_workspace_name_when_deleted_at_null` · `btree (workspace_id, name) WHERE (deleted_at IS NULL)`

### workspace_user_properties

Cấu hình và trạng thái cá nhân hóa workspace.

| Cột                             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                      |
| ------------------------------- | -------------------------- | ----- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `created_at`                    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                               |
| `updated_at`                    | `timestamp with time zone` | Không | —                                          | `auto_now`                                                                   |
| `id`                            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                          |
| `filters`                       | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.workspace.get_default_filters()`            |
| `display_filters`               | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.workspace.get_default_display_filters()`    |
| `display_properties`            | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.workspace.get_default_display_properties()` |
| `created_by_id`                 | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                            |
| `updated_by_id`                 | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                            |
| `user_id`                       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                            |
| `workspace_id`                  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                            |
| `deleted_at`                    | `timestamp with time zone` | Có    | —                                          | —                                                                            |
| `rich_filters`                  | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                         |
| `navigation_control_preference` | `varchar(25)`              | Không | —                                          | Django mặc định `"ACCORDION"` · Giá trị `"ACCORDION"`, `"TABBED"`            |
| `navigation_project_limit`      | `integer`                  | Không | —                                          | Django mặc định `10`                                                         |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_user_propertie_workspace_id_user_id_del_a7cf15bc_uniq` · `(workspace_id, user_id, deleted_at)`
- B-tree đơn · `created_by_id`, `updated_by_id`, `user_id`, `workspace_id`
- UNIQUE INDEX `workspace_user_properties_unique_workspace_user_when_deleted_at` · `btree (workspace_id, user_id) WHERE (deleted_at IS NULL)`

### workspace_user_links

Liên kết do người dùng lưu trong workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `title`         | `varchar(255)`             | Có    | —                                          | —                                   |
| `url`           | `text`                     | Không | —                                          | —                                   |
| `metadata`      | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `owner_id`      | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `project_id`    | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `owner_id`, `project_id`, `updated_by_id`, `workspace_id`

### workspace_home_preferences

Cấu hình trang home của người dùng theo workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `key`           | `varchar(255)`             | Không | —                                          | —                                   |
| `is_enabled`    | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `config`        | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `user_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `sort_order`    | `double precision`         | Không | —                                          | Django mặc định `65535`             |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_home_preferenc_workspace_id_user_id_key_75ea36d3_uniq` · `(workspace_id, user_id, key, deleted_at)`
- B-tree đơn · `created_by_id`, `updated_by_id`, `user_id`, `workspace_id`
- UNIQUE INDEX `workspace_user_home_preferences_unique_workspace_user_key_when_` · `btree (workspace_id, user_id, key) WHERE (deleted_at IS NULL)`

### workspace_user_preferences

Tùy chọn theo khóa của người dùng trong workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `key`           | `varchar(255)`             | Không | —                                          | —                                   |
| `is_pinned`     | `boolean`                  | Không | —                                          | Django mặc định `false`             |
| `sort_order`    | `double precision`         | Không | —                                          | Django mặc định `65535`             |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `user_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_user_preferenc_workspace_id_user_id_key_79341493_uniq` · `(workspace_id, user_id, key, deleted_at)`
- B-tree đơn · `created_by_id`, `updated_by_id`, `user_id`, `workspace_id`
- UNIQUE INDEX `workspace_user_preferences_unique_workspace_user_key_when_delet` · `btree (workspace_id, user_id, key) WHERE (deleted_at IS NULL)`

### projects

Project và thiết lập nghiệp vụ trong workspace.

| Cột                        | Kiểu PostgreSQL            | NULL  | Tham chiếu                                    | Ghi chú                                |
| -------------------------- | -------------------------- | ----- | --------------------------------------------- | -------------------------------------- |
| `created_at`               | `timestamp with time zone` | Không | —                                             | `auto_now_add`                         |
| `updated_at`               | `timestamp with time zone` | Không | —                                             | `auto_now`                             |
| `id`                       | `uuid`                     | Không | —                                             | PK · Django mặc định `uuid.uuid4()`    |
| `name`                     | `varchar(255)`             | Không | —                                             | —                                      |
| `description`              | `text`                     | Không | —                                             | —                                      |
| `description_text`         | `jsonb`                    | Có    | —                                             | —                                      |
| `description_html`         | `jsonb`                    | Có    | —                                             | —                                      |
| `network`                  | `smallint`                 | Không | —                                             | Django mặc định `2` · Giá trị `0`, `2` |
| `identifier`               | `varchar(12)`              | Không | —                                             | —                                      |
| `created_by_id`            | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`             | —                                      |
| `default_assignee_id`      | `uuid`                     | Có    | [users](#users).`id` · `CASCADE`              | —                                      |
| `project_lead_id`          | `uuid`                     | Có    | [users](#users).`id` · `CASCADE`              | —                                      |
| `updated_by_id`            | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`             | —                                      |
| `workspace_id`             | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`    | —                                      |
| `emoji`                    | `varchar(255)`             | Có    | —                                             | —                                      |
| `cycle_view`               | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `module_view`              | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `cover_image`              | `text`                     | Có    | —                                             | —                                      |
| `issue_views_view`         | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `page_view`                | `boolean`                  | Không | —                                             | Django mặc định `true`                 |
| `estimate_id`              | `uuid`                     | Có    | [estimates](#estimates).`id` · `SET_NULL`     | —                                      |
| `icon_prop`                | `jsonb`                    | Có    | —                                             | —                                      |
| `intake_view`              | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `archive_in`               | `integer`                  | Không | —                                             | Django mặc định `0`                    |
| `close_in`                 | `integer`                  | Không | —                                             | Django mặc định `0`                    |
| `default_state_id`         | `uuid`                     | Có    | [states](#states).`id` · `SET_NULL`           | —                                      |
| `logo_props`               | `jsonb`                    | Không | —                                             | Django mặc định `{}`                   |
| `archived_at`              | `timestamp with time zone` | Có    | —                                             | —                                      |
| `is_time_tracking_enabled` | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `is_issue_type_enabled`    | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `deleted_at`               | `timestamp with time zone` | Có    | —                                             | —                                      |
| `guest_view_all_features`  | `boolean`                  | Không | —                                             | Django mặc định `false`                |
| `timezone`                 | `varchar(255)`             | Không | —                                             | Django mặc định `"UTC"` · 433 lựa chọn |
| `cover_image_asset_id`     | `uuid`                     | Có    | [file_assets](#file_assets).`id` · `SET_NULL` | —                                      |
| `external_id`              | `varchar(255)`             | Có    | —                                             | —                                      |
| `external_source`          | `varchar(255)`             | Có    | —                                             | —                                      |

**Ràng buộc và chỉ mục**

- UNIQUE `projects_identifier_workspace_id_deleted_at_7d2fa8c1_uniq` · `(identifier, workspace_id, deleted_at)`
- UNIQUE `projects_name_workspace_id_deleted_at_c7aa56f7_uniq` · `(name, workspace_id, deleted_at)`
- `project_network_check` · `CHECK ((network >= 0))`
- B-tree đơn · `cover_image_asset_id`, `created_by_id`, `default_assignee_id`, `default_state_id`, `estimate_id`, `identifier`, `project_lead_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `project_unique_identifier_workspace_when_deleted_at_null` · `btree (identifier, workspace_id) WHERE (deleted_at IS NULL)`
- UNIQUE INDEX `project_unique_name_workspace_when_deleted_at_null` · `btree (name, workspace_id) WHERE (deleted_at IS NULL)`
- INDEX `projects_identifier_3267ade8_like` · `btree (identifier varchar_pattern_ops)`

### project_identifiers

Ánh xạ mã định danh đến project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú        |
| --------------- | -------------------------- | ----- | ------------------------------------------ | -------------- |
| `id`            | `bigint`                   | Không | —                                          | PK · IDENTITY  |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add` |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`     |
| `name`          | `varchar(12)`              | Không | —                                          | —              |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —              |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —              |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —              |
| `workspace_id`  | `uuid`                     | Có    | [workspaces](#workspaces).`id` · `CASCADE` | —              |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —              |

**Ràng buộc và chỉ mục**

- UNIQUE `project_identifier_project_id_key` · `(project_id)`
- UNIQUE `project_identifiers_name_workspace_id_deleted_at_d332e701_uniq` · `(name, workspace_id, deleted_at)`
- B-tree đơn · `created_by_id`, `name`, `updated_by_id`, `workspace_id`
- INDEX `project_identifiers_name_6ca8a4b0_like` · `btree (name varchar_pattern_ops)`
- UNIQUE INDEX `unique_name_workspace_when_deleted_at_null` · `btree (name, workspace_id) WHERE (deleted_at IS NULL)`

### project_members

Vai trò và thiết lập riêng của thành viên project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                 |
| `comment`       | `text`                     | Có    | —                                          | —                                                                   |
| `role`          | `smallint`                 | Không | —                                          | Django mặc định `5` · Giá trị `20`, `15`, `5`                       |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                   |
| `member_id`     | `uuid`                     | Có    | [users](#users).`id` · `CASCADE`           | —                                                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                   |
| `view_props`    | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.project.get_default_props()`       |
| `default_props` | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.project.get_default_props()`       |
| `sort_order`    | `double precision`         | Không | —                                          | Django mặc định `65535`                                             |
| `preferences`   | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.project.get_default_preferences()` |
| `is_active`     | `boolean`                  | Không | —                                          | Django mặc định `true`                                              |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `project_members_project_id_member_id_deleted_at_0299122d_uniq` · `(project_id, member_id, deleted_at)`
- `project_member_role_check` · `CHECK ((role >= 0))`
- B-tree đơn · `created_by_id`, `member_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `project_member_unique_project_member_when_deleted_at_null` · `btree (project_id, member_id) WHERE (deleted_at IS NULL)`

### project_member_invites

Lời mời vào project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                       |
| --------------- | -------------------------- | ----- | ------------------------------------------ | --------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                    |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`           |
| `email`         | `varchar(255)`             | Không | —                                          | —                                             |
| `accepted`      | `boolean`                  | Không | —                                          | Django mặc định `false`                       |
| `token`         | `varchar(255)`             | Không | —                                          | —                                             |
| `message`       | `text`                     | Có    | —                                          | —                                             |
| `responded_at`  | `timestamp with time zone` | Có    | —                                          | —                                             |
| `role`          | `smallint`                 | Không | —                                          | Django mặc định `5` · Giá trị `20`, `15`, `5` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                             |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                             |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                             |

**Ràng buộc và chỉ mục**

- `project_member_invite_role_check` · `CHECK ((role >= 0))`
- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### project_user_properties

Bộ lọc, bố cục và thiết lập hiển thị theo người dùng trong project.

| Cột                  | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                  |
| -------------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `created_at`         | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                           |
| `updated_at`         | `timestamp with time zone` | Không | —                                          | `auto_now`                                                               |
| `id`                 | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                      |
| `display_properties` | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.issue.get_default_display_properties()` |
| `created_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                        |
| `project_id`         | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                        |
| `updated_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                        |
| `user_id`            | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                        |
| `workspace_id`       | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                        |
| `display_filters`    | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.issue.get_default_display_filters()`    |
| `filters`            | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.issue.get_default_filters()`            |
| `deleted_at`         | `timestamp with time zone` | Có    | —                                          | —                                                                        |
| `rich_filters`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                     |
| `preferences`        | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.project.get_default_preferences()`      |
| `sort_order`         | `double precision`         | Không | —                                          | Django mặc định `65535`                                                  |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_user_properties_user_id_project_id_delet_2217dce5_uniq` · `(user_id, project_id, deleted_at)`
- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`
- UNIQUE INDEX `project_user_property_unique_user_project_when_deleted_at_null` · `btree (user_id, project_id) WHERE (deleted_at IS NULL)`

<a name="issue-va-cong-tac"></a>

## Issue và cộng tác

[issues](#issues) · [states](#states) · [labels](#labels) · [issue_sequences](#issue_sequences) · [issue_assignees](#issue_assignees) · [issue_labels](#issue_labels) · [issue_relations](#issue_relations) · [issue_blockers](#issue_blockers) · [issue_mentions](#issue_mentions) · [issue_links](#issue_links) · [issue_attachments](#issue_attachments) · [issue_comments](#issue_comments) · [issue_activities](#issue_activities) · [issue_subscribers](#issue_subscribers) · [issue_reactions](#issue_reactions) · [comment_reactions](#comment_reactions) · [issue_votes](#issue_votes) · [issue_versions](#issue_versions) · [issue_description_versions](#issue_description_versions)

### issues

Công việc, trạng thái, nội dung, thứ tự và ngày thực hiện.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                            | Ghi chú                                                                                |
| ---------------------- | -------------------------- | ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                                     | `auto_now_add`                                                                         |
| `updated_at`           | `timestamp with time zone` | Không | —                                                     | `auto_now`                                                                             |
| `id`                   | `uuid`                     | Không | —                                                     | PK · Django mặc định `uuid.uuid4()`                                                    |
| `name`                 | `varchar(255)`             | Không | —                                                     | —                                                                                      |
| `description_json`     | `jsonb`                    | Không | —                                                     | Django mặc định `{}`                                                                   |
| `priority`             | `varchar(30)`              | Không | —                                                     | Django mặc định `"none"` · Giá trị `"urgent"`, `"high"`, `"medium"`, `"low"`, `"none"` |
| `start_date`           | `date`                     | Có    | —                                                     | —                                                                                      |
| `target_date`          | `date`                     | Có    | —                                                     | —                                                                                      |
| `sequence_id`          | `integer`                  | Không | —                                                     | Django mặc định `1`                                                                    |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                                                                      |
| `parent_id`            | `uuid`                     | Có    | [issues](#issues).`id` · `CASCADE`                    | —                                                                                      |
| `project_id`           | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                | —                                                                                      |
| `state_id`             | `uuid`                     | Có    | [states](#states).`id` · `CASCADE`                    | —                                                                                      |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                                                                      |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`            | —                                                                                      |
| `description_html`     | `text`                     | Không | —                                                     | Django mặc định `"<p></p>"`                                                            |
| `description_stripped` | `text`                     | Có    | —                                                     | —                                                                                      |
| `completed_at`         | `timestamp with time zone` | Có    | —                                                     | —                                                                                      |
| `sort_order`           | `double precision`         | Không | —                                                     | Django mặc định `65535`                                                                |
| `point`                | `integer`                  | Có    | —                                                     | —                                                                                      |
| `archived_at`          | `date`                     | Có    | —                                                     | —                                                                                      |
| `is_draft`             | `boolean`                  | Không | —                                                     | Django mặc định `false`                                                                |
| `external_id`          | `varchar(255)`             | Có    | —                                                     | —                                                                                      |
| `external_source`      | `varchar(255)`             | Có    | —                                                     | —                                                                                      |
| `description_binary`   | `bytea`                    | Có    | —                                                     | —                                                                                      |
| `estimate_point_id`    | `uuid`                     | Có    | [estimate_points](#estimate_points).`id` · `SET_NULL` | —                                                                                      |
| `type_id`              | `uuid`                     | Có    | [issue_types](#issue_types).`id` · `SET_NULL`         | —                                                                                      |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                                     | —                                                                                      |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `estimate_point_id`, `parent_id`, `project_id`, `state_id`, `type_id`, `updated_by_id`, `workspace_id`

**Quan hệ nhiều–nhiều trong Django**

- `assignees` qua [issue_assignees](#issue_assignees).
- `labels` qua [issue_labels](#issue_labels).

### states

Trạng thái và nhóm trạng thái theo project.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                                                                 |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                                                                          |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                                                                                                              |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                                                                     |
| `name`            | `varchar(255)`             | Không | —                                          | —                                                                                                                       |
| `description`     | `text`                     | Không | —                                          | —                                                                                                                       |
| `color`           | `varchar(255)`             | Không | —                                          | —                                                                                                                       |
| `slug`            | `varchar(100)`             | Không | —                                          | —                                                                                                                       |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                                                       |
| `project_id`      | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                                                                       |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                                                       |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                                                                       |
| `sequence`        | `double precision`         | Không | —                                          | Django mặc định `65535`                                                                                                 |
| `group`           | `varchar(20)`              | Không | —                                          | Django mặc định `"backlog"` · Giá trị `"backlog"`, `"unstarted"`, `"started"`, `"completed"`, `"cancelled"`, `"triage"` |
| `default`         | `boolean`                  | Không | —                                          | Django mặc định `false`                                                                                                 |
| `external_id`     | `varchar(255)`             | Có    | —                                          | —                                                                                                                       |
| `external_source` | `varchar(255)`             | Có    | —                                          | —                                                                                                                       |
| `is_triage`       | `boolean`                  | Không | —                                          | Django mặc định `false`                                                                                                 |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                                                                                                       |

**Ràng buộc và chỉ mục**

- UNIQUE `states_name_project_id_deleted_at_02f90488_uniq` · `(name, project_id, deleted_at)`
- B-tree đơn · `created_by_id`, `project_id`, `slug`, `updated_by_id`, `workspace_id`
- INDEX `state_slug_bab0af35_like` · `btree (slug varchar_pattern_ops)`
- UNIQUE INDEX `state_unique_name_project_when_deleted_at_null` · `btree (name, project_id) WHERE (deleted_at IS NULL)`

### labels

Nhãn cấp workspace hoặc project, có thể phân cấp.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`            | `varchar(255)`             | Không | —                                          | —                                   |
| `description`     | `text`                     | Không | —                                          | —                                   |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`      | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `parent_id`       | `uuid`                     | Có    | [labels](#labels).`id` · `CASCADE`         | —                                   |
| `color`           | `varchar(255)`             | Không | —                                          | —                                   |
| `sort_order`      | `double precision`         | Không | —                                          | Django mặc định `65535`             |
| `external_id`     | `varchar(255)`             | Có    | —                                          | —                                   |
| `external_source` | `varchar(255)`             | Có    | —                                          | —                                   |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `parent_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `unique_name_when_project_null_and_not_deleted` · `btree (name) WHERE ((deleted_at IS NULL) AND (project_id IS NULL))`
- UNIQUE INDEX `unique_project_name_when_not_deleted` · `btree (project_id, name) WHERE ((deleted_at IS NULL) AND (project_id IS NOT NULL))`

### issue_sequences

Sổ cấp số công việc theo project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `sequence`      | `bigint`                   | Không | —                                          | Django mặc định `1`                 |
| `deleted`       | `boolean`                  | Không | —                                          | Django mặc định `false`             |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Có    | [issues](#issues).`id` · `SET_NULL`        | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- `issue_sequence_sequence_check` · `CHECK ((sequence >= 0))`
- B-tree đơn · `created_by_id`, `issue_id`, `project_id`, `sequence`, `updated_by_id`, `workspace_id`

### issue_assignees

Liên kết công việc và người phụ trách.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `assignee_id`   | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_assignees_issue_id_assignee_id_deleted_at_b2623a0e_uniq` · `(issue_id, assignee_id, deleted_at)`
- B-tree đơn · `assignee_id`, `created_by_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `issue_assignee_unique_issue_assignee_when_deleted_at_null` · `btree (issue_id, assignee_id) WHERE (deleted_at IS NULL)`

### issue_labels

Liên kết công việc và nhãn.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `label_id`      | `uuid`                     | Không | [labels](#labels).`id` · `CASCADE`         | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `issue_id`, `label_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_relations

Quan hệ có loại giữa hai công việc.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ------------------ | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`       | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`               | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `relation_type`    | `varchar(20)`              | Không | —                                          | Django mặc định `"blocked_by"`      |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`         | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`       | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `related_issue_id` | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`     | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_relations_issue_id_related_issue_i_cc724584_uniq` · `(issue_id, related_issue_id, deleted_at)`
- B-tree đơn · `created_by_id`, `issue_id`, `project_id`, `related_issue_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `issue_relation_unique_issue_related_issue_when_deleted_at_null` · `btree (issue_id, related_issue_id) WHERE (deleted_at IS NULL)`

### issue_blockers

Quan hệ chặn giữa hai công việc.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `block_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `blocked_by_id` | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `block_id`, `blocked_by_id`, `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_mentions

Liên kết công việc và người được nhắc đến.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `mention_id`    | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_mentions_issue_id_mention_id_deleted_at_f6ecd6ed_uniq` · `(issue_id, mention_id, deleted_at)`
- B-tree đơn · `created_by_id`, `issue_id`, `mention_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `issue_mention_unique_issue_mention_when_deleted_at_null` · `btree (issue_id, mention_id) WHERE (deleted_at IS NULL)`

### issue_links

Đường dẫn gắn với công việc.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `title`         | `varchar(255)`             | Có    | —                                          | —                                   |
| `url`           | `text`                     | Không | —                                          | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `metadata`      | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_attachments

Tham chiếu tệp đính kèm của công việc.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `attributes`      | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `asset`           | `varchar(100)`             | Không | —                                          | —                                   |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`        | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`      | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `external_id`     | `varchar(255)`             | Có    | —                                          | —                                   |
| `external_source` | `varchar(255)`             | Có    | —                                          | —                                   |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_comments

Bình luận và chuỗi trả lời của công việc.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                                         | Ghi chú                                                           |
| ------------------ | -------------------------- | ----- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                                  | `auto_now_add`                                                    |
| `updated_at`       | `timestamp with time zone` | Không | —                                                  | `auto_now`                                                        |
| `id`               | `uuid`                     | Không | —                                                  | PK · Django mặc định `uuid.uuid4()`                               |
| `comment_stripped` | `text`                     | Không | —                                                  | —                                                                 |
| `attachments`      | `varchar(200)[10]`         | Không | —                                                  | Django mặc định `[]`                                              |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                                                 |
| `issue_id`         | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`                 | —                                                                 |
| `project_id`       | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`             | —                                                                 |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                                                 |
| `workspace_id`     | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`         | —                                                                 |
| `actor_id`         | `uuid`                     | Có    | [users](#users).`id` · `CASCADE`                   | —                                                                 |
| `comment_html`     | `text`                     | Không | —                                                  | Django mặc định `"<p></p>"`                                       |
| `comment_json`     | `jsonb`                    | Không | —                                                  | Django mặc định `{}`                                              |
| `access`           | `varchar(100)`             | Không | —                                                  | Django mặc định `"INTERNAL"` · Giá trị `"INTERNAL"`, `"EXTERNAL"` |
| `external_id`      | `varchar(255)`             | Có    | —                                                  | —                                                                 |
| `external_source`  | `varchar(255)`             | Có    | —                                                  | —                                                                 |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                                  | —                                                                 |
| `edited_at`        | `timestamp with time zone` | Có    | —                                                  | —                                                                 |
| `description_id`   | `uuid`                     | Có    | [descriptions](#descriptions).`id` · `CASCADE`     | —                                                                 |
| `parent_id`        | `uuid`                     | Có    | [issue_comments](#issue_comments).`id` · `CASCADE` | —                                                                 |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_comments_description_id_key` · `(description_id)`
- B-tree đơn · `actor_id`, `created_by_id`, `issue_id`, `parent_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_activities

Nhật ký thay đổi và hành động trên công việc.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                                            | Ghi chú                             |
| ------------------ | -------------------------- | ----- | ----------------------------------------------------- | ----------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                                     | `auto_now_add`                      |
| `updated_at`       | `timestamp with time zone` | Không | —                                                     | `auto_now`                          |
| `id`               | `uuid`                     | Không | —                                                     | PK · Django mặc định `uuid.uuid4()` |
| `verb`             | `varchar(255)`             | Không | —                                                     | Django mặc định `"created"`         |
| `field`            | `varchar(255)`             | Có    | —                                                     | —                                   |
| `old_value`        | `text`                     | Có    | —                                                     | —                                   |
| `new_value`        | `text`                     | Có    | —                                                     | —                                   |
| `comment`          | `text`                     | Không | —                                                     | —                                   |
| `attachments`      | `varchar(200)[10]`         | Không | —                                                     | Django mặc định `[]`                |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                   |
| `issue_id`         | `uuid`                     | Có    | [issues](#issues).`id` · `DO_NOTHING`                 | —                                   |
| `issue_comment_id` | `uuid`                     | Có    | [issue_comments](#issue_comments).`id` · `DO_NOTHING` | —                                   |
| `project_id`       | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                | —                                   |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                   |
| `workspace_id`     | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`            | —                                   |
| `actor_id`         | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                   |
| `new_identifier`   | `uuid`                     | Có    | —                                                     | —                                   |
| `old_identifier`   | `uuid`                     | Có    | —                                                     | —                                   |
| `epoch`            | `double precision`         | Có    | —                                                     | —                                   |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                                     | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `actor_id`, `created_by_id`, `issue_comment_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_subscribers

Người theo dõi công việc.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `subscriber_id` | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_subscribers_issue_id_subscriber_id_d_587dec1a_uniq` · `(issue_id, subscriber_id, deleted_at)`
- B-tree đơn · `created_by_id`, `issue_id`, `project_id`, `subscriber_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `issue_subscriber_unique_issue_subscriber_when_deleted_at_null` · `btree (issue_id, subscriber_id) WHERE (deleted_at IS NULL)`

### issue_reactions

Biểu cảm trên công việc.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `reaction`      | `text`                     | Không | —                                          | —                                   |
| `actor_id`      | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_reactions_issue_id_actor_id_reacti_7da73ced_uniq` · `(issue_id, actor_id, reaction, deleted_at)`
- B-tree đơn · `actor_id`, `created_by_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `issue_reaction_unique_issue_actor_reaction_when_deleted_at_null` · `btree (issue_id, actor_id, reaction) WHERE (deleted_at IS NULL)`

### comment_reactions

Biểu cảm trên bình luận.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                         | Ghi chú                             |
| --------------- | -------------------------- | ----- | -------------------------------------------------- | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                                  | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                                  | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                                  | PK · Django mặc định `uuid.uuid4()` |
| `reaction`      | `text`                     | Không | —                                                  | —                                   |
| `actor_id`      | `uuid`                     | Không | [users](#users).`id` · `CASCADE`                   | —                                   |
| `comment_id`    | `uuid`                     | Không | [issue_comments](#issue_comments).`id` · `CASCADE` | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`             | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`         | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                                  | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `comment_reactions_comment_id_actor_id_reac_24dc2de6_uniq` · `(comment_id, actor_id, reaction, deleted_at)`
- B-tree đơn · `actor_id`, `comment_id`, `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `comment_reaction_unique_comment_actor_reaction_when_deleted_at_` · `btree (comment_id, actor_id, reaction) WHERE (deleted_at IS NULL)`

### issue_votes

Phiếu bầu của người dùng trên công việc.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                 |
| --------------- | -------------------------- | ----- | ------------------------------------------ | --------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                          |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                              |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`     |
| `vote`          | `integer`                  | Không | —                                          | Django mặc định `1` · Giá trị `-1`, `1` |
| `actor_id`      | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                       |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                       |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                       |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                       |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                       |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                       |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                       |

**Ràng buộc và chỉ mục**

- UNIQUE `issue_votes_issue_id_actor_id_deleted_at_886f34e8_uniq` · `(issue_id, actor_id, deleted_at)`
- B-tree đơn · `actor_id`, `created_by_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `issue_vote_unique_issue_actor_when_deleted_at_null` · `btree (issue_id, actor_id) WHERE (deleted_at IS NULL)`

### issue_versions

Ảnh chụp dữ liệu công việc theo phiên bản.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                              | Ghi chú                                                                                |
| ----------------- | -------------------------- | ----- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                                       | `auto_now_add`                                                                         |
| `updated_at`      | `timestamp with time zone` | Không | —                                                       | `auto_now`                                                                             |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                                       | —                                                                                      |
| `id`              | `uuid`                     | Không | —                                                       | PK · Django mặc định `uuid.uuid4()`                                                    |
| `parent`          | `uuid`                     | Có    | —                                                       | —                                                                                      |
| `state`           | `uuid`                     | Có    | —                                                       | —                                                                                      |
| `estimate_point`  | `uuid`                     | Có    | —                                                       | —                                                                                      |
| `name`            | `varchar(255)`             | Không | —                                                       | —                                                                                      |
| `priority`        | `varchar(30)`              | Không | —                                                       | Django mặc định `"none"` · Giá trị `"urgent"`, `"high"`, `"medium"`, `"low"`, `"none"` |
| `start_date`      | `date`                     | Có    | —                                                       | —                                                                                      |
| `target_date`     | `date`                     | Có    | —                                                       | —                                                                                      |
| `sequence_id`     | `integer`                  | Không | —                                                       | Django mặc định `1`                                                                    |
| `sort_order`      | `double precision`         | Không | —                                                       | Django mặc định `65535`                                                                |
| `completed_at`    | `timestamp with time zone` | Có    | —                                                       | —                                                                                      |
| `archived_at`     | `date`                     | Có    | —                                                       | —                                                                                      |
| `is_draft`        | `boolean`                  | Không | —                                                       | Django mặc định `false`                                                                |
| `external_source` | `varchar(255)`             | Có    | —                                                       | —                                                                                      |
| `external_id`     | `varchar(255)`             | Có    | —                                                       | —                                                                                      |
| `type`            | `uuid`                     | Có    | —                                                       | —                                                                                      |
| `last_saved_at`   | `timestamp with time zone` | Không | —                                                       | Django mặc định `django.utils.timezone.now()`                                          |
| `owned_by_id`     | `uuid`                     | Không | [users](#users).`id` · `CASCADE`                        | —                                                                                      |
| `assignees`       | `uuid[]`                   | Không | —                                                       | Django mặc định `[]`                                                                   |
| `labels`          | `uuid[]`                   | Không | —                                                       | Django mặc định `[]`                                                                   |
| `cycle`           | `uuid`                     | Có    | —                                                       | —                                                                                      |
| `modules`         | `uuid[]`                   | Không | —                                                       | Django mặc định `[]`                                                                   |
| `properties`      | `jsonb`                    | Không | —                                                       | Django mặc định `{}`                                                                   |
| `meta`            | `jsonb`                    | Không | —                                                       | Django mặc định `{}`                                                                   |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                       | —                                                                                      |
| `issue_id`        | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`                      | —                                                                                      |
| `project_id`      | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                  | —                                                                                      |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                       | —                                                                                      |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`              | —                                                                                      |
| `activity_id`     | `uuid`                     | Có    | [issue_activities](#issue_activities).`id` · `SET_NULL` | —                                                                                      |

**Ràng buộc và chỉ mục**

- B-tree đơn · `activity_id`, `created_by_id`, `issue_id`, `owned_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_description_versions

Phiên bản nội dung mô tả công việc.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                       |
| ---------------------- | -------------------------- | ----- | ------------------------------------------ | --------------------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                |
| `updated_at`           | `timestamp with time zone` | Không | —                                          | `auto_now`                                    |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                          | —                                             |
| `id`                   | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`           |
| `description_binary`   | `bytea`                    | Có    | —                                          | —                                             |
| `description_html`     | `text`                     | Không | —                                          | Django mặc định `"<p></p>"`                   |
| `description_stripped` | `text`                     | Có    | —                                          | —                                             |
| `description_json`     | `jsonb`                    | Không | —                                          | Django mặc định `{}`                          |
| `last_saved_at`        | `timestamp with time zone` | Không | —                                          | Django mặc định `django.utils.timezone.now()` |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `issue_id`             | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                             |
| `owned_by_id`          | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                             |
| `project_id`           | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                             |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                             |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `issue_id`, `owned_by_id`, `project_id`, `updated_by_id`, `workspace_id`

<a name="lap-ke-hoach-va-intake"></a>

## Lập kế hoạch và intake

[cycles](#cycles) · [cycle_issues](#cycle_issues) · [cycle_user_properties](#cycle_user_properties) · [modules](#modules) · [module_members](#module_members) · [module_issues](#module_issues) · [module_links](#module_links) · [module_user_properties](#module_user_properties) · [estimates](#estimates) · [estimate_points](#estimate_points) · [issue_types](#issue_types) · [project_issue_types](#project_issue_types) · [intakes](#intakes) · [intake_issues](#intake_issues) · [draft_issues](#draft_issues) · [draft_issue_assignees](#draft_issue_assignees) · [draft_issue_labels](#draft_issue_labels) · [draft_issue_modules](#draft_issue_modules) · [draft_issue_cycles](#draft_issue_cycles)

### cycles

Chu kỳ thực hiện theo project.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                |
| ------------------- | -------------------------- | ----- | ------------------------------------------ | -------------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                          | `auto_now_add`                         |
| `updated_at`        | `timestamp with time zone` | Không | —                                          | `auto_now`                             |
| `id`                | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`    |
| `name`              | `varchar(255)`             | Không | —                                          | —                                      |
| `description`       | `text`                     | Không | —                                          | —                                      |
| `start_date`        | `timestamp with time zone` | Có    | —                                          | —                                      |
| `end_date`          | `timestamp with time zone` | Có    | —                                          | —                                      |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                      |
| `owned_by_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                      |
| `project_id`        | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                      |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                      |
| `workspace_id`      | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                      |
| `view_props`        | `jsonb`                    | Không | —                                          | Django mặc định `{}`                   |
| `sort_order`        | `double precision`         | Không | —                                          | Django mặc định `65535`                |
| `external_id`       | `varchar(255)`             | Có    | —                                          | —                                      |
| `external_source`   | `varchar(255)`             | Có    | —                                          | —                                      |
| `progress_snapshot` | `jsonb`                    | Không | —                                          | Django mặc định `{}`                   |
| `archived_at`       | `timestamp with time zone` | Có    | —                                          | —                                      |
| `logo_props`        | `jsonb`                    | Không | —                                          | Django mặc định `{}`                   |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                          | —                                      |
| `timezone`          | `varchar(255)`             | Không | —                                          | Django mặc định `"UTC"` · 433 lựa chọn |
| `version`           | `integer`                  | Không | —                                          | Django mặc định `1`                    |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `owned_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### cycle_issues

Công việc được xếp vào chu kỳ.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `cycle_id`      | `uuid`                     | Không | [cycles](#cycles).`id` · `CASCADE`         | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `cycle_issues_issue_id_cycle_id_deleted_at_93e8fecd_uniq` · `(issue_id, cycle_id, deleted_at)`
- B-tree đơn · `created_by_id`, `cycle_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `cycle_issue_when_deleted_at_null` · `btree (cycle_id, issue_id) WHERE (deleted_at IS NULL)`

### cycle_user_properties

Tùy chọn hiển thị chu kỳ theo người dùng.

| Cột                  | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                  |
| -------------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `created_at`         | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                           |
| `updated_at`         | `timestamp with time zone` | Không | —                                          | `auto_now`                                                               |
| `id`                 | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                      |
| `filters`            | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.cycle.get_default_filters()`            |
| `display_filters`    | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.cycle.get_default_display_filters()`    |
| `display_properties` | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.cycle.get_default_display_properties()` |
| `created_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                        |
| `cycle_id`           | `uuid`                     | Không | [cycles](#cycles).`id` · `CASCADE`         | —                                                                        |
| `project_id`         | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                        |
| `updated_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                        |
| `user_id`            | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                        |
| `workspace_id`       | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                        |
| `deleted_at`         | `timestamp with time zone` | Có    | —                                          | —                                                                        |
| `rich_filters`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                     |

**Ràng buộc và chỉ mục**

- UNIQUE `cycle_user_properties_cycle_id_user_id_deleted_at_fbe00cf4_uniq` · `(cycle_id, user_id, deleted_at)`
- B-tree đơn · `created_by_id`, `cycle_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`
- UNIQUE INDEX `cycle_user_properties_unique_cycle_user_when_deleted_at_null` · `btree (cycle_id, user_id) WHERE (deleted_at IS NULL)`

### modules

Nhóm công việc theo module.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                                                                   |
| ------------------ | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                                                                            |
| `updated_at`       | `timestamp with time zone` | Không | —                                          | `auto_now`                                                                                                                |
| `id`               | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                                                                       |
| `name`             | `varchar(255)`             | Không | —                                          | —                                                                                                                         |
| `description`      | `text`                     | Không | —                                          | —                                                                                                                         |
| `description_text` | `jsonb`                    | Có    | —                                          | —                                                                                                                         |
| `description_html` | `jsonb`                    | Có    | —                                          | —                                                                                                                         |
| `start_date`       | `date`                     | Có    | —                                          | —                                                                                                                         |
| `target_date`      | `date`                     | Có    | —                                          | —                                                                                                                         |
| `status`           | `varchar(20)`              | Không | —                                          | Django mặc định `"planned"` · Giá trị `"backlog"`, `"planned"`, `"in-progress"`, `"paused"`, `"completed"`, `"cancelled"` |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                                                         |
| `lead_id`          | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                                                         |
| `project_id`       | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                                                                         |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                                                         |
| `workspace_id`     | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                                                                         |
| `view_props`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                                                                      |
| `sort_order`       | `double precision`         | Không | —                                          | Django mặc định `65535`                                                                                                   |
| `external_id`      | `varchar(255)`             | Có    | —                                          | —                                                                                                                         |
| `external_source`  | `varchar(255)`             | Có    | —                                          | —                                                                                                                         |
| `archived_at`      | `timestamp with time zone` | Có    | —                                          | —                                                                                                                         |
| `logo_props`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                                                                      |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                          | —                                                                                                                         |

**Ràng buộc và chỉ mục**

- UNIQUE `modules_name_project_id_deleted_at_328e2346_uniq` · `(name, project_id, deleted_at)`
- B-tree đơn · `created_by_id`, `lead_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `module_unique_name_project_when_deleted_at_null` · `btree (name, project_id) WHERE (deleted_at IS NULL)`

**Quan hệ nhiều–nhiều trong Django**

- `members` qua [module_members](#module_members).

### module_members

Thành viên module.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `member_id`     | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `module_id`     | `uuid`                     | Không | [modules](#modules).`id` · `CASCADE`       | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `module_members_module_id_member_id_deleted_at_bb7a6f00_uniq` · `(module_id, member_id, deleted_at)`
- B-tree đơn · `created_by_id`, `member_id`, `module_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `module_member_unique_module_member_when_deleted_at_null` · `btree (module_id, member_id) WHERE (deleted_at IS NULL)`

### module_issues

Công việc thuộc module.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `issue_id`      | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                   |
| `module_id`     | `uuid`                     | Không | [modules](#modules).`id` · `CASCADE`       | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `module_issues_issue_id_module_id_deleted_at_f944f7c9_uniq` · `(issue_id, module_id, deleted_at)`
- B-tree đơn · `created_by_id`, `issue_id`, `module_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `module_issue_unique_issue_module_when_deleted_at_null` · `btree (issue_id, module_id) WHERE (deleted_at IS NULL)`

### module_links

Đường dẫn gắn với module.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `title`         | `varchar(255)`             | Có    | —                                          | —                                   |
| `url`           | `varchar(200)`             | Không | —                                          | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `module_id`     | `uuid`                     | Không | [modules](#modules).`id` · `CASCADE`       | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `metadata`      | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `module_id`, `project_id`, `updated_by_id`, `workspace_id`

### module_user_properties

Tùy chọn hiển thị module theo người dùng.

| Cột                  | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                   |
| -------------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `created_at`         | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                            |
| `updated_at`         | `timestamp with time zone` | Không | —                                          | `auto_now`                                                                |
| `id`                 | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                       |
| `filters`            | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.module.get_default_filters()`            |
| `display_filters`    | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.module.get_default_display_filters()`    |
| `display_properties` | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.module.get_default_display_properties()` |
| `created_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                         |
| `module_id`          | `uuid`                     | Không | [modules](#modules).`id` · `CASCADE`       | —                                                                         |
| `project_id`         | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                         |
| `updated_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                         |
| `user_id`            | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                         |
| `workspace_id`       | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                         |
| `deleted_at`         | `timestamp with time zone` | Có    | —                                          | —                                                                         |
| `rich_filters`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                      |

**Ràng buộc và chỉ mục**

- UNIQUE `module_user_properties_module_id_user_id_delete_3269582d_uniq` · `(module_id, user_id, deleted_at)`
- B-tree đơn · `created_by_id`, `module_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`
- UNIQUE INDEX `module_user_properties_unique_module_user_when_deleted_at_null` · `btree (module_id, user_id) WHERE (deleted_at IS NULL)`

### estimates

Thang ước lượng theo project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                 |
| `name`          | `varchar(255)`             | Không | —                                          | —                                                                   |
| `description`   | `text`                     | Không | —                                          | —                                                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                   |
| `type`          | `varchar(255)`             | Không | —                                          | Django mặc định `"categories"` · Giá trị `"categories"`, `"points"` |
| `last_used`     | `boolean`                  | Không | —                                          | Django mặc định `false`                                             |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `estimates_name_project_id_deleted_at_41d66639_uniq` · `(name, project_id, deleted_at)`
- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `estimate_unique_name_project_when_deleted_at_null` · `btree (name, project_id) WHERE (deleted_at IS NULL)`

### estimate_points

Các mức điểm của thang ước lượng.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `key`           | `integer`                  | Không | —                                          | Django mặc định `0`                 |
| `description`   | `text`                     | Không | —                                          | —                                   |
| `value`         | `varchar(255)`             | Không | —                                          | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `estimate_id`   | `uuid`                     | Không | [estimates](#estimates).`id` · `CASCADE`   | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `estimate_id`, `project_id`, `updated_by_id`, `workspace_id`

### issue_types

Loại công việc do workspace định nghĩa.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`            | `varchar(255)`             | Không | —                                          | —                                   |
| `description`     | `text`                     | Không | —                                          | —                                   |
| `logo_props`      | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `is_active`       | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                   |
| `is_default`      | `boolean`                  | Không | —                                          | Django mặc định `false`             |
| `level`           | `double precision`         | Không | —                                          | Django mặc định `0`                 |
| `external_id`     | `varchar(255)`             | Có    | —                                          | —                                   |
| `external_source` | `varchar(255)`             | Có    | —                                          | —                                   |
| `is_epic`         | `boolean`                  | Không | —                                          | Django mặc định `false`             |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `updated_by_id`, `workspace_id`

### project_issue_types

Loại công việc được dùng trong project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                   | Ghi chú                             |
| --------------- | -------------------------- | ----- | -------------------------------------------- | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                            | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                            | `auto_now`                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                            | —                                   |
| `id`            | `uuid`                     | Không | —                                            | PK · Django mặc định `uuid.uuid4()` |
| `level`         | `integer`                  | Không | —                                            | Django mặc định `0`                 |
| `is_default`    | `boolean`                  | Không | —                                            | Django mặc định `false`             |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`            | —                                   |
| `issue_type_id` | `uuid`                     | Không | [issue_types](#issue_types).`id` · `CASCADE` | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`       | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`            | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`   | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `project_issue_types_project_id_issue_type_id_2287e5dc_uniq` · `(project_id, issue_type_id, deleted_at)`
- `project_issue_types_level_check` · `CHECK ((level >= 0))`
- B-tree đơn · `created_by_id`, `issue_type_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `project_issue_type_unique_project_issue_type_when_deleted_at_nu` · `btree (project_id, issue_type_id) WHERE (deleted_at IS NULL)`

### intakes

Các hàng chờ tiếp nhận theo project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`          | `varchar(255)`             | Không | —                                          | —                                   |
| `description`   | `text`                     | Không | —                                          | —                                   |
| `is_default`    | `boolean`                  | Không | —                                          | Django mặc định `false`             |
| `view_props`    | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `logo_props`    | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `inboxes_name_project_id_deleted_at_95043f72_uniq` · `(name, project_id, deleted_at)`
- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `intake_unique_name_project_when_deleted_at_null` · `btree (name, project_id) WHERE (deleted_at IS NULL)`

### intake_issues

Mục tiếp nhận, trạng thái xử lý và thời gian tạm hoãn.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                  |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | -------------------------------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                           |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                                               |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                      |
| `status`          | `integer`                  | Không | —                                          | Django mặc định `-2` · Giá trị `-2`, `-1`, `0`, `1`, `2` |
| `snoozed_till`    | `timestamp with time zone` | Có    | —                                          | —                                                        |
| `source`          | `varchar(255)`             | Có    | —                                          | Django mặc định `"IN_APP"`                               |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                        |
| `duplicate_to_id` | `uuid`                     | Có    | [issues](#issues).`id` · `SET_NULL`        | —                                                        |
| `intake_id`       | `uuid`                     | Không | [intakes](#intakes).`id` · `CASCADE`       | —                                                        |
| `issue_id`        | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`         | —                                                        |
| `project_id`      | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                        |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                        |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                        |
| `external_id`     | `varchar(255)`             | Có    | —                                          | —                                                        |
| `external_source` | `varchar(255)`             | Có    | —                                          | —                                                        |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                                        |
| `extra`           | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                     |
| `source_email`    | `text`                     | Có    | —                                          | —                                                        |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `duplicate_to_id`, `intake_id`, `issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- INDEX `intake_issue_snoozed_till_idx` · `btree (snoozed_till) WHERE (status = 0)`

### draft_issues

Bản nháp công việc.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                            | Ghi chú                                                                                |
| ---------------------- | -------------------------- | ----- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                                     | `auto_now_add`                                                                         |
| `updated_at`           | `timestamp with time zone` | Không | —                                                     | `auto_now`                                                                             |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                                     | —                                                                                      |
| `id`                   | `uuid`                     | Không | —                                                     | PK · Django mặc định `uuid.uuid4()`                                                    |
| `name`                 | `varchar(255)`             | Có    | —                                                     | —                                                                                      |
| `description_json`     | `jsonb`                    | Không | —                                                     | Django mặc định `{}`                                                                   |
| `description_html`     | `text`                     | Không | —                                                     | Django mặc định `"<p></p>"`                                                            |
| `description_stripped` | `text`                     | Có    | —                                                     | —                                                                                      |
| `description_binary`   | `bytea`                    | Có    | —                                                     | —                                                                                      |
| `priority`             | `varchar(30)`              | Không | —                                                     | Django mặc định `"none"` · Giá trị `"urgent"`, `"high"`, `"medium"`, `"low"`, `"none"` |
| `start_date`           | `date`                     | Có    | —                                                     | —                                                                                      |
| `target_date`          | `date`                     | Có    | —                                                     | —                                                                                      |
| `sort_order`           | `double precision`         | Không | —                                                     | Django mặc định `65535`                                                                |
| `completed_at`         | `timestamp with time zone` | Có    | —                                                     | —                                                                                      |
| `external_source`      | `varchar(255)`             | Có    | —                                                     | —                                                                                      |
| `external_id`          | `varchar(255)`             | Có    | —                                                     | —                                                                                      |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                                                                      |
| `estimate_point_id`    | `uuid`                     | Có    | [estimate_points](#estimate_points).`id` · `SET_NULL` | —                                                                                      |
| `parent_id`            | `uuid`                     | Có    | [issues](#issues).`id` · `CASCADE`                    | —                                                                                      |
| `project_id`           | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`                | —                                                                                      |
| `state_id`             | `uuid`                     | Có    | [states](#states).`id` · `CASCADE`                    | —                                                                                      |
| `type_id`              | `uuid`                     | Có    | [issue_types](#issue_types).`id` · `SET_NULL`         | —                                                                                      |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                     | —                                                                                      |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`            | —                                                                                      |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `estimate_point_id`, `parent_id`, `project_id`, `state_id`, `type_id`, `updated_by_id`, `workspace_id`

**Quan hệ nhiều–nhiều trong Django**

- `assignees` qua [draft_issue_assignees](#draft_issue_assignees).
- `labels` qua [draft_issue_labels](#draft_issue_labels).

### draft_issue_assignees

Người phụ trách của bản nháp.

| Cột              | Kiểu PostgreSQL            | NULL  | Tham chiếu                                     | Ghi chú                             |
| ---------------- | -------------------------- | ----- | ---------------------------------------------- | ----------------------------------- |
| `created_at`     | `timestamp with time zone` | Không | —                                              | `auto_now_add`                      |
| `updated_at`     | `timestamp with time zone` | Không | —                                              | `auto_now`                          |
| `deleted_at`     | `timestamp with time zone` | Có    | —                                              | —                                   |
| `id`             | `uuid`                     | Không | —                                              | PK · Django mặc định `uuid.uuid4()` |
| `assignee_id`    | `uuid`                     | Không | [users](#users).`id` · `CASCADE`               | —                                   |
| `created_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `draft_issue_id` | `uuid`                     | Không | [draft_issues](#draft_issues).`id` · `CASCADE` | —                                   |
| `project_id`     | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`         | —                                   |
| `updated_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `workspace_id`   | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`     | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `draft_issue_assignees_draft_issue_id_assignee__7cd49721_uniq` · `(draft_issue_id, assignee_id, deleted_at)`
- B-tree đơn · `assignee_id`, `created_by_id`, `draft_issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `draft_issue_assignee_unique_issue_assignee_when_deleted_at_null` · `btree (draft_issue_id, assignee_id) WHERE (deleted_at IS NULL)`

### draft_issue_labels

Nhãn của bản nháp.

| Cột              | Kiểu PostgreSQL            | NULL  | Tham chiếu                                     | Ghi chú                             |
| ---------------- | -------------------------- | ----- | ---------------------------------------------- | ----------------------------------- |
| `created_at`     | `timestamp with time zone` | Không | —                                              | `auto_now_add`                      |
| `updated_at`     | `timestamp with time zone` | Không | —                                              | `auto_now`                          |
| `deleted_at`     | `timestamp with time zone` | Có    | —                                              | —                                   |
| `id`             | `uuid`                     | Không | —                                              | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `draft_issue_id` | `uuid`                     | Không | [draft_issues](#draft_issues).`id` · `CASCADE` | —                                   |
| `label_id`       | `uuid`                     | Không | [labels](#labels).`id` · `CASCADE`             | —                                   |
| `project_id`     | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`         | —                                   |
| `updated_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `workspace_id`   | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`     | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `draft_issue_id`, `label_id`, `project_id`, `updated_by_id`, `workspace_id`

### draft_issue_modules

Module gắn với bản nháp.

| Cột              | Kiểu PostgreSQL            | NULL  | Tham chiếu                                     | Ghi chú                             |
| ---------------- | -------------------------- | ----- | ---------------------------------------------- | ----------------------------------- |
| `created_at`     | `timestamp with time zone` | Không | —                                              | `auto_now_add`                      |
| `updated_at`     | `timestamp with time zone` | Không | —                                              | `auto_now`                          |
| `deleted_at`     | `timestamp with time zone` | Có    | —                                              | —                                   |
| `id`             | `uuid`                     | Không | —                                              | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `draft_issue_id` | `uuid`                     | Không | [draft_issues](#draft_issues).`id` · `CASCADE` | —                                   |
| `module_id`      | `uuid`                     | Không | [modules](#modules).`id` · `CASCADE`           | —                                   |
| `project_id`     | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`         | —                                   |
| `updated_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `workspace_id`   | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`     | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `draft_issue_modules_draft_issue_id_module_id_634e1f1a_uniq` · `(draft_issue_id, module_id, deleted_at)`
- B-tree đơn · `created_by_id`, `draft_issue_id`, `module_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `module_draft_issue_unique_issue_module_when_deleted_at_null` · `btree (draft_issue_id, module_id) WHERE (deleted_at IS NULL)`

### draft_issue_cycles

Chu kỳ gắn với bản nháp.

| Cột              | Kiểu PostgreSQL            | NULL  | Tham chiếu                                     | Ghi chú                             |
| ---------------- | -------------------------- | ----- | ---------------------------------------------- | ----------------------------------- |
| `created_at`     | `timestamp with time zone` | Không | —                                              | `auto_now_add`                      |
| `updated_at`     | `timestamp with time zone` | Không | —                                              | `auto_now`                          |
| `deleted_at`     | `timestamp with time zone` | Có    | —                                              | —                                   |
| `id`             | `uuid`                     | Không | —                                              | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `cycle_id`       | `uuid`                     | Không | [cycles](#cycles).`id` · `CASCADE`             | —                                   |
| `draft_issue_id` | `uuid`                     | Không | [draft_issues](#draft_issues).`id` · `CASCADE` | —                                   |
| `project_id`     | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`         | —                                   |
| `updated_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `workspace_id`   | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`     | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `draft_issue_cycles_draft_issue_id_cycle_id__e133e097_uniq` · `(draft_issue_id, cycle_id, deleted_at)`
- B-tree đơn · `created_by_id`, `cycle_id`, `draft_issue_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `draft_issue_cycle_when_deleted_at_null` · `btree (draft_issue_id, cycle_id) WHERE (deleted_at IS NULL)`

<a name="tai-lieu-tep-va-chia-se"></a>

## Tài liệu, tệp và chia sẻ

[pages](#pages) · [page_labels](#page_labels) · [project_pages](#project_pages) · [page_logs](#page_logs) · [page_versions](#page_versions) · [descriptions](#descriptions) · [description_versions](#description_versions) · [file_assets](#file_assets) · [deploy_boards](#deploy_boards) · [project_deploy_boards](#project_deploy_boards) · [project_public_members](#project_public_members)

### pages

Trang tài liệu của workspace, hỗ trợ phân cấp.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                 |
| ---------------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                          |
| `updated_at`           | `timestamp with time zone` | Không | —                                          | `auto_now`                                              |
| `id`                   | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                     |
| `name`                 | `text`                     | Không | —                                          | —                                                       |
| `description_json`     | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                    |
| `description_html`     | `text`                     | Không | —                                          | Django mặc định `"<p></p>"`                             |
| `description_stripped` | `text`                     | Có    | —                                          | —                                                       |
| `access`               | `smallint`                 | Không | —                                          | Django mặc định `0` · Giá trị `0`, `1`                  |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                       |
| `owned_by_id`          | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                       |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                       |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                       |
| `color`                | `varchar(255)`             | Không | —                                          | —                                                       |
| `archived_at`          | `date`                     | Có    | —                                          | —                                                       |
| `is_locked`            | `boolean`                  | Không | —                                          | Django mặc định `false`                                 |
| `parent_id`            | `uuid`                     | Có    | [pages](#pages).`id` · `CASCADE`           | —                                                       |
| `view_props`           | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.page.get_view_props()` |
| `logo_props`           | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                    |
| `description_binary`   | `bytea`                    | Có    | —                                          | —                                                       |
| `is_global`            | `boolean`                  | Không | —                                          | Django mặc định `false`                                 |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                          | —                                                       |
| `moved_to_page`        | `uuid`                     | Có    | —                                          | —                                                       |
| `moved_to_project`     | `uuid`                     | Có    | —                                          | —                                                       |
| `external_id`          | `varchar(255)`             | Có    | —                                          | —                                                       |
| `external_source`      | `varchar(255)`             | Có    | —                                          | —                                                       |
| `sort_order`           | `double precision`         | Không | —                                          | Django mặc định `65535`                                 |

**Ràng buộc và chỉ mục**

- `pages_access_check` · `CHECK ((access >= 0))`
- B-tree đơn · `created_by_id`, `owned_by_id`, `parent_id`, `updated_by_id`, `workspace_id`

**Quan hệ nhiều–nhiều trong Django**

- `labels` qua [page_labels](#page_labels).
- `projects` qua [project_pages](#project_pages).

### page_labels

Liên kết trang tài liệu với nhãn.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `label_id`      | `uuid`                     | Không | [labels](#labels).`id` · `CASCADE`         | —                                   |
| `page_id`       | `uuid`                     | Không | [pages](#pages).`id` · `CASCADE`           | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `label_id`, `page_id`, `updated_by_id`, `workspace_id`

### project_pages

Liên kết trang tài liệu với project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `page_id`       | `uuid`                     | Không | [pages](#pages).`id` · `CASCADE`           | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `project_pages_project_id_page_id_deleted_at_7c80a40c_uniq` · `(project_id, page_id, deleted_at)`
- B-tree đơn · `created_by_id`, `page_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `project_page_unique_project_page_when_deleted_at_null` · `btree (project_id, page_id) WHERE (deleted_at IS NULL)`

### page_logs

Nhật ký giao dịch chỉnh sửa trang.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`        | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`                | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `transaction`       | `uuid`                     | Không | —                                          | Django mặc định `uuid.uuid4()`      |
| `entity_identifier` | `uuid`                     | Có    | —                                          | —                                   |
| `entity_name`       | `varchar(30)`              | Không | —                                          | —                                   |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `page_id`           | `uuid`                     | Không | [pages](#pages).`id` · `CASCADE`           | —                                   |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`      | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                          | —                                   |
| `entity_type`       | `varchar(30)`              | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `page_logs_page_id_transaction_9ab05334_uniq` · `(page_id, transaction)`
- B-tree đơn · `created_by_id`, `page_id`, `updated_by_id`, `workspace_id`
- INDEX `pagelog_entity_id_idx` · `btree (entity_identifier)`
- INDEX `pagelog_entity_name_idx` · `btree (entity_name)`
- INDEX `pagelog_entity_type_idx` · `btree (entity_type)`
- INDEX `pagelog_name_id_idx` · `btree (entity_name, entity_identifier)`
- INDEX `pagelog_type_id_idx` · `btree (entity_type, entity_identifier)`

### page_versions

Ảnh chụp nội dung trang theo phiên bản.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                       |
| ---------------------- | -------------------------- | ----- | ------------------------------------------ | --------------------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                |
| `updated_at`           | `timestamp with time zone` | Không | —                                          | `auto_now`                                    |
| `id`                   | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`           |
| `last_saved_at`        | `timestamp with time zone` | Không | —                                          | Django mặc định `django.utils.timezone.now()` |
| `description_binary`   | `bytea`                    | Có    | —                                          | —                                             |
| `description_html`     | `text`                     | Không | —                                          | Django mặc định `"<p></p>"`                   |
| `description_stripped` | `text`                     | Có    | —                                          | —                                             |
| `description_json`     | `jsonb`                    | Không | —                                          | Django mặc định `{}`                          |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `owned_by_id`          | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                             |
| `page_id`              | `uuid`                     | Không | [pages](#pages).`id` · `CASCADE`           | —                                             |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                             |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                             |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                          | —                                             |
| `sub_pages_data`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                          |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `owned_by_id`, `page_id`, `updated_by_id`, `workspace_id`

### descriptions

Nội dung mô tả dùng bởi thực thể khác.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ---------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`           | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                          | —                                   |
| `id`                   | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `description_json`     | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `description_html`     | `text`                     | Không | —                                          | Django mặc định `"<p></p>"`         |
| `description_binary`   | `bytea`                    | Có    | —                                          | —                                   |
| `description_stripped` | `text`                     | Có    | —                                          | —                                   |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`           | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### description_versions

Các phiên bản của nội dung mô tả.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                     | Ghi chú                             |
| ---------------------- | -------------------------- | ----- | ---------------------------------------------- | ----------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                              | `auto_now_add`                      |
| `updated_at`           | `timestamp with time zone` | Không | —                                              | `auto_now`                          |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                              | —                                   |
| `id`                   | `uuid`                     | Không | —                                              | PK · Django mặc định `uuid.uuid4()` |
| `description_json`     | `jsonb`                    | Không | —                                              | Django mặc định `{}`                |
| `description_html`     | `text`                     | Không | —                                              | Django mặc định `"<p></p>"`         |
| `description_binary`   | `bytea`                    | Có    | —                                              | —                                   |
| `description_stripped` | `text`                     | Có    | —                                              | —                                   |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `description_id`       | `uuid`                     | Không | [descriptions](#descriptions).`id` · `CASCADE` | —                                   |
| `project_id`           | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`         | —                                   |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`     | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `description_id`, `project_id`, `updated_by_id`, `workspace_id`

### file_assets

Metadata tệp, vị trí lưu và tham chiếu đến thực thể sở hữu.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                         | Ghi chú                             |
| ------------------- | -------------------------- | ----- | -------------------------------------------------- | ----------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                                  | `auto_now_add`                      |
| `updated_at`        | `timestamp with time zone` | Không | —                                                  | `auto_now`                          |
| `id`                | `uuid`                     | Không | —                                                  | PK · Django mặc định `uuid.uuid4()` |
| `attributes`        | `jsonb`                    | Không | —                                                  | Django mặc định `{}`                |
| `asset`             | `varchar(800)`             | Không | —                                                  | —                                   |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                   |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                   |
| `workspace_id`      | `uuid`                     | Có    | [workspaces](#workspaces).`id` · `CASCADE`         | —                                   |
| `is_deleted`        | `boolean`                  | Không | —                                                  | Django mặc định `false`             |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                                  | —                                   |
| `is_archived`       | `boolean`                  | Không | —                                                  | Django mặc định `false`             |
| `comment_id`        | `uuid`                     | Có    | [issue_comments](#issue_comments).`id` · `CASCADE` | —                                   |
| `entity_type`       | `varchar(255)`             | Có    | —                                                  | —                                   |
| `external_id`       | `varchar(255)`             | Có    | —                                                  | —                                   |
| `external_source`   | `varchar(255)`             | Có    | —                                                  | —                                   |
| `is_uploaded`       | `boolean`                  | Không | —                                                  | Django mặc định `false`             |
| `issue_id`          | `uuid`                     | Có    | [issues](#issues).`id` · `CASCADE`                 | —                                   |
| `page_id`           | `uuid`                     | Có    | [pages](#pages).`id` · `CASCADE`                   | —                                   |
| `project_id`        | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`             | —                                   |
| `size`              | `double precision`         | Không | —                                                  | Django mặc định `0`                 |
| `storage_metadata`  | `jsonb`                    | Có    | —                                                  | Django mặc định `{}`                |
| `user_id`           | `uuid`                     | Có    | [users](#users).`id` · `CASCADE`                   | —                                   |
| `draft_issue_id`    | `uuid`                     | Có    | [draft_issues](#draft_issues).`id` · `CASCADE`     | —                                   |
| `entity_identifier` | `varchar(255)`             | Có    | —                                                  | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `comment_id`, `created_by_id`, `draft_issue_id`, `issue_id`, `page_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`
- INDEX `asset_asset_idx` · `btree (asset)`
- INDEX `asset_entity_identifier_idx` · `btree (entity_identifier)`
- INDEX `asset_entity_idx` · `btree (entity_type, entity_identifier)`
- INDEX `asset_entity_type_idx` · `btree (entity_type)`

### deploy_boards

Cấu hình bảng công khai cho thực thể trong workspace.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                     |
| ---------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                              |
| `updated_at`           | `timestamp with time zone` | Không | —                                          | `auto_now`                                                  |
| `id`                   | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                         |
| `entity_identifier`    | `uuid`                     | Có    | —                                          | —                                                           |
| `entity_name`          | `varchar(30)`              | Có    | —                                          | —                                                           |
| `anchor`               | `varchar(255)`             | Không | —                                          | Django mặc định `plane.db.models.deploy_board.get_anchor()` |
| `is_comments_enabled`  | `boolean`                  | Không | —                                          | Django mặc định `false`                                     |
| `is_reactions_enabled` | `boolean`                  | Không | —                                          | Django mặc định `false`                                     |
| `is_votes_enabled`     | `boolean`                  | Không | —                                          | Django mặc định `false`                                     |
| `view_props`           | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                        |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                           |
| `intake_id`            | `uuid`                     | Có    | [intakes](#intakes).`id` · `SET_NULL`      | —                                                           |
| `project_id`           | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                                           |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                           |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                           |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                          | —                                                           |
| `is_activity_enabled`  | `boolean`                  | Không | —                                          | Django mặc định `true`                                      |
| `is_disabled`          | `boolean`                  | Không | —                                          | Django mặc định `false`                                     |

**Ràng buộc và chỉ mục**

- UNIQUE `deploy_boards_anchor_key` · `(anchor)`
- UNIQUE `deploy_boards_entity_name_entity_ident_800ce160_uniq` · `(entity_name, entity_identifier, deleted_at)`
- B-tree đơn · `created_by_id`, `intake_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `deploy_board_unique_entity_name_entity_identifier_when_deleted_` · `btree (entity_name, entity_identifier) WHERE (deleted_at IS NULL)`
- INDEX `deploy_boards_anchor_fe87f323_like` · `btree (anchor varchar_pattern_ops)`

### project_deploy_boards

Cấu hình bảng chia sẻ theo project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                       |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                                    |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                           |
| `anchor`        | `varchar(255)`             | Không | —                                          | Django mặc định `plane.db.models.project.get_anchor()`        |
| `comments`      | `boolean`                  | Không | —                                          | Django mặc định `false`                                       |
| `reactions`     | `boolean`                  | Không | —                                          | Django mặc định `false`                                       |
| `votes`         | `boolean`                  | Không | —                                          | Django mặc định `false`                                       |
| `views`         | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.project.get_default_views()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                             |
| `intake_id`     | `uuid`                     | Có    | [intakes](#intakes).`id` · `SET_NULL`      | —                                                             |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                             |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                             |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                             |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                                             |

**Ràng buộc và chỉ mục**

- UNIQUE `project_deploy_boards_anchor_key` · `(anchor)`
- UNIQUE `project_deploy_boards_project_id_anchor_893d365a_uniq` · `(project_id, anchor)`
- B-tree đơn · `created_by_id`, `intake_id`, `project_id`, `updated_by_id`, `workspace_id`
- INDEX `project_deploy_boards_anchor_b61b8817_like` · `btree (anchor varchar_pattern_ops)`

### project_public_members

Người tham gia khu vực công khai của project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `member_id`     | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `project_public_members_project_id_member_id_del_9acd89b5_uniq` · `(project_id, member_id, deleted_at)`
- B-tree đơn · `created_by_id`, `member_id`, `project_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `project_public_member_unique_project_member_when_deleted_at_nul` · `btree (project_id, member_id) WHERE (deleted_at IS NULL)`

<a name="tuy-chon-va-thong-bao"></a>

## Tùy chọn và thông báo

[issue_views](#issue_views) · [analytic_views](#analytic_views) · [user_favorites](#user_favorites) · [user_recent_visits](#user_recent_visits) · [stickies](#stickies) · [notifications](#notifications) · [user_notification_preferences](#user_notification_preferences) · [email_notification_logs](#email_notification_logs)

### issue_views

Bộ lọc và cấu hình hiển thị công việc đã lưu.

| Cột                  | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                 |
| -------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------------------------------------------- |
| `created_at`         | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                          |
| `updated_at`         | `timestamp with time zone` | Không | —                                          | `auto_now`                                                              |
| `id`                 | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                     |
| `name`               | `varchar(255)`             | Không | —                                          | —                                                                       |
| `description`        | `text`                     | Không | —                                          | —                                                                       |
| `query`              | `jsonb`                    | Không | —                                          | —                                                                       |
| `access`             | `smallint`                 | Không | —                                          | Django mặc định `1` · Giá trị `0`, `1`                                  |
| `filters`            | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                    |
| `created_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                       |
| `project_id`         | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                                                       |
| `updated_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                       |
| `workspace_id`       | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                       |
| `display_filters`    | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.view.get_default_display_filters()`    |
| `display_properties` | `jsonb`                    | Không | —                                          | Django mặc định `plane.db.models.view.get_default_display_properties()` |
| `sort_order`         | `double precision`         | Không | —                                          | Django mặc định `65535`                                                 |
| `logo_props`         | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                    |
| `is_locked`          | `boolean`                  | Không | —                                          | Django mặc định `false`                                                 |
| `owned_by_id`        | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                       |
| `deleted_at`         | `timestamp with time zone` | Có    | —                                          | —                                                                       |
| `rich_filters`       | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                    |
| `archived_at`        | `timestamp with time zone` | Có    | —                                          | —                                                                       |

**Ràng buộc và chỉ mục**

- `issue_views_access_check` · `CHECK ((access >= 0))`
- B-tree đơn · `created_by_id`, `owned_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### analytic_views

Định nghĩa chế độ xem phân tích.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`          | `varchar(255)`             | Không | —                                          | —                                   |
| `description`   | `text`                     | Không | —                                          | —                                   |
| `query`         | `jsonb`                    | Không | —                                          | —                                   |
| `query_dict`    | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `updated_by_id`, `workspace_id`

### user_favorites

Mục yêu thích, nhóm yêu thích và thứ tự.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                         | Ghi chú                             |
| ------------------- | -------------------------- | ----- | -------------------------------------------------- | ----------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                                  | `auto_now_add`                      |
| `updated_at`        | `timestamp with time zone` | Không | —                                                  | `auto_now`                          |
| `id`                | `uuid`                     | Không | —                                                  | PK · Django mặc định `uuid.uuid4()` |
| `entity_type`       | `varchar(100)`             | Không | —                                                  | —                                   |
| `entity_identifier` | `uuid`                     | Có    | —                                                  | —                                   |
| `name`              | `varchar(255)`             | Có    | —                                                  | —                                   |
| `is_folder`         | `boolean`                  | Không | —                                                  | Django mặc định `false`             |
| `sequence`          | `double precision`         | Không | —                                                  | Django mặc định `65535`             |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                   |
| `parent_id`         | `uuid`                     | Có    | [user_favorites](#user_favorites).`id` · `CASCADE` | —                                   |
| `project_id`        | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`             | —                                   |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                  | —                                   |
| `user_id`           | `uuid`                     | Không | [users](#users).`id` · `CASCADE`                   | —                                   |
| `workspace_id`      | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`         | —                                   |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                                  | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `user_favorites_entity_type_user_id_enti_22b103ff_uniq` · `(entity_type, user_id, entity_identifier, deleted_at)`
- B-tree đơn · `created_by_id`, `parent_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`
- INDEX `fav_entity_identifier_idx` · `btree (entity_identifier)`
- INDEX `fav_entity_idx` · `btree (entity_type, entity_identifier)`
- INDEX `fav_entity_type_idx` · `btree (entity_type)`
- UNIQUE INDEX `user_favorite_unique_entity_type_entity_identifier_user_when_de` · `btree (entity_type, entity_identifier, user_id) WHERE (deleted_at IS NULL)`

### user_recent_visits

Các thực thể người dùng đã truy cập gần đây.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`        | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`                | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `entity_identifier` | `uuid`                     | Có    | —                                          | —                                   |
| `entity_name`       | `varchar(30)`              | Không | —                                          | —                                   |
| `visited_at`        | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`        | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `user_id`           | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `workspace_id`      | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`

### stickies

Ghi chú cá nhân.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ---------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`           | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                          | —                                   |
| `id`                   | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`                 | `text`                     | Có    | —                                          | —                                   |
| `description`          | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `description_html`     | `text`                     | Không | —                                          | Django mặc định `"<p></p>"`         |
| `description_stripped` | `text`                     | Có    | —                                          | —                                   |
| `description_binary`   | `bytea`                    | Có    | —                                          | —                                   |
| `logo_props`           | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `color`                | `varchar(255)`             | Có    | —                                          | —                                   |
| `background_color`     | `varchar(255)`             | Có    | —                                          | —                                   |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `owner_id`             | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`         | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `sort_order`           | `double precision`         | Không | —                                          | Django mặc định `65535`             |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `owner_id`, `updated_by_id`, `workspace_id`

### notifications

Thông báo và trạng thái nhận, đọc, tạm hoãn.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ------------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`        | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`                | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `data`              | `jsonb`                    | Có    | —                                          | —                                   |
| `entity_identifier` | `uuid`                     | Có    | —                                          | —                                   |
| `entity_name`       | `varchar(255)`             | Không | —                                          | —                                   |
| `title`             | `text`                     | Không | —                                          | —                                   |
| `message`           | `jsonb`                    | Có    | —                                          | —                                   |
| `message_html`      | `text`                     | Không | —                                          | Django mặc định `"<p></p>"`         |
| `message_stripped`  | `text`                     | Có    | —                                          | —                                   |
| `sender`            | `varchar(255)`             | Không | —                                          | —                                   |
| `read_at`           | `timestamp with time zone` | Có    | —                                          | —                                   |
| `snoozed_till`      | `timestamp with time zone` | Có    | —                                          | —                                   |
| `archived_at`       | `timestamp with time zone` | Có    | —                                          | —                                   |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`        | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `receiver_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `triggered_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`      | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `project_id`, `receiver_id`, `triggered_by_id`, `updated_by_id`, `workspace_id`
- INDEX `notif_entity_identifier_idx` · `btree (entity_identifier)`
- INDEX `notif_entity_idx` · `btree (receiver_id, read_at)`
- INDEX `notif_entity_lookup_idx` · `btree (workspace_id, entity_identifier, entity_name)`
- INDEX `notif_entity_name_idx` · `btree (entity_name)`
- INDEX `notif_read_at_idx` · `btree (read_at)`
- INDEX `notif_receiver_entity_idx` · `btree (receiver_id, workspace_id, entity_name, read_at)`
- INDEX `notif_receiver_sender_idx` · `btree (receiver_id, workspace_id, sender)`
- INDEX `notif_receiver_state_idx` · `btree (receiver_id, workspace_id, snoozed_till, archived_at)`
- INDEX `notif_receiver_status_idx` · `btree (receiver_id, workspace_id, read_at, created_at)`

### user_notification_preferences

Tùy chọn nhận thông báo của người dùng.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `property_change` | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `state_change`    | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `comment`         | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `mention`         | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `issue_completed` | `boolean`                  | Không | —                                          | Django mặc định `true`              |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`      | `uuid`                     | Có    | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `user_id`         | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                   |
| `workspace_id`    | `uuid`                     | Có    | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `user_id`, `workspace_id`

### email_notification_logs

Nhật ký thông báo qua email.

| Cột                 | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                             |
| ------------------- | -------------------------- | ----- | --------------------------------- | ----------------------------------- |
| `created_at`        | `timestamp with time zone` | Không | —                                 | `auto_now_add`                      |
| `updated_at`        | `timestamp with time zone` | Không | —                                 | `auto_now`                          |
| `id`                | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()` |
| `entity_identifier` | `uuid`                     | Có    | —                                 | —                                   |
| `entity_name`       | `varchar(255)`             | Không | —                                 | —                                   |
| `data`              | `jsonb`                    | Có    | —                                 | —                                   |
| `processed_at`      | `timestamp with time zone` | Có    | —                                 | —                                   |
| `sent_at`           | `timestamp with time zone` | Có    | —                                 | —                                   |
| `entity`            | `varchar(200)`             | Không | —                                 | —                                   |
| `old_value`         | `varchar(300)`             | Có    | —                                 | —                                   |
| `new_value`         | `varchar(300)`             | Có    | —                                 | —                                   |
| `created_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `receiver_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`  | —                                   |
| `triggered_by_id`   | `uuid`                     | Không | [users](#users).`id` · `CASCADE`  | —                                   |
| `updated_by_id`     | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `deleted_at`        | `timestamp with time zone` | Có    | —                                 | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `receiver_id`, `triggered_by_id`, `updated_by_id`

<a name="tich-hop-va-nhap-xuat"></a>

## Tích hợp và nhập xuất

[integrations](#integrations) · [workspace_integrations](#workspace_integrations) · [github_repositories](#github_repositories) · [github_repository_syncs](#github_repository_syncs) · [github_issue_syncs](#github_issue_syncs) · [github_comment_syncs](#github_comment_syncs) · [slack_project_syncs](#slack_project_syncs) · [webhooks](#webhooks) · [project_webhooks](#project_webhooks) · [webhook_logs](#webhook_logs) · [api_tokens](#api_tokens) · [api_activity_logs](#api_activity_logs) · [importers](#importers) · [exporters](#exporters)

### integrations

Danh mục tích hợp.

| Cột              | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                                |
| ---------------- | -------------------------- | ----- | --------------------------------- | -------------------------------------- |
| `created_at`     | `timestamp with time zone` | Không | —                                 | `auto_now_add`                         |
| `updated_at`     | `timestamp with time zone` | Không | —                                 | `auto_now`                             |
| `id`             | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()`    |
| `title`          | `varchar(400)`             | Không | —                                 | —                                      |
| `provider`       | `varchar(400)`             | Không | —                                 | —                                      |
| `network`        | `integer`                  | Không | —                                 | Django mặc định `1` · Giá trị `1`, `2` |
| `description`    | `jsonb`                    | Không | —                                 | Django mặc định `{}`                   |
| `author`         | `varchar(400)`             | Không | —                                 | —                                      |
| `webhook_url`    | `text`                     | Không | —                                 | —                                      |
| `webhook_secret` | `text`                     | Không | —                                 | —                                      |
| `redirect_url`   | `text`                     | Không | —                                 | —                                      |
| `metadata`       | `jsonb`                    | Không | —                                 | Django mặc định `{}`                   |
| `verified`       | `boolean`                  | Không | —                                 | Django mặc định `false`                |
| `avatar_url`     | `text`                     | Có    | —                                 | —                                      |
| `created_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                      |
| `updated_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                      |
| `deleted_at`     | `timestamp with time zone` | Có    | —                                 | —                                      |

**Ràng buộc và chỉ mục**

- UNIQUE `integrations_provider_key` · `(provider)`
- `integrations_network_check` · `CHECK ((network >= 0))`
- B-tree đơn · `created_by_id`, `updated_by_id`
- INDEX `integrations_provider_6537a106_like` · `btree (provider varchar_pattern_ops)`

### workspace_integrations

Tích hợp đã cấu hình theo workspace.

| Cột              | Kiểu PostgreSQL            | NULL  | Tham chiếu                                     | Ghi chú                             |
| ---------------- | -------------------------- | ----- | ---------------------------------------------- | ----------------------------------- |
| `created_at`     | `timestamp with time zone` | Không | —                                              | `auto_now_add`                      |
| `updated_at`     | `timestamp with time zone` | Không | —                                              | `auto_now`                          |
| `id`             | `uuid`                     | Không | —                                              | PK · Django mặc định `uuid.uuid4()` |
| `metadata`       | `jsonb`                    | Không | —                                              | Django mặc định `{}`                |
| `config`         | `jsonb`                    | Không | —                                              | Django mặc định `{}`                |
| `actor_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`               | —                                   |
| `api_token_id`   | `uuid`                     | Không | [api_tokens](#api_tokens).`id` · `CASCADE`     | —                                   |
| `created_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `integration_id` | `uuid`                     | Không | [integrations](#integrations).`id` · `CASCADE` | —                                   |
| `updated_by_id`  | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`              | —                                   |
| `workspace_id`   | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`     | —                                   |
| `deleted_at`     | `timestamp with time zone` | Có    | —                                              | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `workspace_integrations_workspace_id_integration_fa041c22_uniq` · `(workspace_id, integration_id)`
- B-tree đơn · `actor_id`, `api_token_id`, `created_by_id`, `integration_id`, `updated_by_id`, `workspace_id`

### github_repositories

Kho GitHub liên kết.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `name`          | `varchar(500)`             | Không | —                                          | —                                   |
| `url`           | `varchar(200)`             | Có    | —                                          | —                                   |
| `config`        | `jsonb`                    | Không | —                                          | Django mặc định `{}`                |
| `repository_id` | `bigint`                   | Không | —                                          | —                                   |
| `owner`         | `varchar(500)`             | Không | —                                          | —                                   |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`

### github_repository_syncs

Cấu hình đồng bộ kho GitHub với project.

| Cột                        | Kiểu PostgreSQL            | NULL  | Tham chiếu                                                         | Ghi chú                             |
| -------------------------- | -------------------------- | ----- | ------------------------------------------------------------------ | ----------------------------------- |
| `created_at`               | `timestamp with time zone` | Không | —                                                                  | `auto_now_add`                      |
| `updated_at`               | `timestamp with time zone` | Không | —                                                                  | `auto_now`                          |
| `id`                       | `uuid`                     | Không | —                                                                  | PK · Django mặc định `uuid.uuid4()` |
| `credentials`              | `jsonb`                    | Không | —                                                                  | Django mặc định `{}`                |
| `actor_id`                 | `uuid`                     | Không | [users](#users).`id` · `CASCADE`                                   | —                                   |
| `created_by_id`            | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                                  | —                                   |
| `label_id`                 | `uuid`                     | Có    | [labels](#labels).`id` · `SET_NULL`                                | —                                   |
| `project_id`               | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                             | —                                   |
| `repository_id`            | `uuid`                     | Không | [github_repositories](#github_repositories).`id` · `CASCADE`       | —                                   |
| `updated_by_id`            | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                                  | —                                   |
| `workspace_id`             | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`                         | —                                   |
| `workspace_integration_id` | `uuid`                     | Không | [workspace_integrations](#workspace_integrations).`id` · `CASCADE` | —                                   |
| `deleted_at`               | `timestamp with time zone` | Có    | —                                                                  | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `github_repository_syncs_project_id_repository_id_0f3705e6_uniq` · `(project_id, repository_id)`
- UNIQUE `github_repository_syncs_repository_id_key` · `(repository_id)`
- B-tree đơn · `actor_id`, `created_by_id`, `label_id`, `project_id`, `updated_by_id`, `workspace_id`, `workspace_integration_id`

### github_issue_syncs

Ánh xạ công việc Plane và GitHub issue.

| Cột                  | Kiểu PostgreSQL            | NULL  | Tham chiếu                                                           | Ghi chú                             |
| -------------------- | -------------------------- | ----- | -------------------------------------------------------------------- | ----------------------------------- |
| `created_at`         | `timestamp with time zone` | Không | —                                                                    | `auto_now_add`                      |
| `updated_at`         | `timestamp with time zone` | Không | —                                                                    | `auto_now`                          |
| `id`                 | `uuid`                     | Không | —                                                                    | PK · Django mặc định `uuid.uuid4()` |
| `repo_issue_id`      | `bigint`                   | Không | —                                                                    | —                                   |
| `github_issue_id`    | `bigint`                   | Không | —                                                                    | —                                   |
| `issue_url`          | `varchar(200)`             | Không | —                                                                    | —                                   |
| `created_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                                    | —                                   |
| `issue_id`           | `uuid`                     | Không | [issues](#issues).`id` · `CASCADE`                                   | —                                   |
| `project_id`         | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                               | —                                   |
| `repository_sync_id` | `uuid`                     | Không | [github_repository_syncs](#github_repository_syncs).`id` · `CASCADE` | —                                   |
| `updated_by_id`      | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                                    | —                                   |
| `workspace_id`       | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`                           | —                                   |
| `deleted_at`         | `timestamp with time zone` | Có    | —                                                                    | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `github_issue_syncs_repository_sync_id_issue_id_4b34427e_uniq` · `(repository_sync_id, issue_id)`
- B-tree đơn · `created_by_id`, `issue_id`, `project_id`, `repository_sync_id`, `updated_by_id`, `workspace_id`

### github_comment_syncs

Ánh xạ bình luận Plane và GitHub.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                                 | Ghi chú                             |
| ----------------- | -------------------------- | ----- | ---------------------------------------------------------- | ----------------------------------- |
| `created_at`      | `timestamp with time zone` | Không | —                                                          | `auto_now_add`                      |
| `updated_at`      | `timestamp with time zone` | Không | —                                                          | `auto_now`                          |
| `id`              | `uuid`                     | Không | —                                                          | PK · Django mặc định `uuid.uuid4()` |
| `repo_comment_id` | `bigint`                   | Không | —                                                          | —                                   |
| `comment_id`      | `uuid`                     | Không | [issue_comments](#issue_comments).`id` · `CASCADE`         | —                                   |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                          | —                                   |
| `issue_sync_id`   | `uuid`                     | Không | [github_issue_syncs](#github_issue_syncs).`id` · `CASCADE` | —                                   |
| `project_id`      | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                     | —                                   |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                          | —                                   |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`                 | —                                   |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                                          | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `github_comment_syncs_issue_sync_id_comment_id_38c82e7b_uniq` · `(issue_sync_id, comment_id)`
- B-tree đơn · `comment_id`, `created_by_id`, `issue_sync_id`, `project_id`, `updated_by_id`, `workspace_id`

### slack_project_syncs

Kết nối giữa Slack và project.

| Cột                        | Kiểu PostgreSQL            | NULL  | Tham chiếu                                                         | Ghi chú                             |
| -------------------------- | -------------------------- | ----- | ------------------------------------------------------------------ | ----------------------------------- |
| `created_at`               | `timestamp with time zone` | Không | —                                                                  | `auto_now_add`                      |
| `updated_at`               | `timestamp with time zone` | Không | —                                                                  | `auto_now`                          |
| `id`                       | `uuid`                     | Không | —                                                                  | PK · Django mặc định `uuid.uuid4()` |
| `access_token`             | `varchar(300)`             | Không | —                                                                  | —                                   |
| `scopes`                   | `text`                     | Không | —                                                                  | —                                   |
| `bot_user_id`              | `varchar(50)`              | Không | —                                                                  | —                                   |
| `webhook_url`              | `varchar(1000)`            | Không | —                                                                  | —                                   |
| `data`                     | `jsonb`                    | Không | —                                                                  | Django mặc định `{}`                |
| `team_id`                  | `varchar(30)`              | Không | —                                                                  | —                                   |
| `team_name`                | `varchar(300)`             | Không | —                                                                  | —                                   |
| `created_by_id`            | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                                  | —                                   |
| `project_id`               | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`                             | —                                   |
| `updated_by_id`            | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`                                  | —                                   |
| `workspace_id`             | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE`                         | —                                   |
| `workspace_integration_id` | `uuid`                     | Không | [workspace_integrations](#workspace_integrations).`id` · `CASCADE` | —                                   |
| `deleted_at`               | `timestamp with time zone` | Có    | —                                                                  | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `slack_project_syncs_team_id_project_id_50a144a7_uniq` · `(team_id, project_id)`
- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `workspace_id`, `workspace_integration_id`

### webhooks

Đăng ký webhook của workspace.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                    |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ---------------------------------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                             |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                                 |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                        |
| `url`           | `varchar(1024)`            | Không | —                                          | —                                                          |
| `is_active`     | `boolean`                  | Không | —                                          | Django mặc định `true`                                     |
| `secret_key`    | `varchar(255)`             | Không | —                                          | Django mặc định `plane.db.models.webhook.generate_token()` |
| `project`       | `boolean`                  | Không | —                                          | Django mặc định `false`                                    |
| `issue`         | `boolean`                  | Không | —                                          | Django mặc định `false`                                    |
| `module`        | `boolean`                  | Không | —                                          | Django mặc định `false`                                    |
| `cycle`         | `boolean`                  | Không | —                                          | Django mặc định `false`                                    |
| `issue_comment` | `boolean`                  | Không | —                                          | Django mặc định `false`                                    |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                          |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                          |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                                          |
| `is_internal`   | `boolean`                  | Không | —                                          | Django mặc định `false`                                    |
| `version`       | `varchar(50)`              | Không | —                                          | Django mặc định `"v1"`                                     |

**Ràng buộc và chỉ mục**

- UNIQUE `webhooks_workspace_id_url_deleted_at_ea7a1429_uniq` · `(workspace_id, url, deleted_at)`
- B-tree đơn · `created_by_id`, `updated_by_id`, `workspace_id`
- UNIQUE INDEX `webhook_url_unique_url_when_deleted_at_null` · `btree (workspace_id, url) WHERE (deleted_at IS NULL)`

### project_webhooks

Webhook được gán cho project.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                   |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `project_id`    | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `webhook_id`    | `uuid`                     | Không | [webhooks](#webhooks).`id` · `CASCADE`     | —                                   |
| `workspace_id`  | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `project_webhooks_project_id_webhook_id_deleted_at_dcfdb35d_uniq` · `(project_id, webhook_id, deleted_at)`
- B-tree đơn · `created_by_id`, `project_id`, `updated_by_id`, `webhook_id`, `workspace_id`
- UNIQUE INDEX `project_webhook_unique_project_webhook_when_deleted_at_null` · `btree (project_id, webhook_id) WHERE (deleted_at IS NULL)`

### webhook_logs

Nhật ký gửi webhook và thử lại.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                             |
| ------------------ | -------------------------- | ----- | ------------------------------------------ | ----------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                          | `auto_now_add`                      |
| `updated_at`       | `timestamp with time zone` | Không | —                                          | `auto_now`                          |
| `id`               | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()` |
| `event_type`       | `varchar(255)`             | Có    | —                                          | —                                   |
| `request_method`   | `varchar(10)`              | Có    | —                                          | —                                   |
| `request_headers`  | `text`                     | Có    | —                                          | —                                   |
| `request_body`     | `text`                     | Có    | —                                          | —                                   |
| `response_status`  | `text`                     | Có    | —                                          | —                                   |
| `response_headers` | `text`                     | Có    | —                                          | —                                   |
| `response_body`    | `text`                     | Có    | —                                          | —                                   |
| `retry_count`      | `smallint`                 | Không | —                                          | Django mặc định `0`                 |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                   |
| `webhook`          | `uuid`                     | Không | —                                          | —                                   |
| `workspace_id`     | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                   |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                          | —                                   |

**Ràng buộc và chỉ mục**

- `webhook_logs_retry_count_check` · `CHECK ((retry_count >= 0))`
- B-tree đơn · `created_by_id`, `updated_by_id`, `workspace_id`

### api_tokens

Token API và thông tin hết hạn.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                      |
| --------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------ |
| `created_at`    | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                               |
| `updated_at`    | `timestamp with time zone` | Không | —                                          | `auto_now`                                                   |
| `id`            | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                          |
| `token`         | `varchar(255)`             | Không | —                                          | Django mặc định `plane.db.models.api.generate_token()`       |
| `label`         | `varchar(255)`             | Không | —                                          | Django mặc định `plane.db.models.api.generate_label_token()` |
| `user_type`     | `smallint`                 | Không | —                                          | Django mặc định `0` · Giá trị `0`, `1`                       |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                            |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                            |
| `user_id`       | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                            |
| `workspace_id`  | `uuid`                     | Có    | [workspaces](#workspaces).`id` · `CASCADE` | —                                                            |
| `description`   | `text`                     | Không | —                                          | —                                                            |
| `expired_at`    | `timestamp with time zone` | Có    | —                                          | —                                                            |
| `is_active`     | `boolean`                  | Không | —                                          | Django mặc định `true`                                       |
| `last_used`     | `timestamp with time zone` | Có    | —                                          | —                                                            |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                          | —                                                            |

**Ràng buộc và chỉ mục**

- UNIQUE `api_tokens_token_key` · `(token)`
- `api_tokens_user_type_check` · `CHECK ((user_type >= 0))`
- B-tree đơn · `created_by_id`, `updated_by_id`, `user_id`, `workspace_id`
- INDEX `api_tokens_token_6211101f_like` · `btree (token varchar_pattern_ops)`

### api_activity_logs

Nhật ký sử dụng API.

| Cột                | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                             |
| ------------------ | -------------------------- | ----- | --------------------------------- | ----------------------------------- |
| `created_at`       | `timestamp with time zone` | Không | —                                 | `auto_now_add`                      |
| `updated_at`       | `timestamp with time zone` | Không | —                                 | `auto_now`                          |
| `id`               | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()` |
| `token_identifier` | `varchar(255)`             | Không | —                                 | —                                   |
| `path`             | `varchar(255)`             | Không | —                                 | —                                   |
| `method`           | `varchar(10)`              | Không | —                                 | —                                   |
| `query_params`     | `text`                     | Có    | —                                 | —                                   |
| `headers`          | `text`                     | Có    | —                                 | —                                   |
| `body`             | `text`                     | Có    | —                                 | —                                   |
| `response_code`    | `integer`                  | Không | —                                 | —                                   |
| `response_body`    | `text`                     | Có    | —                                 | —                                   |
| `ip_address`       | `inet`                     | Có    | —                                 | —                                   |
| `user_agent`       | `varchar(512)`             | Có    | —                                 | —                                   |
| `created_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `updated_by_id`    | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `deleted_at`       | `timestamp with time zone` | Có    | —                                 | —                                   |

**Ràng buộc và chỉ mục**

- `api_activity_logs_response_code_check` · `CHECK ((response_code >= 0))`
- B-tree đơn · `created_by_id`, `updated_by_id`

### importers

Lịch sử nhập dữ liệu vào project.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                                    |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                                             |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                                                                                 |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                                        |
| `service`         | `varchar(50)`              | Không | —                                          | Giá trị `"github"`, `"jira"`                                                               |
| `status`          | `varchar(50)`              | Không | —                                          | Django mặc định `"queued"` · Giá trị `"queued"`, `"processing"`, `"completed"`, `"failed"` |
| `metadata`        | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                                       |
| `config`          | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                                       |
| `data`            | `jsonb`                    | Không | —                                          | Django mặc định `{}`                                                                       |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                          |
| `initiated_by_id` | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                                          |
| `project_id`      | `uuid`                     | Không | [projects](#projects).`id` · `CASCADE`     | —                                                                                          |
| `token_id`        | `uuid`                     | Không | [api_tokens](#api_tokens).`id` · `CASCADE` | —                                                                                          |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                          |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                                          |
| `imported_data`   | `jsonb`                    | Có    | —                                          | —                                                                                          |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                                                                          |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `initiated_by_id`, `project_id`, `token_id`, `updated_by_id`, `workspace_id`

### exporters

Lịch sử xuất dữ liệu.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                 | Ghi chú                                                                                    |
| ----------------- | -------------------------- | ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `created_at`      | `timestamp with time zone` | Không | —                                          | `auto_now_add`                                                                             |
| `updated_at`      | `timestamp with time zone` | Không | —                                          | `auto_now`                                                                                 |
| `id`              | `uuid`                     | Không | —                                          | PK · Django mặc định `uuid.uuid4()`                                                        |
| `project`         | `uuid[]`                   | Có    | —                                          | —                                                                                          |
| `provider`        | `varchar(50)`              | Không | —                                          | Giá trị `"json"`, `"csv"`, `"xlsx"`                                                        |
| `status`          | `varchar(50)`              | Không | —                                          | Django mặc định `"queued"` · Giá trị `"queued"`, `"processing"`, `"completed"`, `"failed"` |
| `reason`          | `text`                     | Không | —                                          | —                                                                                          |
| `key`             | `text`                     | Không | —                                          | —                                                                                          |
| `url`             | `varchar(800)`             | Có    | —                                          | —                                                                                          |
| `token`           | `varchar(255)`             | Không | —                                          | Django mặc định `plane.db.models.exporter.generate_token()`                                |
| `created_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                          |
| `initiated_by_id` | `uuid`                     | Không | [users](#users).`id` · `CASCADE`           | —                                                                                          |
| `updated_by_id`   | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`          | —                                                                                          |
| `workspace_id`    | `uuid`                     | Không | [workspaces](#workspaces).`id` · `CASCADE` | —                                                                                          |
| `filters`         | `jsonb`                    | Có    | —                                          | —                                                                                          |
| `name`            | `varchar(255)`             | Có    | —                                          | —                                                                                          |
| `type`            | `varchar(50)`              | Không | —                                          | Django mặc định `"issue_exports"` · Giá trị `"issue_exports"`, `"issue_worklogs"`          |
| `deleted_at`      | `timestamp with time zone` | Có    | —                                          | —                                                                                          |
| `rich_filters`    | `jsonb`                    | Có    | —                                          | Django mặc định `{}`                                                                       |

**Ràng buộc và chỉ mục**

- UNIQUE `exporters_token_key` · `(token)`
- B-tree đơn · `created_by_id`, `initiated_by_id`, `updated_by_id`, `workspace_id`
- INDEX `exporters_token_c774aeeb_like` · `btree (token varchar_pattern_ops)`

<a name="quan-tri-instance"></a>

## Quản trị instance

[instances](#instances) · [instance_admins](#instance_admins) · [instance_configurations](#instance_configurations) · [changelogs](#changelogs)

### instances

Thông tin về bản cài đặt Plane.

| Cột                             | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                             |
| ------------------------------- | -------------------------- | ----- | --------------------------------- | ----------------------------------- |
| `created_at`                    | `timestamp with time zone` | Không | —                                 | `auto_now_add`                      |
| `updated_at`                    | `timestamp with time zone` | Không | —                                 | `auto_now`                          |
| `id`                            | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()` |
| `instance_name`                 | `varchar(255)`             | Không | —                                 | —                                   |
| `whitelist_emails`              | `text`                     | Có    | —                                 | —                                   |
| `instance_id`                   | `varchar(255)`             | Không | —                                 | —                                   |
| `current_version`               | `varchar(255)`             | Không | —                                 | —                                   |
| `last_checked_at`               | `timestamp with time zone` | Không | —                                 | —                                   |
| `namespace`                     | `varchar(255)`             | Có    | —                                 | —                                   |
| `is_telemetry_enabled`          | `boolean`                  | Không | —                                 | Django mặc định `true`              |
| `is_support_required`           | `boolean`                  | Không | —                                 | Django mặc định `true`              |
| `is_setup_done`                 | `boolean`                  | Không | —                                 | Django mặc định `false`             |
| `is_signup_screen_visited`      | `boolean`                  | Không | —                                 | Django mặc định `false`             |
| `is_verified`                   | `boolean`                  | Không | —                                 | Django mặc định `false`             |
| `created_by_id`                 | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `updated_by_id`                 | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `domain`                        | `text`                     | Không | —                                 | —                                   |
| `latest_version`                | `varchar(255)`             | Có    | —                                 | —                                   |
| `edition`                       | `varchar(255)`             | Không | —                                 | Django mặc định `"PLANE_COMMUNITY"` |
| `deleted_at`                    | `timestamp with time zone` | Có    | —                                 | —                                   |
| `is_test`                       | `boolean`                  | Không | —                                 | Django mặc định `false`             |
| `is_current_version_deprecated` | `boolean`                  | Không | —                                 | Django mặc định `false`             |

**Ràng buộc và chỉ mục**

- UNIQUE `instances_instance_id_key` · `(instance_id)`
- B-tree đơn · `created_by_id`, `updated_by_id`
- INDEX `instances_instance_id_cf688621_like` · `btree (instance_id varchar_pattern_ops)`

### instance_admins

Quản trị viên và vai trò trên instance.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                               | Ghi chú                             |
| --------------- | -------------------------- | ----- | ---------------------------------------- | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                        | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                        | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                        | PK · Django mặc định `uuid.uuid4()` |
| `role`          | `integer`                  | Không | —                                        | Django mặc định `20` · Giá trị `20` |
| `is_verified`   | `boolean`                  | Không | —                                        | Django mặc định `false`             |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`        | —                                   |
| `instance_id`   | `uuid`                     | Không | [instances](#instances).`id` · `CASCADE` | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`        | —                                   |
| `user_id`       | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL`        | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                        | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `instance_admins_instance_id_user_id_2e80a466_uniq` · `(instance_id, user_id)`
- `instance_admins_role_check` · `CHECK ((role >= 0))`
- B-tree đơn · `created_by_id`, `instance_id`, `updated_by_id`, `user_id`

### instance_configurations

Cấu hình theo khóa của instance.

| Cột             | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                             |
| --------------- | -------------------------- | ----- | --------------------------------- | ----------------------------------- |
| `created_at`    | `timestamp with time zone` | Không | —                                 | `auto_now_add`                      |
| `updated_at`    | `timestamp with time zone` | Không | —                                 | `auto_now`                          |
| `id`            | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()` |
| `key`           | `varchar(100)`             | Không | —                                 | —                                   |
| `value`         | `text`                     | Có    | —                                 | Django mặc định `null`              |
| `category`      | `text`                     | Không | —                                 | —                                   |
| `is_encrypted`  | `boolean`                  | Không | —                                 | Django mặc định `false`             |
| `created_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `updated_by_id` | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `deleted_at`    | `timestamp with time zone` | Có    | —                                 | —                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `instance_configurations_key_key` · `(key)`
- B-tree đơn · `created_by_id`, `updated_by_id`
- INDEX `instance_configurations_key_3eb64d36_like` · `btree (key varchar_pattern_ops)`

### changelogs

Ghi chú thay đổi phiên bản.

| Cột                    | Kiểu PostgreSQL            | NULL  | Tham chiếu                        | Ghi chú                             |
| ---------------------- | -------------------------- | ----- | --------------------------------- | ----------------------------------- |
| `created_at`           | `timestamp with time zone` | Không | —                                 | `auto_now_add`                      |
| `updated_at`           | `timestamp with time zone` | Không | —                                 | `auto_now`                          |
| `id`                   | `uuid`                     | Không | —                                 | PK · Django mặc định `uuid.uuid4()` |
| `title`                | `varchar(255)`             | Không | —                                 | —                                   |
| `description`          | `text`                     | Không | —                                 | —                                   |
| `version`              | `varchar(255)`             | Không | —                                 | —                                   |
| `tags`                 | `jsonb`                    | Không | —                                 | Django mặc định `[]`                |
| `release_date`         | `timestamp with time zone` | Có    | —                                 | —                                   |
| `is_release_candidate` | `boolean`                  | Không | —                                 | Django mặc định `false`             |
| `created_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `updated_by_id`        | `uuid`                     | Có    | [users](#users).`id` · `SET_NULL` | —                                   |
| `deleted_at`           | `timestamp with time zone` | Có    | —                                 | —                                   |

**Ràng buộc và chỉ mục**

- B-tree đơn · `created_by_id`, `updated_by_id`

<a name="ha-tang-django-va-celery"></a>

## Hạ tầng Django và Celery

[auth_group](#auth_group) · [auth_permission](#auth_permission) · [auth_group_permissions](#auth_group_permissions) · [users_groups](#users_groups) · [users_user_permissions](#users_user_permissions) · [django_content_type](#django_content_type) · [django_migrations](#django_migrations) · [django_session](#django_session) · [django_celery_beat_periodictask](#django_celery_beat_periodictask) · [django_celery_beat_periodictasks](#django_celery_beat_periodictasks) · [django_celery_beat_intervalschedule](#django_celery_beat_intervalschedule) · [django_celery_beat_crontabschedule](#django_celery_beat_crontabschedule) · [django_celery_beat_solarschedule](#django_celery_beat_solarschedule) · [django_celery_beat_clockedschedule](#django_celery_beat_clockedschedule)

### auth_group

Nhóm quyền Django.

| Cột    | Kiểu PostgreSQL | NULL  | Tham chiếu | Ghi chú       |
| ------ | --------------- | ----- | ---------- | ------------- |
| `id`   | `integer`       | Không | —          | PK · IDENTITY |
| `name` | `varchar(150)`  | Không | —          | —             |

**Ràng buộc và chỉ mục**

- UNIQUE `auth_group_name_key` · `(name)`
- INDEX `auth_group_name_a6ea08ec_like` · `btree (name varchar_pattern_ops)`

**Quan hệ nhiều–nhiều trong Django**

- `permissions` qua [auth_group_permissions](#auth_group_permissions).

### auth_permission

Quyền theo model hoặc loại nội dung.

| Cột               | Kiểu PostgreSQL | NULL  | Tham chiếu                                                   | Ghi chú       |
| ----------------- | --------------- | ----- | ------------------------------------------------------------ | ------------- |
| `id`              | `integer`       | Không | —                                                            | PK · IDENTITY |
| `name`            | `varchar(255)`  | Không | —                                                            | —             |
| `content_type_id` | `integer`       | Không | [django_content_type](#django_content_type).`id` · `CASCADE` | —             |
| `codename`        | `varchar(100)`  | Không | —                                                            | —             |

**Ràng buộc và chỉ mục**

- UNIQUE `auth_permission_content_type_id_codename_01ab375a_uniq` · `(content_type_id, codename)`
- B-tree đơn · `content_type_id`

### auth_group_permissions

Liên kết nhóm với quyền.

| Cột             | Kiểu PostgreSQL | NULL  | Tham chiếu                                           | Ghi chú       |
| --------------- | --------------- | ----- | ---------------------------------------------------- | ------------- |
| `id`            | `bigint`        | Không | —                                                    | PK · IDENTITY |
| `group_id`      | `integer`       | Không | [auth_group](#auth_group).`id` · `CASCADE`           | —             |
| `permission_id` | `integer`       | Không | [auth_permission](#auth_permission).`id` · `CASCADE` | —             |

**Ràng buộc và chỉ mục**

- UNIQUE `auth_group_permissions_group_id_permission_id_0cd325b0_uniq` · `(group_id, permission_id)`
- B-tree đơn · `group_id`, `permission_id`

### users_groups

Liên kết tự sinh giữa người dùng và nhóm.

| Cột        | Kiểu PostgreSQL | NULL  | Tham chiếu                                 | Ghi chú       |
| ---------- | --------------- | ----- | ------------------------------------------ | ------------- |
| `id`       | `bigint`        | Không | —                                          | PK · IDENTITY |
| `user_id`  | `uuid`          | Không | [users](#users).`id` · `CASCADE`           | —             |
| `group_id` | `integer`       | Không | [auth_group](#auth_group).`id` · `CASCADE` | —             |

**Ràng buộc và chỉ mục**

- UNIQUE `user_groups_user_id_group_id_40beef00_uniq` · `(user_id, group_id)`
- B-tree đơn · `group_id`, `user_id`

### users_user_permissions

Liên kết tự sinh giữa người dùng và quyền trực tiếp.

| Cột             | Kiểu PostgreSQL | NULL  | Tham chiếu                                           | Ghi chú       |
| --------------- | --------------- | ----- | ---------------------------------------------------- | ------------- |
| `id`            | `bigint`        | Không | —                                                    | PK · IDENTITY |
| `user_id`       | `uuid`          | Không | [users](#users).`id` · `CASCADE`                     | —             |
| `permission_id` | `integer`       | Không | [auth_permission](#auth_permission).`id` · `CASCADE` | —             |

**Ràng buộc và chỉ mục**

- UNIQUE `user_user_permissions_user_id_permission_id_7dc6e2e0_uniq` · `(user_id, permission_id)`
- B-tree đơn · `permission_id`, `user_id`

### django_content_type

Danh mục loại model Django dùng cho metadata và quyền.

| Cột         | Kiểu PostgreSQL | NULL  | Tham chiếu | Ghi chú       |
| ----------- | --------------- | ----- | ---------- | ------------- |
| `id`        | `integer`       | Không | —          | PK · IDENTITY |
| `app_label` | `varchar(100)`  | Không | —          | —             |
| `model`     | `varchar(100)`  | Không | —          | —             |

**Ràng buộc và chỉ mục**

- UNIQUE `django_content_type_app_label_model_76bd3d3b_uniq` · `(app_label, model)`

### django_migrations

Sổ migration đã áp dụng được Django tự tạo.

| Cột       | Kiểu PostgreSQL            | NULL  | Tham chiếu | Ghi chú                                       |
| --------- | -------------------------- | ----- | ---------- | --------------------------------------------- |
| `id`      | `bigint`                   | Không | —          | PK · IDENTITY                                 |
| `app`     | `varchar(255)`             | Không | —          | —                                             |
| `name`    | `varchar(255)`             | Không | —          | —                                             |
| `applied` | `timestamp with time zone` | Không | —          | Django mặc định `django.utils.timezone.now()` |

### django_session

Bảng session của thư viện Django.

| Cột            | Kiểu PostgreSQL            | NULL  | Tham chiếu | Ghi chú |
| -------------- | -------------------------- | ----- | ---------- | ------- |
| `session_key`  | `varchar(40)`              | Không | —          | PK      |
| `session_data` | `text`                     | Không | —          | —       |
| `expire_date`  | `timestamp with time zone` | Không | —          | —       |

**Ràng buộc và chỉ mục**

- B-tree đơn · `expire_date`
- INDEX `django_session_session_key_c0390e0f_like` · `btree (session_key varchar_pattern_ops)`

### django_celery_beat_periodictask

Định nghĩa tác vụ định kỳ.

| Cột               | Kiểu PostgreSQL            | NULL  | Tham chiếu                                                                                   | Ghi chú                 |
| ----------------- | -------------------------- | ----- | -------------------------------------------------------------------------------------------- | ----------------------- |
| `id`              | `integer`                  | Không | —                                                                                            | PK · IDENTITY           |
| `name`            | `varchar(200)`             | Không | —                                                                                            | —                       |
| `task`            | `varchar(200)`             | Không | —                                                                                            | —                       |
| `args`            | `text`                     | Không | —                                                                                            | Django mặc định `"[]"`  |
| `kwargs`          | `text`                     | Không | —                                                                                            | Django mặc định `"{}"`  |
| `queue`           | `varchar(200)`             | Có    | —                                                                                            | Django mặc định `null`  |
| `exchange`        | `varchar(200)`             | Có    | —                                                                                            | Django mặc định `null`  |
| `routing_key`     | `varchar(200)`             | Có    | —                                                                                            | Django mặc định `null`  |
| `expires`         | `timestamp with time zone` | Có    | —                                                                                            | —                       |
| `enabled`         | `boolean`                  | Không | —                                                                                            | Django mặc định `true`  |
| `last_run_at`     | `timestamp with time zone` | Có    | —                                                                                            | —                       |
| `total_run_count` | `integer`                  | Không | —                                                                                            | Django mặc định `0`     |
| `date_changed`    | `timestamp with time zone` | Không | —                                                                                            | `auto_now`              |
| `description`     | `text`                     | Không | —                                                                                            | —                       |
| `crontab_id`      | `integer`                  | Có    | [django_celery_beat_crontabschedule](#django_celery_beat_crontabschedule).`id` · `CASCADE`   | —                       |
| `interval_id`     | `integer`                  | Có    | [django_celery_beat_intervalschedule](#django_celery_beat_intervalschedule).`id` · `CASCADE` | —                       |
| `solar_id`        | `integer`                  | Có    | [django_celery_beat_solarschedule](#django_celery_beat_solarschedule).`id` · `CASCADE`       | —                       |
| `one_off`         | `boolean`                  | Không | —                                                                                            | Django mặc định `false` |
| `start_time`      | `timestamp with time zone` | Có    | —                                                                                            | —                       |
| `priority`        | `integer`                  | Có    | —                                                                                            | Django mặc định `null`  |
| `headers`         | `text`                     | Không | —                                                                                            | Django mặc định `"{}"`  |
| `clocked_id`      | `integer`                  | Có    | [django_celery_beat_clockedschedule](#django_celery_beat_clockedschedule).`id` · `CASCADE`   | —                       |
| `expire_seconds`  | `integer`                  | Có    | —                                                                                            | —                       |

**Ràng buộc và chỉ mục**

- UNIQUE `django_celery_beat_periodictask_name_key` · `(name)`
- `django_celery_beat_periodictask_expire_seconds_check` · `CHECK ((expire_seconds >= 0))`
- `django_celery_beat_periodictask_priority_check` · `CHECK ((priority >= 0))`
- `django_celery_beat_periodictask_total_run_count_check` · `CHECK ((total_run_count >= 0))`
- B-tree đơn · `clocked_id`, `crontab_id`, `interval_id`, `solar_id`
- INDEX `django_celery_beat_periodictask_name_265a36b7_like` · `btree (name varchar_pattern_ops)`

### django_celery_beat_periodictasks

Mốc cập nhật cấu hình tác vụ định kỳ.

| Cột           | Kiểu PostgreSQL            | NULL  | Tham chiếu | Ghi chú                  |
| ------------- | -------------------------- | ----- | ---------- | ------------------------ |
| `ident`       | `smallint`                 | Không | —          | PK · Django mặc định `1` |
| `last_update` | `timestamp with time zone` | Không | —          | —                        |

### django_celery_beat_intervalschedule

Lịch theo khoảng thời gian.

| Cột      | Kiểu PostgreSQL | NULL  | Tham chiếu | Ghi chú                                                                 |
| -------- | --------------- | ----- | ---------- | ----------------------------------------------------------------------- |
| `id`     | `integer`       | Không | —          | PK · IDENTITY                                                           |
| `every`  | `integer`       | Không | —          | —                                                                       |
| `period` | `varchar(24)`   | Không | —          | Giá trị `"days"`, `"hours"`, `"minutes"`, `"seconds"`, `"microseconds"` |

### django_celery_beat_crontabschedule

Lịch cron.

| Cột             | Kiểu PostgreSQL | NULL  | Tham chiếu | Ghi chú                                                                                       |
| --------------- | --------------- | ----- | ---------- | --------------------------------------------------------------------------------------------- |
| `id`            | `integer`       | Không | —          | PK · IDENTITY                                                                                 |
| `minute`        | `varchar(240)`  | Không | —          | Django mặc định `"*"`                                                                         |
| `hour`          | `varchar(96)`   | Không | —          | Django mặc định `"*"`                                                                         |
| `day_of_week`   | `varchar(64)`   | Không | —          | Django mặc định `"*"`                                                                         |
| `day_of_month`  | `varchar(124)`  | Không | —          | Django mặc định `"*"`                                                                         |
| `month_of_year` | `varchar(64)`   | Không | —          | Django mặc định `"*"`                                                                         |
| `timezone`      | `varchar(63)`   | Không | —          | Django mặc định `django_celery_beat.models.crontab_schedule_celery_timezone()` · 598 lựa chọn |

### django_celery_beat_solarschedule

Lịch theo sự kiện mặt trời.

| Cột         | Kiểu PostgreSQL | NULL  | Tham chiếu | Ghi chú                                                                                                                                                             |
| ----------- | --------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `integer`       | Không | —          | PK · IDENTITY                                                                                                                                                       |
| `event`     | `varchar(24)`   | Không | —          | Giá trị `"dawn_astronomical"`, `"dawn_civil"`, `"dawn_nautical"`, `"dusk_astronomical"`, `"dusk_civil"`, `"dusk_nautical"`, `"solar_noon"`, `"sunrise"`, `"sunset"` |
| `latitude`  | `numeric(9, 6)` | Không | —          | —                                                                                                                                                                   |
| `longitude` | `numeric(9, 6)` | Không | —          | —                                                                                                                                                                   |

**Ràng buộc và chỉ mục**

- UNIQUE `django_celery_beat_solar_event_latitude_longitude_ba64999a_uniq` · `(event, latitude, longitude)`

### django_celery_beat_clockedschedule

Lịch chạy một lần tại thời điểm định trước.

| Cột            | Kiểu PostgreSQL            | NULL  | Tham chiếu | Ghi chú       |
| -------------- | -------------------------- | ----- | ---------- | ------------- |
| `id`           | `integer`                  | Không | —          | PK · IDENTITY |
| `clocked_time` | `timestamp with time zone` | Không | —          | —             |
