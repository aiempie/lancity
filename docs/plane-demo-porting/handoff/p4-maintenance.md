# Handoff p4-maintenance

Nhóm 15 (`docs/plane-demo-porting/15-maintenance.md`, 87 mục): job dọn dẹp, xóa dữ liệu, dữ liệu mẫu, logger, seed workspace và các lệnh quản trị. Chưa chạy typecheck, build, test theo quy ước. ESLint sạch trên mọi file bên dưới.

## Đường dẫn khác checklist

Checklist ghi `src/server/maintenance/jobs/*.ts` và `scripts/plane/*.ts`. Thực tế:

- Logic nằm ở `src/server/maintenance/*.ts` (không dùng thư mục `jobs/` để registry chỉ nạp một file là `src/server/maintenance/jobs.ts`).
- Các lệnh CLI gộp vào một điểm vào [`scripts/maintenance/run.ts`](../../../scripts/maintenance/run.ts) (lệnh con tương ứng từng management command), chạy bằng `pnpm exec tsx`.
- Các lệnh quản trị cũng có API cho instance admin ([`routes/maintenance.ts`](../../../src/server/api/v1/routes/maintenance.ts)), dùng được trên D1 remote. CLI chỉ chạy trên file SQLite D1 local.

Phân loại dùng bên dưới: **Port** (chuyển nghiệp vụ), **Gộp** (làm cùng mục khác), **Thay thế** (dịch vụ Cloudflare hoặc cơ chế sẵn có), **Ngoài phạm vi** (chỉ có ý nghĩa với Django/Docker).

## (a) PD đã xử lý

Test: [`tests/p4-maintenance.test.ts`](../../../tests/p4-maintenance.test.ts) (chạy bằng `pnpm exec tsx --test tests/p4-maintenance.test.ts`, dùng SQLite trong bộ nhớ qua [`d1-shim.ts`](../../../scripts/maintenance/d1-shim.ts), không cần Wrangler).

### bgtasks/cleanup_task.py (PD-1085..1096)

Mã: [`cleanup.ts`](../../../src/server/maintenance/cleanup.ts), job và cron trong [`jobs.ts`](../../../src/server/maintenance/jobs.ts).

| PD | Phân loại | Ghi chú |
| --- | --- | --- |
| 1085 | Port | `processCleanupTask(db, task, { days, maxBatches })`. Xóa cứng theo lô 500 bằng `delete ... where id in (select ... limit 500)` (không cần tải id về Worker). Lỗi một lô thì dừng task và báo `failed` (Plane bỏ qua lô rồi chạy tiếp, ở đây chọn lại cùng id sẽ lặp vô hạn). Quá `maxBatches` (40) thì job tự xếp lại chính nó sau 5 giây. |
| 1086 | Gộp vào 1085 | `flush` là một vòng lặp của `processCleanupTask`. |
| 1087 | Port | `getApiLogsQueryset`: `created_at <= now - API_ACTIVITY_LOG_RETENTION_DAYS` (mặc định 14), gồm cả hàng đã xóa mềm (Plane dùng `all_objects`). |
| 1088 | Port | `getEmailLogsQueryset`: `sent_at <= now - EMAIL_LOG_RETENTION_DAYS` (mặc định 7). |
| 1089 | Port | `getPageVersionsQueryset`: hàm cửa sổ `row_number() over (partition by page_id order by created_at desc)`, xóa từ bản thứ 21. |
| 1090 | Port | `getIssueDescriptionVersionsQueryset`: tương tự theo `issue_id`. |
| 1091 | Port | `getWebhookLogsQueryset`: `WEBHOOK_LOG_RETENTION_DAYS` (mặc định 14). |
| 1092 | Port | `deleteApiLogs`, cron `30 2 * * *`. |
| 1093 | Port, lịch ở nhóm notification | `deleteEmailNotificationLogs` dùng cho lệnh chạy tay. Lịch hằng ngày đã có ở `notification.delete_email_logs` (`45 2 * * *`, p2-notification), nên nhóm này **không** đặt lịch thứ hai. |
| 1094 | Port | `deletePageVersions`, cron `0 3 * * *`. |
| 1095 | Port | `deleteIssueDescriptionVersions`, cron `15 3 * * *`. |
| 1096 | Port | `deleteWebhookLogs`, cron `30 3 * * *`. |

Giờ chạy giữ nguyên lịch Celery beat (UTC) và đều rơi vào mốc 5 phút.

### bgtasks/deletion_task.py (PD-1104..1106)

Mã: [`cascade.ts`](../../../src/server/maintenance/cascade.ts), [`deletion.ts`](../../../src/server/maintenance/deletion.ts).

| PD | Phân loại | Ghi chú |
| --- | --- | --- |
| 1104 | Port | `softDeleteRelatedObjects(db, tableName, id)`. Django duyệt `_meta.get_fields()`, ở đây đọc khóa ngoại một cột từ metadata Drizzle (`cascadeGraph`). `cascade` thì xóa mềm bảng con có `deleted_at` rồi đi tiếp, `set null` thì gán null, `no action/restrict` (Django `DO_NOTHING`) bỏ qua. Mọi hàng của một lần chạy dùng chung một dấu `deleted_at`, nên mỗi tầng là một `db.batch` các câu `update` theo tập hợp (không duyệt từng hàng). Hàng đã xóa mềm từ trước giữ nguyên dấu cũ và không bị duyệt lại. Job `maintenance.soft_delete_related` với payload `{ model: '<tên bảng SQL>', id }`. |
| 1105 | Port (no-op) | `restoreRelatedObjects` trống trong Plane (decorator task bị comment). Giữ hàm rỗng. |
| 1106 | Port | `hardDelete(db, { days, from, budget })`: xóa cứng hàng có `deleted_at` cũ hơn `HARD_DELETE_AFTER_DAYS` (mặc định 60) theo thứ tự của Plane (workspace, project, cycle, module, issue, page, view, label, state, activity, comment, link, reaction, favorite, module_issue, cycle_issue, estimate, estimate_point), rồi mọi bảng còn lại có `deleted_at` (trừ `user`). Khóa ngoại SQLite thay cho `collector` của Django. Quan hệ `no action` (Plane dùng `DO_NOTHING` không ràng buộc DB, ví dụ `issue_activities.issue_id`) được tách trước bằng cách gán null cột con. Bảng bị chặn thì ghi vào `failed` và chạy tiếp. Giới hạn 400 câu lệnh mỗi lần (ngân sách subrequest D1), hết thì trả `next` và job xếp lại từ bảng đó. Cron `0 0 * * *`. |

### bgtasks/dummy_data_task.py (PD-1107..1122)

Mã: [`dummy-data.ts`](../../../src/server/maintenance/dummy-data.ts). Không dùng Faker: bộ sinh tên, màu, văn bản nhỏ trong file, có thể gieo hạt (`createRng(seed)`) để test lặp lại được. Chạy được cả trong Worker lẫn CLI vì không import module Cloudflare.

| PD | Ghi chú |
| --- | --- |
| 1107 `createProject` | Tên ngẫu nhiên + hậu tố 5 ký tự, identifier từ chữ cái của tên, chọn lại khi trùng. Người tạo là admin của project. |
| 1108 `createProjectMembers` | Thành viên theo email (admin, `sort_order` ngẫu nhiên, bỏ qua trùng). |
| 1109 `createStates` | 5 state của Plane (không có Triage). |
| 1110 `createLabels` | 50 label. |
| 1111 `createCycles` | Tạo `cycleCount + 1` cycle, giữ đúng hành vi vòng `while len <= count` của Plane. |
| 1112 `createModules` | |
| 1113 `createPages` | Văn bản mỗi page tối đa 5000 ký tự (Plane tới 60000) để không vượt giới hạn hàng D1. |
| 1114 `createPageLabels` | |
| 1115 `createIssues` | Sequence kế tiếp, sort order, ngày, độ ưu tiên, kèm `issue_sequences`, activity "created the issue" và cập nhật `project_issue_counters`. Chèn theo lô 30 issue. |
| 1116 `createIntakeIssues` | Issue gắn vào intake mặc định với trạng thái ngẫu nhiên. |
| 1117 `createIssueParent` | **Khác Plane có chủ đích**: Plane tính danh sách sub issue nhưng không bao giờ thêm vào danh sách lưu nên không ghi gì. Bản này áp dụng ý định (một phần tư issue làm cha, tối đa một nửa issue có cha). |
| 1118..1121 | `createIssueAssignees`, `createIssueLabels`, `createCycleIssues`, `createModuleIssues`. |
| 1122 `createDummyData(db, input, { rng, now })` | Điều phối các bước trên. Giới hạn đầu vào ở [`p4-maintenance-schema.ts`](../../../src/types/instance/p4-maintenance-schema.ts) (tối đa 1000 issue) để một lần chạy nằm trong ngân sách subrequest. Chạy nền bằng job `maintenance.dummy_data`. |

### bgtasks/logger_task.py (PD-1198, 1199)

[`logger.ts`](../../../src/server/maintenance/logger.ts). `logToDatabase` (1198, thay `log_to_postgres`) ghi `api_activity_logs`; `processLogs` (1199) kiểm tra payload bằng Zod, bỏ qua khóa lạ (như `**_` của Plane, ví dụ `mongo_log`) và bỏ payload sai. Job `maintenance.process_logs`, hàm đẩy job `enqueueProcessLogs`. `apiTokenLog` của p1-platform vẫn ghi trực tiếp trong `waitUntil`; job này là đường thay thế khi cần ghi qua hàng đợi.

### bgtasks/workspace_seed_task.py (PD-1238..1247)

Mã: [`workspace-seed.ts`](../../../src/server/maintenance/workspace-seed.ts) và [`seed-data.ts`](../../../src/server/maintenance/seed-data.ts). Dữ liệu là bản sao 8 file JSON của Plane ở `src/server/maintenance/seed/` (import tĩnh vào bundle).

| PD | Ghi chú |
| --- | --- |
| 1238 `readSeedFile` | Trả hàng của file đã nhúng, `null` nếu không có. |
| 1239 `createProjectAndMember` | Dùng `createProject` của nhóm project, tên và identifier lấy từ tên workspace (như `seed.ts` cũ), mọi thành viên workspace thành thành viên project cùng vai trò, `project_user_properties` với display filters/properties của seed. Không có bot user: workspace owner là người tạo. |
| 1240 `createProjectStates` | `createProject` đã tạo state mặc định của Lancity, nên state seed trùng tên được cập nhật (màu, thứ tự, nhóm), state khác được thêm. Giữ state Triage. |
| 1241 | `createProjectLabels`. |
| 1242 `createProjectIssues` | 7 issue, mỗi issue một `db.batch` (issue, sequence, activity, label, cycle, module). Sequence theo thứ tự file. |
| 1243 `createPages` | 2 page, `description` JSON và `logo_props` (chuỗi JSON hoặc repr Python) được `parseLooseJson` đọc. Page `PROJECT` gắn vào `project_pages`. |
| 1244 `createCycles` | CURRENT bắt đầu bây giờ 14 ngày; UPCOMING bắt đầu sau cycle cuối 1 ngày (14 ngày kể từ bây giờ nếu chưa có). |
| 1245 `createModules` | Module thứ n bắt đầu sau 2n ngày, kéo dài 14 ngày. |
| 1246 `createViews` | |
| 1247 `workspaceSeed(db, workspaceId)` | Idempotent: không làm gì nếu workspace đã có project (Queues giao ít nhất một lần). Job `maintenance.workspace_seed`. |

**Cách nối (cần integrator, vì `workspace/jobs.ts` và `workspace/seed.ts` thuộc nhóm khác).** Registry nạp file theo thứ tự chữ cái và `registerJobHandler` ghi đè, nên `maintenance/jobs.ts` không thể thay handler `workspace.seed` từ phía này. Sửa `src/server/workspace/jobs.ts`:

```ts
import { MAINTENANCE_WORKSPACE_SEED_JOB } from '@/server/maintenance/workspace-seed'

export const enqueueWorkspaceSeed = (workspaceId: number, env = getEnv()) =>
  enqueueJob(env, { type: MAINTENANCE_WORKSPACE_SEED_JOB, payload: { workspaceId } })
```

và giữ handler `workspace.seed` cũ chỉ để tiêu thụ tin nhắn đã nằm trong hàng đợi, đổi thân thành `workspaceSeed(getDb(env.DB), payload.workspaceId)` (import từ `@/server/maintenance/workspace-seed`). `seedWorkspace` và `WORKSPACE_SEED_JOB` trong `workspace/seed.ts` có thể xóa sau khi chắc chắn không còn tin nhắn cũ. Payload hai bên giống nhau (`{ workspaceId }`).

### db/management/commands và license/management/commands

Mã: [`ops.ts`](../../../src/server/maintenance/ops.ts) (thuần, nhận `db`), route API, CLI. Mọi route yêu cầu instance admin (`requireInstanceAdmin`). Mỗi lệnh đổi dữ liệu ghi một dòng `maintenance_runs` (best effort, không chặn lệnh nếu bảng chưa có).

| PD | Phân loại | Lệnh Plane | API (`/instances/maintenance` + path) | CLI `run.ts` |
| --- | --- | --- | --- | --- |
| 1251, 1252 | Port | `activate_user` | `POST /users/activate` | `activate-user` |
| 1253, 1254 | Port | `clear_cache` (xóa `cache_entries`, một khóa hoặc tất cả) | `POST /cache/clear` | `clear-cache` |
| 1255 | Port | `copy_issue_comment_to_description` (vòng 100 comment, chạy lại được) | `POST /issues/copy-comment-descriptions` (job nền) | `copy-issue-comment-to-description` |
| 1256 | Ngoài phạm vi | `create_bucket` (MinIO/S3) | | Bucket R2 tạo bằng `pnpm exec cf r2 bucket create lancity-assets` hoặc Dashboard, binding `ASSET_BUCKET` |
| 1257 | Port | `create_dummy_data` (hỏi từng giá trị bằng `input()`) | `POST /dummy-data` (202, job nền) | `create-dummy-data` |
| 1258, 1259 | Có sẵn | `create_instance_admin` | `POST /admins` của p3-instance | `create-instance-admin` gọi [`scripts/plane/create-instance-admin.ts`](../../../scripts/plane/create-instance-admin.ts), bản đó đã có kiểm thử ở `tests/migrations.test.mjs`, yêu cầu tài khoản đã xác minh email |
| 1260, 1261 | Port | `create_project_member` | `POST /project-members` | `create-project-member` |
| 1262, 1263, 1264 | Port | `fix_duplicate_sequences` | `POST /issues/fix-duplicate-sequences` | `fix-duplicate-sequences` |
| 1265..1271 | Ngoài phạm vi | `makemigrations` (khóa file migration của Django) | | Schema đổi bằng `pnpm db:generate --name ...` của Drizzle Kit, xem README |
| 1272, 1273 | Port | `reactivate_workspace_member` (trả `notes` thay cho cảnh báo in ra) | `POST /workspace-members/reactivate` | `reactivate-workspace-member` |
| 1274, 1275 | Port | `reset_password` | `POST /users/reset-password` | `reset-password` (mật khẩu từ `NEW_PASSWORD` hoặc hỏi) |
| 1276 | Thay thế | `sync_issue_description_version` | `POST /issues/sync-description-versions` gọi `enqueueIssueDescriptionVersionBackfill` (p1-issue-background, PD-1184) | Chỉ API (cần hàng đợi) |
| 1277 | Thay thế | `sync_issue_version` | `POST /issues/sync-versions` gọi `enqueueIssueVersionBackfill` (PD-1197) | Chỉ API |
| 1278, 1279 | Port | `test_email` | `POST /email/test` gửi qua `sendMail` (Gmail). Kiểm tra cấu hình lưu trong instance vẫn là `email-credentials-check` của p3 (PD-1550) | Chỉ API (cần secret của Worker) |
| 1280..1284 | Ngoài phạm vi | `update_bucket` (policy, CORS, đặt public cho S3) | | R2 không có bucket policy kiểu S3. Quyền đọc đi qua Worker, CORS và public access cấu hình ở Dashboard hoặc `cf r2 bucket` |
| 1285, 1286 | Port | `update_deleted_workspace_slug` (`--dry-run` thành `dryRun`) | `POST /workspaces/update-deleted-slug` | `update-deleted-workspace-slug` |
| 1287 | Ngoài phạm vi | `wait_for_db` | | D1 là binding, không có bước chờ kết nối |
| 1288, 1289 | Ngoài phạm vi | `wait_for_migrations` | | `pnpm exec cf d1 migrations list` (hoặc `apply`) trong quy trình deploy |
| 1578 | Port | `configure_instance` (`INSTANCE_CONFIG_VARIABLES` từ `instance_config_variables/core.py`, `extended.py` rỗng). Tạo hàng còn thiếu từ biến môi trường, không đổi hàng có sẵn. Cần `BETTER_AUTH_SECRET` thay `SECRET_KEY`. Giá trị mã hóa dùng `encryptData` (cần `INSTANCE_ENCRYPTION_KEY`) | `POST /instance/configure` | `configure-instance` (không có khóa mã hóa trong CLI, nên chỉ chạy khi env không chứa secret cần mã hóa) |
| 1579, 1580, 1581, 1582 | Port | `register_instance`: `checkForCurrentVersion` (`APP_VERSION`, mặc định `v0.1.0`, không đọc `package.json` vì Worker không có file), `checkForLatestVersion` (GitHub release, đổi bằng `LATEST_VERSION_URL`, lỗi thì dùng bản hiện tại), tạo hoặc cập nhật `instances` (tên "Lancity"). Phần `push_instance_metrics.delay()` là `queueInstanceMetricsPush` của p3 | `POST /instance/register` | `register-instance` |

Chữ ký service là của nhóm này; không đổi export nào có sẵn của nhóm khác.

## (b) Route cần đăng ký vào `index.ts`

```ts
import { maintenanceRoutes } from '@/server/api/v1/routes/maintenance'

app.route(`${linkto.apiInstances}/maintenance`, maintenanceRoutes)
```

Router đã tự áp `authenticate` và `requireInstanceAdmin` cho mọi route. Đường dẫn tương đối (`/runs`, `/users/activate`, ...) nằm trong hằng `paths` ở đầu file; chưa có key `linkto`.

## (c) Schema ext cần merge

[`src/db/schema/ext-p4-maintenance.ts`](../../../src/db/schema/ext-p4-maintenance.ts): bảng `maintenance_runs` (task, status, actor_id, result JSON, error, started_at, finished_at; chỉ mục theo `task, started_at`). Thêm `export * from './schema/ext-p4-maintenance'` vào `src/db/schema.ts`. Gợi ý tên migration: `pnpm db:generate --name maintenance_runs`. Code vẫn chạy khi chưa có bảng (ghi run thất bại chỉ ghi log cảnh báo).

Lưu ý khi merge nhiều ext: `cascadeGraph` đọc mọi bảng export từ `@/db/schema`, nên bảng ext chỉ vào đồ thị xóa dây chuyền khi đã được merge. Bảng ext không có `deleted_at` (như `rate_limit_hits`, `cache_entries`) tự bị bỏ qua.

## (d) Key linkto cần thêm

Không bắt buộc. Nếu muốn đưa đường dẫn vào `linkto`: `apiMaintenance: '/instances/maintenance'` và các path con trong `paths` của `routes/maintenance.ts`.

## (e) Dependency, binding, env

- Dependency: không thêm. Dùng `better-auth/crypto` (`hashPassword`, đã có trong `better-auth`), `tsx` (đã dùng cho test).
- Binding: không thêm. Dùng `JOBS_QUEUE` và cron `*/5` của p0.
- Env tùy chọn: `API_ACTIVITY_LOG_RETENTION_DAYS` (14), `WEBHOOK_LOG_RETENTION_DAYS` (14), `EMAIL_LOG_RETENTION_DAYS` (7, do notification dùng), `HARD_DELETE_AFTER_DAYS` (60), `APP_VERSION`, `LATEST_VERSION_URL`, `IS_TEST`. Có thể thêm vào `.dev.vars.example`. `configure-instance` đọc thêm các khóa trong `INSTANCE_CONFIG_VARIABLES` (ví dụ `ENABLE_SIGNUP`, `GOOGLE_CLIENT_ID`, `EMAIL_HOST`).
- Job tự đăng ký qua `import.meta.glob`: `maintenance.cleanup`, `maintenance.hard_delete`, `maintenance.soft_delete_related`, `maintenance.process_logs`, `maintenance.workspace_seed`, `maintenance.dummy_data`, `maintenance.copy_comment_descriptions`. Cron: `0 0` hard delete, `30 2` api logs, `0 3` page versions, `15 3` issue description versions, `30 3` webhook logs (UTC).

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Nối seed workspace (xem trên) và nối `softDeleteRelatedObjects` vào chỗ gọi `deleteRecord`: truyền `onSoftDeleted: id => enqueueSoftDeleteRelated('issues', id)` (tên bảng SQL). `p1-issue-core` hiện chỉ xóa mềm issue và ghi chú PD-1104 chưa chạy.
2. Dễ lỗi kiểu: `cascade.ts` (`fk.reference()`, `fk.onDelete`, kiểu `ReturnType<LancityDb['run']>` trong `db.batch`); `deletion.ts` (`db.all<{ id: number }>`); `ops.ts` (`changes(await db.update(...))`, insert `descriptions` từ `issueComments`); `workspace-seed.ts` (`issueId as unknown as number` cho subquery, `status` và `priority` của cột enum); `dummy-data.ts` (`db.batch` với các câu `returning`); `routes/maintenance.ts` (`listRuns` trả builder Drizzle đưa thẳng vào `c.json`).
3. `scripts/maintenance/d1-shim.ts` dùng `statement.columns()` và `setReturnArrays()` của Node 24 mà `src/types/database/node-sqlite.d.ts` chưa khai báo, nên đã khai báo kiểu cục bộ. Nếu muốn, bổ sung hai hàm đó vào file d.ts.
4. Dữ liệu seed: page seed không có `description_binary` nên cột này để trống, và `createViews` đặt `query` là `{}` (Plane dùng giá trị mặc định của model).
5. Ngân sách D1: một lần chạy Worker tối đa 1000 subrequest (trả phí), 50 (miễn phí). Seed workspace dùng khoảng 70 câu lệnh. Dummy data 1000 issue dùng vài trăm. `hardDelete` tự chia nhỏ qua hàng đợi. Với gói miễn phí hãy giảm số lượng dummy data hoặc dùng CLI.
6. Chưa kiểm thử trên D1 thật: `PRAGMA foreign_keys` luôn bật trên D1 nên các khóa ngoại tổng hợp `(project_id, workspace_id)` không có `ON DELETE` có thể chặn xóa cứng một số bảng. Khi đó `hardDelete` ghi bảng vào `failed` và log `maintenance.hard_delete`, chạy tiếp các bảng khác. Cần xem log sau lần chạy cron đầu.
7. `softDeleteRelatedObjects` bỏ qua khóa ngoại nhiều cột. Các khóa này chỉ nhắc lại quan hệ đã có khóa một cột riêng, nhưng nếu có bảng chỉ có khóa nhiều cột thì không được xóa dây chuyền.
8. Chưa có UI quản trị cho các endpoint này.
