# Handoff p1-auth (02-auth, 162 mục)

Chưa chạy test, build, typecheck. Đã chạy `pnpm exec eslint` trên các file của agent, không còn lỗi.

## (a) Trạng thái PD

Test tích hợp: [`tests/p1-auth.integration.mjs`](../../../tests/p1-auth.integration.mjs). Các ca chưa được chạy.

### Đã port hoặc gộp

| PD | Cách xử lý | Code |
| --- | --- | --- |
| 0267 | Gộp vào `GET /api/v1/users/me` | [users.ts](../../../src/server/api/v1/routes/users.ts) |
| 0812 | `findUser` | [queries.ts](../../../src/server/identity/queries.ts) |
| 0813 | Throttle theo action: 3 mã/giờ/user và 5 mã/giờ/địa chỉ đích | [account.ts](../../../src/server/identity/account.ts) |
| 0814, 0815, 0816, 0817, 0822, 0823, 0824, 0829, 0830 | Service và route `/users/me*`, `/users/session` | [service.ts](../../../src/server/identity/service.ts), [users.ts](../../../src/server/api/v1/routes/users.ts) |
| 0818, 0819, 0820 | `validateNewEmailUser`, `generateEmailVerificationCodeUser`, `updateEmailUser` (mã 6 số lưu trong bảng `verification` của Better Auth, gắn user id, 5 lần thử, 10 phút, đăng xuất sau khi đổi) | [account.ts](../../../src/server/identity/account.ts) |
| 0821 | `deactivateUser`. Chặn instance admin và admin duy nhất của workspace/project còn thành viên khác. Xóa session và tài khoản mật khẩu, reset onboarding, gửi mail. | [account.ts](../../../src/server/identity/account.ts) |
| 0825, 0826 | `getUserActivity` (cursor `size:page:0`, chỉ issue mà user còn là thành viên project) | [account.ts](../../../src/server/identity/account.ts), [queries.ts](../../../src/server/identity/queries.ts) |
| 0827, 0828 | `getAccount`/`getAccounts`/`deleteAccount` (không cho xóa phương thức đăng nhập cuối) | [service.ts](../../../src/server/identity/service.ts), [account.ts](../../../src/server/identity/account.ts) |
| 0362, 0363, 0365, 0366, 0369 | Zod: `personNameSchema`, `avatarAssetSchema`, `coverImageAssetSchema`, `changePasswordSchema` | [auth/schema.ts](../../../src/types/auth/schema.ts), [identity/schema.ts](../../../src/types/identity/schema.ts) |
| 0364, 0367, 0368, 1495 | `isOwnAsset`, `getIsOnboarded`, `presentWorkspaceSettings`, `formatUser`. Kiểm tra quyền sở hữu asset khi `avatar_asset`/`cover_image_asset` được cập nhật. | [presenters.ts](../../../src/server/identity/presenters.ts), [service.ts](../../../src/server/identity/service.ts) |
| 1034, 1056 | `checkEmail` (`POST /auth/email-check`). Mã lỗi Plane 5000..5999 giữ nguyên trong `error.details.error_code`. | [auth-flows.ts](../../../src/server/identity/auth-flows.ts), [auth-extra.ts](../../../src/server/api/v1/routes/auth-extra.ts) |
| 1035, 1036, 1051, 1057, 1058, 1073 | Better Auth (`/api/auth/sign-in/email`, `/sign-up/email`, `/sign-out`), thêm hook: throttle, độ mạnh mật khẩu, cờ bật/tắt email-password, chặn đăng ký khi `ENABLE_SIGNUP=0` (trừ khi có lời mời), chặn user bị vô hiệu hóa hoặc bot | [auth.ts](../../../src/lib/auth/auth.ts) |
| 1037..1042, 1059..1064 | GitHub/GitLab qua `socialProviders`, Gitea qua `genericOAuth`. Port đủ kiểm tra: email chính đã xác minh, `GITHUB_ORGANIZATION_ID`, `confirmed_at` của GitLab, `GITEA_HOST`. Initiate là `POST /api/auth/sign-in/social` (Gitea: `/sign-in/oauth2`), callback là `/api/auth/callback/:id`. | [providers.ts](../../../src/lib/auth/providers.ts), [auth.ts](../../../src/lib/auth/auth.ts) |
| 1043, 1044, 1065, 1066 | Google đã có, thêm cờ `IS_GOOGLE_ENABLED` | [auth.ts](../../../src/lib/auth/auth.ts) |
| 1045, 1046, 1047, 1067, 1068, 1069 | Magic code: Better Auth `emailOTP` (8 số, 10 phút, 5 lần thử, băm khi lưu, tối đa 4 mã/10 phút/email). Gói JSON ở `POST /auth/magic-generate`, `/magic-sign-in`, `/magic-sign-up`. | [auth-actions.ts](../../../src/server/identity/auth-actions.ts) |
| 0994..0999 | `MagicCodeProvider` gộp vào cấu hình `emailOTP` và `magicErrorFor` (SIGN_IN/SIGN_UP) | [auth.ts](../../../src/lib/auth/auth.ts), [auth-flows.ts](../../../src/server/identity/auth-flows.ts) |
| 1049, 1050, 1071, 1072, 1136 | Quên và đặt lại mật khẩu: token Better Auth (1 giờ, dùng một lần), mail qua `queueAuthMail`. Khác Plane: phản hồi giống nhau cho email không tồn tại (không lộ `USER_DOES_NOT_EXIST`). Token là một chuỗi, không có `uidb64`. | [auth-actions.ts](../../../src/server/identity/auth-actions.ts), [emails.ts](../../../src/server/identity/emails.ts) |
| 1054, 1055 | `POST /auth/change-password`, `/auth/set-password` (user không có mật khẩu thì bỏ qua mật khẩu cũ) | [auth-actions.ts](../../../src/server/identity/auth-actions.ts) |
| 1200 | Mail mã đăng nhập | [emails.ts](../../../src/server/identity/emails.ts) |
| 1015..1021 | Throttle 10/phút/IP (`AUTHENTICATION_RATE_LIMIT`), đếm trong D1, bỏ qua khi không có `cf-connecting-ip`. Throttle 3/giờ cho mã đổi email. | [throttle.ts](../../../src/server/identity/throttle.ts), [auth.ts](../../../src/lib/auth/auth.ts) |
| 1027, 1026 | `clientIp`; `baseHost` được thay bằng `BETTER_AUTH_URL` | [throttle.ts](../../../src/server/identity/throttle.ts) |
| 1028, 0970 | `recordLogin` (medium, IP, UA, `lastActive`) | [onboarding.ts](../../../src/server/identity/onboarding.ts) |
| 1030, 0965 | `isPasswordStrong` thay zxcvbn (chấm điểm tự viết, không thêm dependency) | [password.ts](../../../src/server/identity/password.ts) |
| 1031 | `getRedirectionPath` | [onboarding.ts](../../../src/server/identity/onboarding.ts) |
| 1032, 1033 | `postUserAuthWorkflow` gọi `processWorkspaceProjectInvitations` (file của agent workspace, đã có) | [onboarding.ts](../../../src/server/identity/onboarding.ts) |
| 1492, 1493, 1494, 1496, 1497, 1498, 1499, 1500, 1501 | `model-rules.ts` (display name, full name, avatar, chuẩn hóa email), `provisionUser` (profile, `user_security`, tùy chọn thông báo, idempotent) | [model-rules.ts](../../../src/server/identity/model-rules.ts), [onboarding.ts](../../../src/server/identity/onboarding.ts) |
| 0976, 0977, 0978 | `AUTHENTICATION_ERROR_CODES`, `authenticationError`, `getErrorDict`. Lỗi trả qua `handleApiError` hiện có. | [errors.ts](../../../src/server/identity/errors.ts) |
| 0957..0964, 0966, 0973..0975, 0979..0988, 0992, 0993, 1000..1014, 1029 | Thay thế bằng Better Auth (adapter, OAuth state, tạo/cập nhật account) cộng hook kiểm tra đăng ký, deactivated, bot. | [auth.ts](../../../src/lib/auth/auth.ts) |
| 0968, 0972 (một phần) | `ENABLE_{GOOGLE,GITHUB,GITLAB}_SYNC` bật `overrideUserInfoOnSignIn` (đồng bộ tên và ảnh khi đăng nhập). Gitea chưa có đồng bộ. | [providers.ts](../../../src/lib/auth/providers.ts) |
| 0989, 0990, 0991, 1022, 1023, 1024, 1025 | Có nền tảng: session cookie Better Auth và `protectCookieWrites` (kiểm tra origin) trong `src/server/api/v1/request-security.ts`. Không thêm code. | `src/lib/auth/server-session.ts` |
| 1048, 1070 | Token đặt lại là token `verification` của Better Auth (thay `PasswordResetTokenGenerator`) | [auth.ts](../../../src/lib/auth/auth.ts) |
| 1052, 1053 | Ngoài phạm vi: không có CSRF token. Better Auth và `protectCookieWrites` kiểm tra Origin cho request ghi mang cookie. | |
| 1481..1484 | Ngoài phạm vi: bảng `session` của Better Auth thay session store của Django | |
| 1485 | `formatSocialLoginConnection` | [presenters.ts](../../../src/server/identity/presenters.ts) |

PD-1056..1073 (các endpoint `spaces`) gộp vào cùng endpoint với app. Cả hai dùng chung cookie và phiên Better Auth.

### Để trống

- PD-0967, 0969, 0971, 0972 (phần tải avatar): Plane tải avatar OAuth về storage, xóa avatar cũ qua `FileAsset`. Lancity giữ nguyên URL ảnh của nhà cung cấp (đúng với nhánh fallback của Plane). Cần helper tải ảnh có chặn SSRF của nhóm asset (R2) rồi mới làm được.
- PD-0971 `delete_old_avatar`: cùng lý do.
- Gửi mail kích hoạt lại tài khoản (`user_activation_email`): đã có mẫu trong `emails.ts`, chưa dùng vì tài khoản bị vô hiệu hóa không được kích hoạt lại qua đăng nhập (theo GHSA-rmmf-rj2q-3rrg).
- Đồng bộ Gitea khi đăng nhập.

### API token

Không thuộc 162 mục của checklist này (PD-0430..0433 ở nhóm 11-integrations). Không làm trong p1-auth.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

```ts
import { authExtraRoutes } from '@/server/api/v1/routes/auth-extra'
app.route('/auth', authExtraRoutes) // nên dùng key linkto.apiAuthExtra = '/auth'
```

Endpoint: `GET /config`, `POST /email-check`, `/magic-generate`, `/magic-sign-in`, `/magic-sign-up`, `/forgot-password`, `/reset-password`, `/set-password`, `/change-password`. Các endpoint mới ở `users.ts` (đã mount sẵn dưới `/users`): `DELETE /me`, `PATCH /me/email`, `POST /me/email/generate-code`, `GET /me/activities`, `GET|DELETE /me/accounts/:accountId`.

## (c) Schema ext

File [`src/db/schema/ext-p1-auth.ts`](../../../src/db/schema/ext-p1-auth.ts) có hai bảng: `user_security` (is_active, is_bot, is_password_autoset, thông tin đăng nhập/đăng xuất) và `auth_counters` (cửa sổ đếm cho throttle và giới hạn mã).

- Thêm `export * from './schema/ext-p1-auth'` vào `src/db/schema.ts`.
- Tên migration gợi ý: `0003_auth_security`.
- Phải áp migration trước khi chạy: hook `user.create.after` ghi vào `user_security`, và hook đăng nhập đọc bảng này.
- Backfill đề xuất cho người dùng cũ: `insert into user_security (user_id) select id from user` (code đã tự tạo hàng khi thiếu, nên không bắt buộc).

## (d) Key linkto đề xuất

- `apiV1Routes.apiAuthExtra: '/auth'`.
- `apiV1Routes.currentUserEmail: '/me/email'`, `currentUserEmailCode: '/me/email/generate-code'`, `currentUserActivities: '/me/activities'`, `currentUserAccount: '/me/accounts/:accountId'`. Hiện `users.ts` ghép các đường dẫn này từ key sẵn có.
- Trang đặt lại mật khẩu dùng `/login?token=...` và `/login?forgot=1`, không cần route mới.

## (e) Dependency, binding, env

- Không thêm dependency (thay zxcvbn bằng `password.ts`).
- Env mới (secret, tùy chọn): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ORGANIZATION_ID`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `GITLAB_HOST`, `GITEA_CLIENT_ID`, `GITEA_CLIENT_SECRET`, `GITEA_HOST`, `AUTHENTICATION_RATE_LIMIT` (mặc định `10/minute`).
- Cờ bật/tắt đọc từ `instance_configurations` (không mã hóa) hoặc env, như `get_configuration_value`: `ENABLE_SIGNUP`, `ENABLE_EMAIL_PASSWORD`, `ENABLE_MAGIC_LINK_LOGIN`, `IS_{GOOGLE,GITHUB,GITLAB,GITEA}_ENABLED`, `ENABLE_{GOOGLE,GITHUB,GITLAB}_SYNC`. Provider GitHub/GitLab/Gitea cần `IS_*_ENABLED=1`. Google bật khi có đủ credentials, trừ khi `IS_GOOGLE_ENABLED=0`.
- Redirect URI của các provider: `<BETTER_AUTH_URL>/api/auth/callback/{github,gitlab,gitea}`.
- Không có binding mới. Mã đăng nhập, mã đổi email và mail đặt lại dùng `sendMail` qua job `identity.send_mail` ([jobs.ts](../../../src/server/identity/jobs.ts)). Cron `15 3 * * *` dọn `auth_counters`.
- i18n: chữ mới nằm trong [auth-messages.ts](../../../src/components/auth/auth-messages.ts) vì file `src/data/i18n/*.json` không thuộc phạm vi. Nên chuyển vào JSON khi tích hợp.
- `publicPaths` đã cho `/login` và `/register`, đủ cho luồng đặt lại mật khẩu bằng query string.

## (f) Việc còn dang dở và rủi ro

- Chưa chạy typecheck. Điểm có thể lệch kiểu: `getUserInfo` ép kiểu `never` trong `providers.ts`, `ctx.params?.id` và `ctx.headers` trong hook ở `auth.ts`, `db.batch` và `db.all` trong `account.ts`.
- Cấu hình provider (client id/secret) đọc từ env khi `createAuth()` chạy, đồng bộ. Cờ bật/tắt và đăng ký thì đọc từ DB theo request. Credentials chỉ có trong `instance_configurations` thì provider chưa được đăng ký. Cần `createAuth` bất đồng bộ hoặc giải mã bản ghi mã hóa của nhóm instance.
- `GET /auth/config` trả cờ công khai cho client mobile, chưa nối với `GET /instances` của nhóm instance.
- Test `p1-auth.integration.mjs` đọc mã đổi email thẳng từ bảng `verification`, nên cần `LANCITY_TEST_D1`. Ca kiểm tra throttle dựa vào giới hạn 10/phút mặc định.
- `isPasswordStrong` là heuristic, không tương đương zxcvbn. Có thể đổi sang thư viện khi integrator thêm dependency.
- Plane trả 200 với `USER_DOES_NOT_EXIST` ở quên mật khẩu, bản này trả thông điệp giống nhau để chống dò tài khoản.
