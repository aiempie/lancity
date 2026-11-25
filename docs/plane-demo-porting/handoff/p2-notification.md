# Handoff p2-notification

Nhóm: `docs/plane-demo-porting/09-notification.md` (57 mục + 4 adapter). Chưa chạy test, build, typecheck theo quy ước. ESLint và Prettier sạch trên các file bên dưới.

Test: [`tests/p2-notification.integration.mjs`](../../../tests/p2-notification.integration.mjs). Dùng D1 giả trên `node:sqlite` (cùng cách với `tests/p1-issue-background.integration.mjs`), không cần Worker. Chạy bằng `pnpm exec tsx --test tests/p2-notification.integration.mjs`. Test tự tạo bảng `notification_email_locks`, nên chạy được trước khi merge migration.

## (a) PD đã xong

Không có mục để trống. Service cũ giữ nguyên chữ ký export (`listNotifications`, `listStickies`, `createSticky`, ...). Phần mới thêm hàm bên cạnh.

| PD | Kết quả | Code |
| --- | --- | --- |
| 0698, 0699 | Port. `GET` và `DELETE /users/notifications/:id` (xóa mềm, 204). Đã gộp vào router | [routes/notifications.ts](../../../src/server/api/v1/routes/notifications.ts), `getNotification`, `deleteNotification` trong [notification/service.ts](../../../src/server/notification/service.ts) |
| 0700 | Port. `queryNotification` (người nhận, workspace, xóa mềm, quyền project/issue) | [notification/queries.ts](../../../src/server/notification/queries.ts) |
| 0701, 0702 | Port. `listNotificationItems`: trả mảng, hoặc phân trang khi có đủ `per_page` và `cursor` (allowlist `created_at`, `updated_at`, mặc định `-created_at`). Callback `on_results` là `presentNotifications` | service.ts |
| 0703 | Port. `PATCH` chỉ nhận `snoozed_till`, trả DTO đầy đủ | routes/notifications.ts |
| 0704-0707 | Port. read, unread, archive, unarchive trả DTO đầy đủ | routes/notifications.ts, `setNotificationState` |
| 0708, 0709 | Giữ nguyên bản đã có (đếm chưa đọc, mark-all-read) | service.ts |
| 0710, 0711 | Port. Trả DTO `UserNotificationPreferenceSerializer` (`user`, `workspace`, `project` chỉ đọc) | [presenters.ts](../../../src/server/notification/presenters.ts) |
| 1454, 1456 | Port `formatNotification`, `formatUserNotificationPreference` | presenters.ts |
| 1455 | Port `getDefaultPreference` (JSON cũ, chỉ để tham chiếu) và `DEFAULT_NOTIFICATION_PREFERENCE` | [model-rules.ts](../../../src/server/notification/model-rules.ts) |
| 0259, 0261, 0262, 0264, 0265, 0266 | Port. Route `PUT` và `PATCH` dùng chung `updateSticky`. Danh sách phân trang 20 mục, tìm theo `?query=` trên `description_stripped`, sắp theo `-sort_order` | [routes/stickies.ts](../../../src/server/api/v1/routes/stickies.ts), [sticky/service.ts](../../../src/server/sticky/service.ts) |
| 0263 | Gộp vào `listStickiesPage` (đích gốc `stickys.ts` là typo) | sticky/service.ts |
| 0260, 0933 | Port `queryWorkspaceSticky`, `querySticky` (alias), `stickySearch` | [sticky/queries.ts](../../../src/server/sticky/queries.ts) |
| 0932, 0934, 0935, 0936, 0937, 0938 | Cùng service và route với nhóm 0259-0266 (bản `/api/workspaces/...` và `/api/v1/workspaces/...` dùng một route Hono) | sticky/service.ts |
| 0047 | Port `stickyApiInputSchema` (đích gốc `types/sticky/schema.ts`, đặt ở file p2 theo luật không sửa `schema.ts`). Làm sạch HTML ở service qua `sanitizeHtml` của issue, kiểm tra binary base64 như `validate_binary_data` | [types/notification/p2-notification-schema.ts](../../../src/types/notification/p2-notification-schema.ts), [sticky/model-rules.ts](../../../src/server/sticky/model-rules.ts) |
| 1490 | Port. `description_stripped` tính lại mỗi lần lưu, `sort_order` mới = max + 10000 (65535 cho cái đầu) | sticky/model-rules.ts |
| 1491 | Port `formatSticky` | [sticky/presenters.ts](../../../src/server/sticky/presenters.ts) |
| 1123 | Port `removeUnwantedCharacters` | [jobs/email-notification.ts](../../../src/server/notification/jobs/email-notification.ts) |
| 1124, 1125 | Thay thế Redis `SET NX EX` bằng bảng D1 `notification_email_locks`. `acquireLock`, `releaseLock` | email-notification.ts, [ext-p2-notification.ts](../../../src/db/schema/ext-p2-notification.ts) |
| 1126 | Port `stackEmailNotification`. Job `notification.email.stack` và cron `*/5 * * * *`. Nhóm log chưa xử lý theo người nhận và issue, đánh dấu `processed_at`, rồi đẩy job `notification.email.send` (tối đa 500 log mỗi job) | email-notification.ts |
| 1127, 1128, 1129 | Port `createPayload`, `processMention`, `processHtmlContent` | email-notification.ts |
| 1130 | Port `sendEmailNotification`. Job `notification.email.send`. Tải lại log từ D1 theo id, dựng email bằng `renderIssueUpdatesEmail`, gửi bằng `sendMail`, ghi `sent_at` | email-notification.ts, [email.ts](../../../src/server/notification/email.ts) |
| 1201-1208 | Port `updateMentionsForIssue`, `getNewMentions`, `getRemovedMentions`, `extractMentionsAsSubscribers`, `extractMentions`, `extractCommentMentions`, `getNewCommentMentions`, `createMentionNotification` | [jobs/notification.ts](../../../src/server/notification/jobs/notification.ts). Dùng lại `extractMentions` và `syncIssueMentions` của `issue/mention.ts` |
| 1209 | Port `notifications`. Job `notification.issue` (payload của p1-issue-background) | notification.ts |
| 1216, 1217 | Đã xong ở nhóm project: `projectAdditionEmail`, `projectInvitationEmail` và job `project.send_mail` ([project/emails.ts](../../../src/server/project/emails.ts), [project/jobs.ts](../../../src/server/project/jobs.ts)). Không làm trùng | |
| 1220, 1221 | Đã xong ở nhóm auth: `activationEmail`, `deactivationEmail` ([identity/emails.ts](../../../src/server/identity/emails.ts)). `deactivationEmail` đã được gọi trong `account.ts`. `activationEmail` chưa kích hoạt theo quyết định p1-auth (GHSA-rmmf-rj2q-3rrg) | |
| 1222, 1223 | Đã xong ở nhóm auth: `emailUpdateCodeEmail`, `emailUpdateConfirmationEmail`, gọi trong `identity/account.ts` | |
| 1237 | Đã xong ở nhóm workspace: `sendWorkspaceInvitation` trong [workspace/jobs.ts](../../../src/server/workspace/jobs.ts) | |
| 1729, 1730 | Port `removeStyleBlocks`, `generatePlainTextFromHtml` | email.ts |

Thêm ngoài checklist: cron `45 2 * * *` xóa log email đã gửi quá `EMAIL_LOG_RETENTION_DAYS` ngày (mặc định 7, như `delete_email_notification_logs` của Plane) và khóa hết hạn.

Ghi chú và "unsubscribe": ghi chú là `stickies`. Hủy đăng ký nhận email của issue dùng endpoint subscriber có sẵn (`issue/subscriber.ts`). Email giữ liên kết tới issue và trang tùy chọn thông báo như Plane (không có token hủy riêng).

### Khác Plane có chủ đích

- `notifications` task ghi mọi thứ trong một `db.batch` ở cuối (5 dòng notification và 8 dòng log mỗi câu, giữ dưới 100 tham số của D1). Retry sau lỗi đọc không tạo trùng. Retry sau khi batch thành công thì có trùng, vì Queues giao ít nhất một lần.
- Plane tạo log email mention cho `subscriber` (biến còn sót của vòng lặp trước) trong hai nhánh mention của mô tả. Bản này dùng đúng người được nhắc.
- Người dùng chưa có dòng `user_notification_preferences` dùng mặc định (bật hết) thay vì làm hỏng cả task như `Preference.objects.get`.
- `message` của thông báo mention lưu chuỗi trong cột JSON (giống Plane). Tên người nhắc dùng `username` rồi `name`.
- `create_payload`: Plane đọc `data.get("actor_id")` (khóa chữ) nên luôn ghi đè `activity_time`. Bản này giữ thời gian của activity cuối của actor, cùng kết quả.
- `send_email_notification` không đọc Redis `base_api`. Gốc URL lấy từ `baseHost(env)` (`WEB_URL`, `APP_BASE_URL`, `BETTER_AUTH_URL`). Email không có avatar (Plane dùng ảnh hoặc chữ cái đầu).
- Template `issue-updates.html` (Django) thay bằng `renderIssueUpdatesEmail`: cùng cấu trúc (tiêu đề, người cập nhật, bảng thay đổi cũ/mới theo từng trường, bình luận, nút xem, liên kết tùy chọn), không dùng icon trạng thái ở S3.
- Khi thiếu SMTP, log vẫn được đánh dấu `processed_at` nhưng `sent_at` để trống. Có SMTP mà gửi lỗi thì job ném lỗi để Queues thử lại và nhả khóa.
- Danh sách thông báo dạng mảng vẫn giới hạn 100 dòng (như bản đã có). Bản phân trang đầy đủ chỉ bật khi có cả `per_page` và `cursor`, như Plane.
- Điều kiện `type=created` cho khách: giữ logic đã có (`membership.role === 5` thì bỏ), Plane dùng `role < 15`, tương đương với vai trò 5, 15, 20.

## (b) Route cần đăng ký

Không cần sửa `index.ts`. Ba router đã được mount sẵn và tên export không đổi: `stickiesRoutes`, `notificationsRoutes`, `notificationPreferencesRoutes`. Thứ tự trong router: `/unread` và `/mark-all-read` được khai báo trước `/:notificationId`.

## (c) Schema ext cần merge

File [`src/db/schema/ext-p2-notification.ts`](../../../src/db/schema/ext-p2-notification.ts), một bảng `notification_email_locks` (`key` duy nhất, `expires_at` số mili giây, `created_at`). Thêm `export * from './schema/ext-p2-notification'` vào `src/db/schema.ts`. Gợi ý tên migration: `pnpm db:generate --name notification_email_locks`. Trước khi áp migration, `acquireLock` sẽ ném lỗi (không fail-open), nên job `notification.email.send` retry cho đến khi có bảng. `notification.issue` và `stack` không phụ thuộc bảng này.

## (d) Key linkto cần thêm

Không có. Dùng các key đã có: `notifications`, `notification`, `notificationRead`, `notificationArchive`, `notificationsUnread`, `notificationsMarkAllRead`, `notificationPreferences`, `stickies`, `sticky`.

## (e) Dependency, binding, env

- Không thêm dependency hay binding. Cần `JOBS_QUEUE` và cron `*/5 * * * *` (đã có từ Phase 0). Lịch `45 2 * * *` rơi vào mốc 5 phút.
- Env tùy chọn: `EMAIL_LOG_RETENTION_DAYS` (mặc định 7). Gửi email cần `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM` (p0). Link trong email cần `WEB_URL`, `APP_BASE_URL` hoặc `BETTER_AUTH_URL`.
- `src/server/notification/jobs/index.ts` do `job-registry.ts` nạp bằng `import.meta.glob`.

## (f) Việc còn dang dở và chỗ dễ lỗi

1. Chạy `pnpm exec tsx --test tests/p2-notification.integration.mjs`, `tests/notification-views.integration.mjs` (route cũ, DTO danh sách đã đổi sang snake_case đầy đủ, vẫn có `id`, `read_at`...), rồi `pnpm typecheck`.
2. Điểm dễ lỗi typecheck: `notificationsRoutes[method](key, ...)` trong vòng lặp (union `post | delete`); `paginate(... onResults: ... as never)`; `db.all<{ id: number }>` trong `extractMentionsAsSubscribers`; ép kiểu `as unknown as JsonValue` cho `data`; `Buffer.from(Uint8Array)` ghi vào cột blob `mode: 'buffer'`; `drizzle(env.DB, { schema }) as unknown as LancityDb` (cùng cách với p1-issue-background).
3. `notifications.title` là cột `notNull`: mention notification ghi `title: ''` (Plane để mặc định rỗng của `TextField`).
4. Chưa nối nơi phát sinh log: service issue phải gọi `enqueueIssueActivity({ notification: true })` thì `notification.issue` mới chạy (xem handoff p1-issue-background mục f.1). Cho đến lúc đó không có thông báo mới được tạo từ thao tác issue.
5. `description_binary` của sticky nhận và trả base64 trong JSON. Chưa đối chiếu định dạng đầu ra của DRF cho `BinaryField`.
6. Chưa kiểm chứng trên Worker thật: gửi email bằng nodemailer, `db.batch` với nhiều `insert ... values`, độ trễ của lock D1.
7. Chưa có Server Action cho sticky hoặc thông báo vì chưa có trang giao diện dùng chúng. Khi có, import trực tiếp các hàm trong `src/server/sticky/service.ts` và `src/server/notification/service.ts`.
