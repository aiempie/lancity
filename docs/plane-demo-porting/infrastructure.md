# Hạ tầng dùng chung (Phase 0)

Tài liệu này mô tả các quyết định và cách dùng hạ tầng nền cho việc port backend Plane Demo. Mọi nhóm chỉ import từ `src/server/common/`. Không nhóm nào sửa `cloudflare.config.ts`, `package.json`, `src/worker.ts`.

## Quyết định

| Nhu cầu trong Plane | Dịch vụ ở Lancity | Ghi chú |
| --- | --- | --- |
| Celery task | Cloudflare Queues (`JOBS_QUEUE`, queue `lancity-jobs`, DLQ `lancity-jobs-dlq`) | Consumer là chính Worker, `src/worker.ts` export `queue`. Tối đa 5 lần thử, backoff mũ 30s đến 1 giờ. |
| Celery beat | Cron Triggers | Một trigger `*/5 * * * *`. Các job định kỳ khai báo bằng `registerScheduled(cron, fn)` và được so khớp trong code (UTC). |
| Email (Django SMTP) | nodemailer qua Gmail SMTP, `smtp.gmail.com:465` | Secret `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM`. |
| Lưu file (S3/MinIO) | R2, binding `ASSET_BUCKET`, bucket `lancity-assets` | Binding chỉ khai báo khi đặt `CLOUDFLARE_R2_BUCKET` hoặc chạy local. |
| Live (plane-live, Hocuspocus) | Durable Objects (một DO cho mỗi page) + WebSocket | Chưa tạo binding. Nhóm 14-live thêm class DO và binding vào `src/worker.ts` và `cloudflare.config.ts` qua phiếu gửi cho p0-infra. |
| Xuất PDF | Browser Rendering | Chưa tạo binding. Nhóm xuất PDF xin thêm `bindings.browser()` tương tự. |
| Redis cache | Chưa dùng. Dùng D1 hoặc Cache API khi cần | Quyết định theo từng nhóm. |
| Workflows | Dành cho tác vụ dài (import/export lớn) khi một job Queue không đủ thời gian | Chưa tạo binding. |

## Luồng chạy

- `src/worker.ts` bọc `vinext/server/fetch-handler`. `fetch` chuyển cho Vinext. `queue` gọi `handleQueueBatch`. `scheduled` gọi `handleScheduledEvent`.
- `export *` từ `vinext/server/fetch-handler` giữ các export có tên (Durable Object, Workflow) của entry Vinext.
- `job-registry.ts` dùng `import.meta.glob` nạp tự động `src/server/<domain>/jobs.ts` và `src/server/<domain>/jobs/index.ts`. File chưa tồn tại bị bỏ qua, nên không cần sửa registry. Mỗi file phải export `register()`.
- Registry được nạp một lần, ngay trước lần dispatch đầu tiên hoặc lần `scheduled` đầu tiên của isolate.

## Gửi email

```ts
import { sendMail } from '@/server/common/mail'
import { linkEmail } from '@/server/common/mail-templates'

const mail = linkEmail('Bạn được mời', 'Lời mời vào workspace', 'Bấm nút để tham gia.', 'Tham gia', url)
await sendMail({ to: email, ...mail })
```

- `sendMail({ to, subject, html?, text?, replyTo? })` cần ít nhất `html` hoặc `text`. Thiếu `GMAIL_USER` hoặc `GMAIL_APP_PASSWORD` thì ghi log cảnh báo và trả `{ sent: false }`, không ném lỗi, để chạy local không cần SMTP.
- Template dùng chung ở `mail-templates.ts`: `renderEmail`, `codeEmail`, `linkEmail`. Mọi giá trị chèn vào HTML đều được escape.
- Trong request, gửi email qua job (`enqueueJob`) để không chặn phản hồi và được retry.
- `sendMail` mặc định đọc env hiện tại bằng `getEnv()` (`cloudflare:workers`). Trong handler job, truyền `env` nhận được làm tham số thứ hai.

### Rủi ro của nodemailer trên Workers

- nodemailer dùng `node:net` và `node:tls`. Workers hỗ trợ chúng khi có `nodejs_compat` (đã bật, compatibility date 2026-11-20), kết nối TCP đi ra qua socket của Workers. Cổng 465 (TLS ngầm định) được phép. Cổng 25 bị Cloudflare chặn, nên không dùng.
- nodemailer tra DNS qua `node:dns`. Nếu môi trường chạy không hỗ trợ đầy đủ, gửi mail sẽ lỗi lúc chạy. Chưa kiểm thử trên Worker thật vì quy ước dự án cấm chạy build và test trong Phase 0. Integrator cần gửi thử một email trên `pnpm dev` và trên bản deploy.
- Gmail giới hạn khoảng 500 email mỗi ngày với tài khoản thường và yêu cầu app password (bật xác minh 2 bước). Cần dịch vụ chuyên dụng nếu vượt mức.
- Mỗi lần gửi mở một kết nối SMTP mới (transport được đóng sau khi gửi). Không thích hợp để gửi hàng loạt trong một request. Dùng job.
- Phương án dự phòng nếu nodemailer không chạy: thay phần thân `sendMail` bằng API HTTP (ví dụ Cloudflare Email Sending), giữ nguyên chữ ký hàm.

## Job nền

```ts
// src/server/notification/jobs.ts
import { registerJobHandler, registerScheduled } from '@/server/common/jobs'

export const SEND_DIGEST = 'notification.send_digest'

export function register(): void {
  registerJobHandler<{ userId: number }>(SEND_DIGEST, async (payload, env) => {
    // idempotent work
  })
  registerScheduled('0 2 * * *', async env => {
    // runs daily at 02:00 UTC
  })
}
```

Đẩy job từ service hoặc route:

```ts
import { getEnv } from '@/server/common/env'
import { enqueueJob } from '@/server/common/jobs'

await enqueueJob(getEnv(), { type: SEND_DIGEST, payload: { userId }, delaySeconds: 60 })
```

Thêm job mới:

1. Đặt tên loại job theo dạng `<domain>.<hanh_dong>` và export hằng số từ file jobs của domain.
2. Gọi `registerJobHandler` hoặc `registerScheduled` bên trong `register()` của `src/server/<domain>/jobs.ts` (hoặc `jobs/index.ts`).
3. Payload phải là JSON thuần (Queues dùng structured clone, tối đa 128 KB). Truyền ID, không truyền đối tượng lớn.
4. Handler phải idempotent vì Queues giao ít nhất một lần và retry khi lỗi. Ném lỗi để retry, kiểu job không có handler bị bỏ và ghi log.
5. Cron phải rơi vào mốc 5 phút (`*/5`, `0 * * * *`, `30 3 * * *`...). Cú pháp hỗ trợ: `*`, `a`, `a-b`, `*/n`, `a-b/n`, danh sách `a,b`. Giờ UTC. Ngày trong tháng và thứ trong tuần được AND, khác chuẩn cron (OR).

Khi không có binding `JOBS_QUEUE` (local), `enqueueJob` chạy handler ngay: dùng `ctx.waitUntil` nếu truyền tham số thứ ba, ngược lại chạy inline. `delaySeconds` bị bỏ qua ở chế độ này. Tránh suy ra thứ tự thực thi từ Queues vì không đảm bảo.

## Idempotency job

Queues giao ít nhất một lần. Job có tác dụng phụ không thể lặp (activity, thông báo, fan-out webhook) dùng bảng `job_claims` (migration `0004_job_claims.sql`, khóa duy nhất theo `key`). Helper nằm ở `src/server/common/job-claims.ts`.

- `meta.jobId`: `registerJobHandler` truyền `{ jobId: message.id }` làm đối số thứ ba của handler. Khóa claim ghép từ loại job và `jobId`, ví dụ `<type>:<jobId>`. Job con sinh ra từ job cha lấy ID dẫn xuất từ `jobId` cha.
- Job tự ghi kết quả: thêm `jobClaimStatement` vào cùng batch D1 với phần ghi. Giao lại sau khi batch đã commit thì `checkJobClaim` báo `done` và job bỏ qua. Batch đồng thời bị trùng khóa sẽ rollback toàn bộ.
- Job fan-out hoặc gửi đi (không ghi claim cùng batch được): gọi `claimJob` trước khi làm việc. `false` nghĩa là lần giao trước đã giữ claim. Khi job lỗi, gọi `releaseJobClaim` để lần retry của queue chạy lại.
- Khi bảng `job_claims` chưa có (chưa áp migration), job chạy không dedupe và ghi cảnh báo, không lỗi.
- Chạy local không qua Queue thì không có `jobId`, job chạy không dedupe.
- Dọn claim cũ theo `JOB_CLAIM_RETENTION_DAYS` (mặc định 7 ngày) trong job bảo trì.

## HTTP: X-API-Key và CORS

- **X-API-Key.** Middleware ở `src/server/api-token/authentication.ts` đọc header `X-API-Key`, so hash SHA-256 với bảng `api_tokens`, từ chối token không tồn tại, vô hiệu, hết hạn hoặc có chủ bị vô hiệu bằng `401`. Token gắn với một workspace chỉ truy cập workspace đó. Key không dùng được ở route quản lý token, quản trị instance và đổi mật khẩu. Header bị che giá trị khi ghi log. Giới hạn tốc độ theo key bằng `API_KEY_RATE_LIMIT` và chạy trước bước xác thực, nên key sai cũng bị tính.
- **CORS.** `createApiCors` (`src/server/api/v1/request-security.ts`) đọc `CORS_ALLOWED_ORIGINS` (danh sách cách nhau bằng dấu phẩy) cùng các URL công khai (`WEB_URL`, `APP_BASE_URL`, `ADMIN_BASE_URL`, `SPACE_BASE_URL`, `LIVE_BASE_URL`, `BETTER_AUTH_URL`). Có origin cấu hình thì trả đúng origin kèm credentials. Không cấu hình gì thì trả `*` và không kèm credentials. `X-API-Key` luôn nằm trong header cho phép. Ghi bằng cookie từ origin chưa cấu hình bị chặn.
- **Live.** Socket dùng `LIVE_CORS_ALLOWED_ORIGINS` (hoặc `BETTER_AUTH_URL`) và tự xác thực. Hai route giữa server cần header `live-server-secret-key`.

## Biến môi trường

| Tên | Loại | Ghi chú |
| --- | --- | --- |
| `GMAIL_USER` | Secret | Địa chỉ Gmail dùng để đăng nhập SMTP. |
| `GMAIL_APP_PASSWORD` | Secret | App password 16 ký tự. |
| `MAIL_FROM` | Secret | Ví dụ `Lancity <user@gmail.com>`. Gmail ghi đè địa chỉ gửi nếu không khớp tài khoản. Mặc định `GMAIL_USER`. |
| `CLOUDFLARE_R2_BUCKET` | Env lúc deploy | Tên bucket R2. |

Local, điền các biến vào `.dev.vars` (mẫu ở `.dev.vars.example`). Production, đặt Secret trong Variables and Secrets. Các Secret này chỉ được khai báo binding khi không có `CLOUDFLARE_D1_DATABASE_ID`, theo cùng cơ chế của Better Auth và Google OAuth.

Trước lần deploy đầu, tạo hai queue: `pnpm exec cf queues create lancity-jobs` và `lancity-jobs-dlq` (hoặc qua Dashboard), vì binding và consumer tham chiếu tới chúng.

## Hàm tiện ích chung (`env.ts`)

- `getEnv()`: env của lần gọi Worker hiện tại.
- `runInBackground(promise, label)`: bọc `waitUntil` và log lỗi.
- `retentionDays(raw, fallback)` và `getMetricsPushIntervalMinutes(raw)`: đọc cấu hình retention và chu kỳ metrics như Plane.
- `logJson(level, label, data)`: log JSON một dòng, thay logger JSON của Celery.
