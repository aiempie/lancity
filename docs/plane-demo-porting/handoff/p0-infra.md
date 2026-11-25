# Handoff p0-infra

## Đã hoàn thành
- `cloudflare.config.ts`: entrypoint `./src/worker.ts`, `nodejs_compat`, binding `JOBS_QUEUE`, queue consumer `lancity-jobs` (DLQ `lancity-jobs-dlq`), cron `*/5 * * * *`, secret `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM`. Đã đối chiếu kiểu `triggers.queue` và `triggers.scheduled` trong `@cloudflare/config` 1.0.0-rc.1.
- `package.json`/`pnpm-lock.yaml`: `nodemailer`, `@types/nodemailer` (và `hono`, đã có từ trước).
- `src/worker.ts`, `src/server/common/{env,mail,mail-templates,jobs,job-registry}.ts`, `.dev.vars.example`.
- Tài liệu: `docs/plane-demo-porting/infrastructure.md`.
- ESLint sạch trên các file này. Chưa chạy typecheck, build, test theo quy ước.

## Khác với yêu cầu ban đầu
- `job-registry.ts` dùng `import.meta.glob` (`src/server/*/jobs.ts`, `src/server/*/jobs/index.ts`) thay vì danh sách tường minh. File chưa tồn tại bị bỏ qua nên integrator không cần sửa. Mỗi file jobs phải export `register()`.
- Chưa sửa `src/server/api/v1/index.ts` vì hạ tầng không cần mount route.

## Cần integrator kiểm tra
1. `pnpm typecheck`: `import.meta.glob` cần `vite/client` (đã có `/// <reference>` trong file), `cloudflare:workers` cần kiểu Workers, kiểu `ExportedHandler` và `MessageBatch` trong `worker.ts`.
2. Gửi thử một email qua nodemailer trên `pnpm dev` và trên Worker deploy (rủi ro `node:dns`/`node:tls`, xem infrastructure.md). Chưa kiểm chứng thực tế.
3. `export * from 'vinext/server/fetch-handler'` không re-export `default`, và `default` nay là object trong `worker.ts`. Xác nhận bản build Vinext nhận entrypoint này (Vinext mong đợi default có `fetch`) và các export Durable Object vẫn xuất hiện ở entry.
4. Tạo queue `lancity-jobs` và `lancity-jobs-dlq` trước lần deploy đầu.

## Phiếu yêu cầu cho các nhóm khác
- Live (14): cần binding Durable Object, sửa `cloudflare.config.ts` và export class từ `src/worker.ts`.
- PDF: cần binding Browser Rendering.
- Workflows cho import/export lớn: chưa có binding.

## PD trong 01-platform.md (không sửa checklist, integrator tích)
- PD-1248 `_get_metrics_push_interval_minutes` → `getMetricsPushIntervalMinutes` trong `src/server/common/env.ts`. Đã xong. Đích `cloudflare.config.ts` không cần thay đổi (chu kỳ đọc từ env khi có consumer).
- PD-1249 `setup_loggers` và PD-1250 `setup_task_loggers` → `logJson` trong `env.ts` (log JSON một dòng, Workers tự thu thập). Không cần logger riêng cho task. Xong.
- Không có PD nào khác trong 01-platform.md nhắc tới Celery, task, mail hoặc cron (đã grep). Các PD Celery tasks và email nằm ở nhóm 06, 09, 15 và dùng `enqueueJob`, `registerJobHandler`, `registerScheduled`, `sendMail`.
