# Lancity

Ứng dụng dùng Vinext trên Cloudflare Workers, Cloudflare D1 với Drizzle ORM và Better Auth.

## Phát triển local

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Điền `BETTER_AUTH_SECRET` trong `.dev.vars` trước khi chạy ứng dụng. Có thể tạo secret bằng `openssl rand -hex 32`. Mở http://localhost:5173. Nếu thay đổi host hoặc port, cập nhật `BETTER_AUTH_URL` cho khớp.

Dùng `pnpm db:generate --name <ten-migration>` sau khi sửa schema và đưa cả SQL lẫn metadata Drizzle vào Git. Dùng `pnpm db:migrate:local` để áp dụng các migration mới.

## Schema database

Drizzle Kit đọc `src/db/schema.ts`. Các bảng được khai báo theo nhóm nghiệp vụ trong `src/db/schema/` và có Zod schema đọc/ghi ở `src/types/<domain>/schema.ts`. Ví dụ, `issueInsertSchema` kiểm tra dữ liệu trước khi ghi và `issueSchema` kiểm tra một hàng đã đọc qua Drizzle.

Migration `0001_plane_domain.sql` bổ sung các bảng nghiệp vụ từ [ERD Plane Demo](./docs/plane-demo-erd.md). Better Auth tiếp tục quản lý tài khoản và phiên. Zod schema ở đây kiểm tra dữ liệu lưu trữ. Các API cần schema đầu vào riêng và kiểm tra quyền theo workspace/project.

Migration `0002_issue_relation_workspace_scope.sql` chuyển ràng buộc trên hai issue của một quan hệ sang cùng workspace. API kiểm tra quyền truy cập vào từng project liên quan.

Migration `0003_backend_extensions.sql` thêm các bảng hạ tầng cho backend: bộ đếm xác thực (`auth_counters`), bảo mật người dùng (`user_security`), cache, giới hạn tốc độ, snapshot tiến độ cycle, khóa gửi email thông báo, xuất analytics, job nhập dữ liệu, trạng thái job instance và lịch sử bảo trì. Migration `0004_job_claims.sql` thêm bảng `job_claims` (khóa duy nhất theo `key`) để job nền chạy lại không ghi trùng. Xem [infrastructure.md](./docs/plane-demo-porting/infrastructure.md#idempotency-job).

## Giao diện HTTP

Client mục tiêu là web và mobile Lancity riêng, không tương thích client Plane gốc. Path nằm dưới `/api/v1` và khác path của Plane (ví dụ `work-items` thành `issues`, ID số thay UUID). Lỗi trả về dạng `{ "error": { "code", "message", "details" } }`. Danh sách path nằm ở `apiV1Routes` trong `src/data/linkto.ts`. [Ghi chú đối chiếu path](./docs/plane-demo-porting/endpoints.md).

- **Xác thực**: cookie phiên Better Auth hoặc header `X-API-Key` (token tạo ở `/users/api-tokens`, lưu dạng hash SHA-256 và khóa theo workspace).
- **CORS**: đặt `CORS_ALLOWED_ORIGINS` (danh sách origin cách nhau bằng dấu phẩy) cho trình duyệt ở origin khác. Ghi bằng cookie từ origin lạ bị chặn. Khi không đặt biến này, CORS trả `*` và không kèm credentials.
- **Giới hạn tốc độ**: `AUTHENTICATION_RATE_LIMIT`, `API_KEY_RATE_LIMIT`, `PUBLIC_ANON_RATE_LIMIT`, `PUBLIC_WRITE_RATE_LIMIT` (mẫu trong `.dev.vars.example`).

### Kết nối Live (soạn thảo page cộng tác)

Hợp đồng đầy đủ nằm ở comment đầu `src/server/api/v1/routes/live.ts`.

- `GET /api/v1/live/collaboration` nâng cấp lên WebSocket. Query bắt buộc: `workspaceSlug`, `documentType=project_page`, `pageId` (số, `documentName` là alias cho Hocuspocus provider). Query lạ bị từ chối. Project luôn lấy từ page, không lấy từ client.
- Xác thực bằng cookie phiên của request nâng cấp. Request có `Origin` phải thuộc `LIVE_CORS_ALLOWED_ORIGINS` hoặc `BETTER_AUTH_URL`. Client native không gửi `Origin`.
- Tin nhắn đầu tiên là auth message của Hocuspocus cho document `<pageId>`, token chứa `id` người dùng. Từ chối được trả bằng message `PermissionDenied` rồi đóng kết nối, không trả lỗi HTTP ở bước nâng cấp.
- `POST /api/v1/live/convert-document` và `POST /api/v1/live/force-close` chỉ dùng giữa server, cần header `live-server-secret-key` khớp `LIVE_SERVER_SECRET_KEY`.

API mobile dùng JSON ở `/api/v1`. Các form web tạo workspace, project, issue và page dùng Server Actions gọi cùng service với API. R2 local dùng bucket mô phỏng `lancity-assets`. Nếu triển khai tính năng upload ảnh, đặt `CLOUDFLARE_R2_BUCKET` thành tên bucket R2 đã tạo.

## Kiểm thử chuyển backend

```sh
pnpm exec tsx --test tests/*.test.ts tests/*.test.mjs
```

Với kiểm thử Worker, chạy `pnpm db:migrate:local` và `pnpm dev --port 4198` trong một bản sao repo dành riêng cho kiểm thử. Đặt các biến sau trong `.dev.vars` của bản sao, rồi khởi động lại dev server:

| Biến | Giá trị |
| --- | --- |
| `BETTER_AUTH_SECRET` | Secret thử nghiệm, ít nhất 32 ký tự |
| `BETTER_AUTH_URL` | `http://localhost:4198` (hoặc port đang dùng) |
| `LIVE_SERVER_SECRET_KEY` | Giá trị bất kỳ. Truyền cùng giá trị này trong môi trường chạy `p4-live.integration.mjs` |
| `INSTANCE_ENCRYPTION_KEY` | Khóa mã hóa cho `p3-instance.integration.mjs` |
| `PUBLIC_WRITE_RATE_LIMIT` | `1000/minute`. Mặc định `30/minute` làm `p3-public.integration.mjs` nhận 429 |

Dùng đường dẫn SQLite của D1 local từ `.cloudflare/state/v3/d1/`, bỏ qua `metadata.sqlite`. Các ca này thêm dữ liệu và trigger thử nghiệm vào database đã chọn. `p3-instance.integration.mjs` cần database chưa có instance.

```sh
LANCITY_TEST_D1=/path/to/isolated-d1.sqlite node --test --test-concurrency=1 tests/*.integration.mjs
```

Năm file sau import trực tiếp mã TypeScript, nên chạy bằng `pnpm exec tsx --test` thay cho `node --test`: `p1-issue-background`, `p2-cycle`, `p2-notification`, `p3-analytics` và `p3-integrations` (đều là `tests/<tên>.integration.mjs`).

```sh
LANCITY_TEST_D1=/path/to/isolated-d1.sqlite pnpm exec tsx --test --test-concurrency=1 \
  tests/p1-issue-background.integration.mjs tests/p2-cycle.integration.mjs \
  tests/p2-notification.integration.mjs tests/p3-analytics.integration.mjs tests/p3-integrations.integration.mjs
```

Các job nền (`page.transaction`, `page.version`) chạy qua Queue với `maxBatchTimeout` 5 giây, nên kết quả xuất hiện sau khoảng 5 giây. Test dùng vòng poll (tối đa 15 giây, mỗi 500 ms) thay cho assert tức thì.

Đối chiếu các PD và phần đang chờ trong [checklist chuyển backend](./docs/plane-demo-porting.md).

Checklist hiện có **2.268/2.348 mục đã tick**. Trong 80 mục còn trống, 75 mục được ghi là ngoài phạm vi. Cập nhật hàng loạt bằng `pnpm exec tsx scripts/checklist/extract-handoffs.ts` rồi `pnpm exec tsx scripts/checklist/apply-handoffs.ts`. Chi tiết trạng thái, phạm vi kiểm thử và quyết định hạ tầng nằm trong [checklist](./docs/plane-demo-porting.md), [review-fixes.md](./docs/plane-demo-porting/handoff/review-fixes.md) và [infrastructure.md](./docs/plane-demo-porting/infrastructure.md).

## Triển khai lên Cloudflare Workers

1. Tạo D1 `lancity-db` trong Cloudflare Dashboard hoặc chạy `pnpm exec cf d1 create --name lancity-db`. Lấy ID của database.
2. Xuất `CLOUDFLARE_D1_DATABASE_ID` trong môi trường chạy lệnh triển khai. Chạy `pnpm db:migrate:remote "$CLOUDFLARE_D1_DATABASE_ID"` để áp dụng migration lên database đó.
3. Đặt `BETTER_AUTH_URL` bằng URL HTTPS của Worker và `BETTER_AUTH_SECRET` bằng giá trị ngẫu nhiên dài ít nhất 32 ký tự. Lưu cả hai dưới dạng **Secret** trong **Variables and Secrets**. Nếu Worker chưa tồn tại, có thể thêm chúng sau lần triển khai đầu tiên, trước khi sử dụng trang xác thực.
4. Chạy `pnpm deploy`. Kiểm tra đăng ký, đăng nhập và đăng xuất trên URL production.

## Google OAuth tùy chọn

Đặt cả `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` trong `.dev.vars` để thử local. Trên production, cấu hình cả hai dưới dạng **Secret** trong **Variables and Secrets**. Đăng ký redirect URI chính xác trong Google Cloud Console, chẳng hạn `http://localhost:5173/api/auth/callback/google` cho local và `https://<worker-domain>/api/auth/callback/google` cho production.

Khi thiếu một trong hai giá trị, đăng nhập và liên kết Google sẽ tắt. Người dùng đã có tài khoản mật khẩu cần đăng nhập trước, rồi liên kết tài khoản Google đã xác minh cùng email trong trang **Tài khoản**.

```sh
pnpm lint
pnpm typecheck
pnpm build
```
