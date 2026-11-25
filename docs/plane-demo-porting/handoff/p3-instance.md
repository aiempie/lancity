# Handoff p3-instance (13-instance, 54 mục)

Chưa chạy test, build, typecheck. `pnpm exec eslint` trên các file của agent không còn lỗi hay cảnh báo.

Test tích hợp: [`tests/p3-instance.integration.mjs`](../../../tests/p3-instance.integration.mjs). Cần Worker cô lập, `LANCITY_TEST_D1`, `INSTANCE_ENCRYPTION_KEY` trong `.dev.vars` và database chưa có hàng `instances` (test tự tạo rồi xóa).

## (a) Trạng thái PD

Đã xong (kể cả PD-1529 vốn đã tick). Không có mục để trống. Các mục "Gộp" nằm trong cùng hàm với mục cha.

| PD | Cách xử lý | Code |
| --- | --- | --- |
| 1529 | Đã có từ trước (`requireInstanceAdmin`, role 20 vì check DB chỉ cho 20) | [permissions.ts](../../../src/server/instance/permissions.ts) |
| 1533, 1534, 1535 | `createInstanceAdmin`, `getInstanceAdmin`, `deleteInstanceAdmin` là alias của `addInstanceAdmin`, `listInstanceAdmins`, `removeInstanceAdmin` (giữ nguyên chữ ký cũ). Route `POST/GET /admins`, `DELETE /admins/:adminId`. | [admin.ts](../../../src/server/instance/admin.ts) |
| 1536 | `createInstanceAdminSignUp`, `POST /admins/sign-up` (JSON, không redirect). Tạo user qua Better Auth `signUpEmail`, giành quyền admin bằng một câu `insert ... where not exists` (thay `select_for_update` của Plane, D1 không có khóa dòng), nếu thua race thì xóa user vừa tạo. Cập nhật `is_setup_done`, tên công ty, telemetry, profile. | [admin.ts](../../../src/server/instance/admin.ts) |
| 1537 | `createInstanceAdminSignIn`, `POST /admins/sign-in`. Mã lỗi Plane 5000, 5155..5190 nằm ở `error.details.error_code`. Khác Plane: kiểm tra là admin trước mật khẩu, nên không tạo session cho người không phải admin; hai lỗi vẫn cùng `ADMIN_AUTHENTICATION_FAILED`. | [admin.ts](../../../src/server/instance/admin.ts) |
| 1538, 1539, 1540 | `getInstanceAdminUserMe`, `getInstanceAdminUserSession` (công khai), `createInstanceAdminSignOut` (luôn thành công, ghi `last_logout_*`, xóa cookie). | [admin.ts](../../../src/server/instance/admin.ts) |
| 1547, 1548 | `getInstanceConfiguration` = `listInstanceConfigurations`; `updateInstanceConfiguration` nhận `{KEY: value}`, cắt khoảng trắng, `null` thành `""`, boolean thành `1`/`0`, mã hóa khóa bí mật, tạo hàng mới cho khóa trong danh mục Plane (`instance_config_variables`), bỏ qua khóa lạ. Bỏ qua khóa = giữ nguyên, gửi `""` = xóa. | [configuration.ts](../../../src/server/instance/configuration.ts) |
| 1549 | `deleteDisableEmailFeature`, `DELETE /configurations/disable-email-feature` | [configuration.ts](../../../src/server/instance/configuration.ts) |
| 1550 | `createEmailCredentialCheck`, `POST /email-credentials-check` (cần admin, như `BaseAPIView` của Plane). Gửi qua `sendMail` với `EMAIL_HOST_USER`/`EMAIL_HOST_PASSWORD` đã lưu làm tài khoản Gmail. Host/port/TLS chỉ hiển thị, không dùng (Gmail cố định). Lỗi nodemailer được ánh xạ sang thông báo Plane. | [configuration.ts](../../../src/server/instance/configuration.ts) |
| 1551 | `getPermissionsInstance(method)`: PATCH cần admin, còn lại công khai | [service.ts](../../../src/server/instance/service.ts) |
| 1552 | `getInstanceInfo`, `GET /instances/info` trả `{config, instance}` giống Plane. `GET /instances/` giữ nguyên `{instanceName, isSetupDone}` vì test cũ kiểm tra deepEqual. Không trả `whitelist_emails`. | [service.ts](../../../src/server/instance/service.ts) |
| 1553 | `updateInstanceDetails` (`PATCH /instances/`): `instanceName`, `isTelemetryEnabled`, `isSupportRequired`, `whitelistEmails`, `domain`. Phản hồi như `updateInstance` cũ. `updateInstance` giữ nguyên. | [service.ts](../../../src/server/instance/service.ts) |
| 1554 | `markSignUpScreenVisited`, `POST /admins/sign-up-screen-visited` (204) | [service.ts](../../../src/server/instance/service.ts) |
| 1555, 1556, 1557, 1558 | `getInstanceWorkspaceAvailabilityCheck` (slug không phân biệt hoa thường, slug bị cấm tính là đã dùng), `getInstanceWorkspace` (phân trang 10/trang, `search`, `total_projects`, `total_members` không tính bot; 1557 là callback `on_results`, gộp), `createInstanceWorkspace` (bỏ qua `DISABLE_WORKSPACE_CREATION`, không seed project). `listInstanceWorkspaces` cũ giữ nguyên nhưng route `GET /workspaces` nay phân trang. | [workspace.ts](../../../src/server/instance/workspace.ts) |
| 1530 | `toInstanceConfigurationResponse`. Khác Plane: không trả giá trị giải mã của khóa bí mật (`value: null`, thêm `isSet`). | [presenters.ts](../../../src/server/instance/presenters.ts) |
| 1531, 1532 | `instanceWorkspaceNameSchema`, `instanceWorkspaceSlugSchema` (không URL, có chữ hoặc số, slug không bị cấm). Kiểm tra trùng slug nằm trong service. Đặt ở file Zod riêng vì không được sửa `schema.ts`. | [p3-instance-schema.ts](../../../src/types/instance/p3-instance-schema.ts) |
| 1541..1546 | `initialTimezone`, `filterQuerysetBase`, `handleExceptionBase` (= `handleApiError`), `dispatchBase` (thay bằng Hono `app.onError` + middleware chung, không viết code), `fieldsBase`, `expandBase` | [base.ts](../../../src/server/instance/base.ts) |
| 1559 | `createOtlpMetricExporter`: OTLP/HTTP JSON tới `OTLP_ENDPOINT/v1/metrics` (Workers không dùng được gRPC) | [telemetry.ts](../../../src/server/instance/telemetry.ts) |
| 1560..1576 | `collectAndPushMetrics`. Các callback gauge (1561..1569, 1571..1576) gộp thành danh sách `Gauge`, `_ws_attrs` (1570) là `wsAttrs`. Đếm nhóm theo workspace bằng 6 truy vấn `group by` cho 1000 workspace đầu. | [telemetry.ts](../../../src/server/instance/telemetry.ts) |
| 1577 | `pushInstanceMetrics` + job `instance.push_metrics`. **Mặc định tắt**: cần `TELEMETRY_ENABLED=1` và `instances.is_telemetry_enabled`. Cron `*/5 * * * *` chỉ đẩy khi đã qua `METRICS_PUSH_INTERVAL_MINUTES` (mặc định 360) kể từ lần đẩy thành công trước (lưu ở bảng `instance_job_state`). | [telemetry.ts](../../../src/server/instance/telemetry.ts), [jobs.ts](../../../src/server/instance/jobs.ts) |
| 1583, 1584, 1585 | `deriveKey` (PBKDF2-SHA256, 100000 vòng, salt `salt`, ra khóa AES-GCM 256), `encryptData`, `decryptData`. Định dạng `v1:<iv>.<ciphertext>` base64url, không đọc được dữ liệu Fernet cũ. `encryptData` ném lỗi 500 khi thiếu `INSTANCE_ENCRYPTION_KEY` (Plane trả `""`, sẽ xóa mất secret). `decryptData` trả `""` khi lỗi. | [encryption.ts](../../../src/server/instance/encryption.ts) |
| 1586, 1587 | `getConfigurationValue(db, [{key, default}], env)`: hàng cấu hình thắng, giải mã nếu mã hóa, thiếu hàng thì dùng default. `getEmailConfiguration(db, env)`. Thêm `getConfigurationMap`. | [instance-value.ts](../../../src/server/instance/instance-value.ts) |

## (b) Route

Không cần sửa `index.ts`: `instancesRoutes` đã được mount ở `linkto.apiInstances` và file vẫn export tên đó (thêm `export default`). Các route mới nằm trong cùng router, đã sắp thứ tự (route tĩnh `/admins/*` trước `/admins/:adminId`).

Route mới: `GET /info`, `POST /admins/sign-up|sign-in|sign-out|sign-up-screen-visited`, `GET /admins/me|session`, `GET /workspace-slug-check`, `POST /workspaces`, `DELETE /configurations/disable-email-feature`, `POST /email-credentials-check`.

Thay đổi hành vi của route cũ: `PATCH /configurations` nay nhận `{KEY: value}` bất kỳ và trả mảng cấu hình đã cập nhật (trước đó chỉ `DISABLE_WORKSPACE_CREATION` và trả `{DISABLE_WORKSPACE_CREATION: v}`). `GET /workspaces` nay trả dạng phân trang. `PATCH /` nhận thêm trường.

## (c) Schema ext

[`src/db/schema/ext-p3-instance.ts`](../../../src/db/schema/ext-p3-instance.ts): bảng `instance_job_state` (key, value). Thêm `export * from './schema/ext-p3-instance'` vào `src/db/schema.ts`. Tên migration gợi ý: `0004_instance_job_state`. Thiếu bảng thì chỉ job telemetry lỗi (đã tắt mặc định), mọi route khác vẫn chạy.

## (d) Key linkto

Hiện các đường dẫn mới nằm trong hằng `p3Paths` ở đầu [instances.ts](../../../src/server/api/v1/routes/instances.ts). Nên thêm vào `apiV1Routes` rồi thay: `instanceInfo: '/info'`, `instanceAdminMe: '/admins/me'`, `instanceAdminSession: '/admins/session'`, `instanceAdminSignUp: '/admins/sign-up'`, `instanceAdminSignIn: '/admins/sign-in'`, `instanceAdminSignOut: '/admins/sign-out'`, `instanceSignUpScreenVisited: '/admins/sign-up-screen-visited'`, `instanceDisableEmailFeature: '/configurations/disable-email-feature'`, `instanceEmailCredentialsCheck: '/email-credentials-check'`, `instanceWorkspaceSlugCheck: '/workspace-slug-check'`. (Lưu ý `apiV1Routes.workspaceSlugCheck` đã có ở cấp gốc, khác key.)

## (e) Dependency, binding, env

- Không thêm dependency hay binding.
- Env mới: `INSTANCE_ENCRYPTION_KEY` (secret, chuỗi ngẫu nhiên dài, ví dụ `openssl rand -hex 32`; **đổi khóa sẽ làm mất giá trị đã mã hóa**), `TELEMETRY_ENABLED` (mặc định không đặt = tắt), `OTLP_ENDPOINT`, `METRICS_PUSH_INTERVAL_MINUTES`, `SERVICE_NAME` (tùy chọn). Env tùy chọn cho `GET /info`: `ADMIN_BASE_URL`, `SPACE_BASE_URL`, `APP_BASE_URL`, `INSTANCE_CHANGELOG_URL`, `FILE_SIZE_LIMIT`, `GITHUB_APP_NAME`, `SLACK_CLIENT_ID`. Cần thêm vào `.dev.vars.example`.

## Liên quan p1-auth

[`settings.ts`](../../../src/server/identity/settings.ts) của p1-auth chỉ đọc hàng không mã hóa, nên `*_CLIENT_SECRET` do admin lưu ở đây (đã mã hóa) chưa được dùng. Cách nối: trong `loadAuthSettings` gọi `getConfigurationValue` từ `@/server/instance/instance-value` cho các khóa `*_CLIENT_SECRET`. Còn `createAuth()` đồng bộ nên provider cấu hình chỉ qua DB vẫn chưa được đăng ký (đã nêu trong handoff p1-auth). Các khóa dùng cùng tên với Plane nên không lệch.

## (f) Việc dang dở và rủi ro typecheck

- `admin.ts`: `createAuth().api.signUpEmail/signInEmail/signOut` với `returnHeaders: true` (kiểu trả về `{headers, response}`), `db.run(...).meta.changes` trên D1, `presentCurrentUser(...)` nhận `security ?? undefined`.
- Hook đăng ký của p1-auth (`ENABLE_SIGNUP=0`, throttle) cũng chạy khi gọi `signUpEmail` từ service. Nếu operator đặt `ENABLE_SIGNUP=0` trước khi setup, đăng ký admin đầu tiên sẽ bị chặn. Cần miễn hook khi `is_setup_done = false`.
- `telemetry.ts`: kiểu `Pick<InfraEnv, 'TELEMETRY_ENABLED'>` dựa vào index signature của `InfraEnv`.
- `workspace.ts`: `db.batch([...])` như `createWorkspace`; subquery đếm dùng tên bảng/cột SQL thô (`projects`, `workspace_members`, `user_security`).
- Không làm: `cache_response`/`invalidate_cache` của Plane trên `GET /instances/` và `/configurations/` (dữ liệu nhỏ, đọc thẳng D1; `GET /info` có `Cache-Control: private, max-age=12`).
- Email: chỉ Gmail SMTP (quyết định chủ dự án). `EMAIL_HOST/PORT/USE_TLS/USE_SSL` được lưu và hiển thị nhưng không điều khiển kết nối.
