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

Test chạy bằng Vitest với cấu hình riêng `vitest.config.ts`, không nạp plugin `vinext` hay Cloudflare. Mỗi nhóm test là một project.

```sh
pnpm test                # project unit: tests/*.test.{ts,mjs}
pnpm test:integration    # project integration: tests/*.integration.mjs, chạy tuần tự từng file
pnpm exec vitest run --project editor    # editor trong happy-dom
pnpm exec vitest run --project browser   # editor trong Chromium thật (Playwright)
pnpm test:all            # mọi project
```

Project `browser` cần Chromium của Playwright. Cài một lần bằng `pnpm exec playwright install chromium`.

Unit test thay `cloudflare:workers` bằng stub `tests/stubs/cloudflare-workers.ts`.

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
LANCITY_TEST_D1=/path/to/isolated-d1.sqlite LIVE_SERVER_SECRET_KEY=<giá trị trong .dev.vars> pnpm test:integration
```

Project `integration` chạy từng file một (`fileParallelism: false`) vì các file dùng chung dev server và database. Timeout mỗi test là 30 giây. Chạy một file bằng `pnpm test:integration tests/<tên>.integration.mjs`.

Các job nền (`page.transaction`, `page.version`) chạy qua Queue với `maxBatchTimeout` 5 giây, nên kết quả xuất hiện sau khoảng 5 giây. Test dùng vòng poll (tối đa 15 giây, mỗi 500 ms) thay cho assert tức thì.

Đối chiếu các PD và phần đang chờ trong [checklist chuyển backend](./docs/plane-demo-porting.md).

Checklist hiện có **2.268/2.348 mục đã tick**. Trong 80 mục còn trống, 75 mục được ghi là ngoài phạm vi. Cập nhật hàng loạt bằng `pnpm exec tsx scripts/checklist/extract-handoffs.ts` rồi `pnpm exec tsx scripts/checklist/apply-handoffs.ts`. Chi tiết trạng thái, phạm vi kiểm thử và quyết định hạ tầng nằm trong [checklist](./docs/plane-demo-porting.md), [review-fixes.md](./docs/plane-demo-porting/handoff/review-fixes.md) và [infrastructure.md](./docs/plane-demo-porting/infrastructure.md).

## Editor

`src/components/editor` là bản chụp một lần của editor Plane (`@plane/editor`, cùng các phần nó dùng trong `@plane/blocks`, `@plane/utils`, `@plane/hooks`, `@plane/types` và Propel). Mã không theo dõi bản gốc nữa. Sửa thẳng ở đây và giữ logic gần Plane để dễ đối chiếu. Chỗ Lancity chủ động khác Plane có comment `Lancity:`.

| Thư mục | Nội dung |
| --- | --- |
| `components/`, `extensions/`, `plugins/`, `hooks/`, `helpers/`, `constants/`, `contexts/`, `types/` | Mã `@plane/editor` |
| `blocks/` | Emoji/icon picker, skeleton và `placement` lấy từ `@plane/blocks` |
| `lib/` | Markdown parser, `sanitize-html` (DOMParser), `asset-id` lấy từ `@plane/utils` |
| `propel/` | Propel khôi phục từ source map. `Button` và `IconButton` chạy trên `@/components/ui/button` |
| `icons.tsx` | Tên icon Propel trỏ sang `@phosphor-icons/react`. Callout vẫn lưu tên Lucide trong `data-icon-name` |
| `styles/` | CSS editor và `tokens.css` (token Plane ánh xạ sang biến shadcn), nạp trong `src/app/globals.css` |
| `i18n.ts` | `useEditorTranslations()` cho component, `translateEditor()` cho mã ngoài React. Chuỗi nằm ở nhóm `editor` của `src/data/i18n/*.json` |

Type dùng chung với ứng dụng nằm ở `src/types/editor/schema.ts`. Hook `useOutsideClickDetector` nằm ở `src/hooks/`.

**Quy tắc import.** Ngoài `src/components/editor` chỉ import từ `@/components/editor` (`RichTextEditorWithRef`, `LiteTextEditorWithRef`, `CollaborativeDocumentEditorWithRef` và type). ESLint (`no-restricted-imports`) chặn import sâu hơn. Editor chỉ chạy ở client. Trang dùng editor nên nạp nó trong một client component bằng `next/dynamic` với `ssr: false`, để chunk editor (khoảng 620 kB gzip) chỉ tải trên trang đó.

**Ảnh lưu trên R2.** `useEditorFileHandler` (`src/hooks/use-editor-file-handler.ts`) trả về `fileHandler` cho editor. Hook này dựa trên `createEditorFileHandler` (`src/lib/editor/file-handler.ts`) và gọi các route asset của project như Plane web:

1. `POST /api/v1/workspaces/:slug/projects/:projectId/entity-assets` đăng ký asset với `entity_type` và `entity_identifier`.
2. `PUT` byte ảnh tới `upload_data.url` bằng `XMLHttpRequest` để có tiến độ tải lên. Worker ghi vào R2 (`ASSET_BUCKET`).
3. `PATCH …/entity-assets/:assetId` xác nhận. Asset chưa xác nhận bị job dọn dẹp xóa.

Node ảnh lưu id số của asset trong `src`. Editor hiển thị ảnh qua `…/entity-assets/:assetId?disposition=inline`. Xóa, khôi phục, kiểm tra tồn tại và nhân bản dùng các route asset của workspace. Giá trị `src` không phải id số thì không được gửi tới API.

```tsx
const fileHandler = useEditorFileHandler({
  workspaceSlug,
  projectId,
  entityType: EFileAssetType.PAGE_DESCRIPTION,
  entityId: pageId
})
```

Kích thước tối đa mặc định là 5 MB. Giá trị này phải khớp `FILE_SIZE_LIMIT` của Worker. Editor giữ handler mà nó mount lần đầu, nên khi đổi page hoặc project cần mount editor mới, ví dụ bằng `key`.

**Khác với Plane CE**

- `aiEnabled` (mặc định `false`) bật nút AI ở side menu. Menu AI chỉ hiện khi có cả `aiHandler.menu`. Cờ `'ai'` trong `disabledExtensions` không còn điều khiển nút này.
- Document editor luôn có node `issue-embed-component`. Plane CE thiếu node này, nên y-tiptap xóa embed khỏi tài liệu chung khi mở trang. `extendedEditorProps.embedHandler` vẽ embed, `searchCallback` bật lệnh `/` "Công việc".
- Con trỏ người cộng tác dùng `@tiptap/extension-collaboration-caret`, tắt bằng `disabledExtensions: ['collaboration-cursor']`.
- `realtimeConfig.WebSocketPolyfill` cho phép thay WebSocket, dùng cho máy chủ Hocuspocus giả trong test trình duyệt.
- Bản lưu offline dùng y-indexeddb như Plane, tên database là id tài liệu.

**Kích thước bundle** (`pnpm build`)

- Chưa trang nào import editor, nên bundle client và Worker không chứa JS của editor. Khi `/dev/editor` còn tồn tại, chunk editor client là 2.412 kB raw / 620 kB gzip, chỉ tải trên trang gọi `import()` qua `next/dynamic`. Môi trường SSR cũng đóng gói chunk đó (2,6 MB raw) dù có `ssr: false`. Giới hạn kích thước Worker là 64 MiB.
- CSS editor nằm trong `globals.css`, nên mọi trang tải thêm khoảng 15 kB gzip (CSS client 33 kB → 141 kB raw).
- Code block nạp sẵn bộ ngôn ngữ `common` của lowlight trong chunk editor, giống Plane.

**Giới hạn đã biết**

- Editor chưa được gắn vào màn hình nào. Màn hình page hiện vẫn dùng ô `textarea`.
- `is-emoji-supported` ghi cảnh báo Canvas2D trong console, giống Plane.

### Test của editor

`tests/editor/harness/` chứa máy chủ Hocuspocus chạy trong trình duyệt (`local-live.ts`, dùng lại `CollaborationDocument` của Worker), kho ảnh bằng object URL, mention, công việc và AI giả. Các test trình duyệt trong `tests/editor/*.browser.test.tsx` dùng những phần này cho cộng tác, ảnh, mention, embed và AI. `tests/editor-assets.integration.mjs` chạy file handler R2 với Worker và R2 local.

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
