# Checklist chuyển backend Plane Demo sang Lancity

Checklist này dùng source Plane Demo tại commit `da21a8ff8b`. Có **2.290 function, method và callback gốc**, **58 adapter kế thừa từ DRF** và **728 mục endpoint/handler** để lần từ controller. Mỗi function có một mã và một ô đánh dấu riêng. [Danh mục endpoint → đầu việc](./plane-demo-porting/endpoints.md) · [Đồ thị gọi hàm](./plane-demo-backend.html)

Phạm vi gồm **1.984 mục Python, 58 adapter DRF và 306 mục TypeScript Live/PDF**. Chủ dự án đã chốt đưa Live và PDF vào phạm vi, nên nhóm 14 không còn là tài liệu đối chiếu. Mức tương đương theo từng PD được theo dõi bằng ô đánh dấu trong từng nhóm.

> **Tình trạng hiện tại là 2.268/2.348 mục được đánh dấu `[x]` (96,6%).** Còn 80 mục trống, gồm 75 mục ngoài phạm vi. Trong số mục đã tick, 2.229 mục mang nhãn `có test nhóm`, 6 mục mang nhãn `chưa có test riêng` và 33 mục được tick từ trước kèm kiểm thử. Xem [kết quả triển khai theo đợt](#kết-quả-triển-khai-theo-đợt) và [vòng sửa theo review](./plane-demo-porting/handoff/review-fixes.md).

## Kiến trúc đích

```text
Web Server Action ─────────────┐
                               ├─ src/server/<domain>/service.ts ── Drizzle ── D1
Mobile → Route Handler → Hono ─┘
```

- **Một Worker `lancity`**. `src/app/api/v1/[[...route]]/route.ts` chuyển request vào Hono ở `src/server/api/v1/index.ts`. Router mobile theo nghiệp vụ nằm trong `src/server/api/v1/routes/`.
- **Web** dùng Server Action cho thao tác ghi, đặt cạnh trang gọi action. Server Components đọc qua service khi cần dữ liệu để render. Action lấy phiên, gọi service rồi xử lý phản hồi UI.
- **Mobile** gọi HTTP JSON dưới `/api/v1`. Hono kiểm tra input và định dạng lỗi. `src/proxy.ts` để API đi đến handler xác thực và trả JSON. Luồng chuyển về trang đăng nhập áp dụng cho trang web.
- **Dùng chung** `src/lib/auth/server-session.ts` để đọc phiên Better Auth và `src/db/client.ts` để lấy Drizzle từ D1 binding. Quyền workspace/project và quy tắc ghi dữ liệu nằm trong service. Zod input và DTO nằm trong `src/types/<domain>/schema.ts`. Đường dẫn ứng dụng và API nằm trong `src/data/linkto.ts`.
- **Tác vụ và tính năng riêng** dùng dịch vụ Cloudflare theo [bảng quyết định hạ tầng](#quyết-định-hạ-tầng): Queues và Cron Triggers cho job, R2 cho file, Durable Objects cho Live, Browser Rendering cho PDF, nodemailer qua Gmail cho email.

## Thứ tự thực hiện đề xuất

| Đợt | Phạm vi                                                              | Kết quả kiểm tra                                                                                                                    |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Route Handler, Hono, đọc session, lỗi JSON và quyền dùng chung       | Trình duyệt và mobile dùng cùng phiên phía server. API trả `401` khi thiếu phiên và `403` khi thiếu quyền.                          |
| 02  | Luồng danh sách workspace, sau đó tạo, cập nhật và thành viên        | Mobile gọi được `GET /api/v1/workspaces`. Người dùng chỉ thấy workspace mình có quyền. Action và Hono dùng chung `createWorkspace`. |
| 03  | Project và thành viên project                                        | Liệt kê, tạo, cập nhật theo workspace và kiểm tra liên kết chéo phạm vi.                                                            |
| 04  | Issue, state, nhãn, comment và các thao tác ghi cốt lõi              | Cùng `createIssue` cho web và mobile. Tạo đồng thời giữ số issue duy nhất theo project.                                             |
| 05  | Lịch sử issue, cycle, module, estimate, intake, draft, page và asset | Kiểm tra quan hệ nghiệp vụ, lịch sử thay đổi và luồng file theo từng tính năng.                                                     |
| 06  | Thông báo, tìm kiếm, báo cáo, tích hợp và chia sẻ                    | Mỗi tính năng có phạm vi truy cập, định dạng response và luồng job phù hợp.                                                         |
| 07  | Instance, Live và PDF                                                | Chốt nhu cầu vận hành, realtime và render trước khi lên lịch triển khai.                                                            |

### Chuỗi đầu việc bắt đầu từ endpoint

| Nghiệp vụ           | Nơi viết và đối chiếu                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phiên đăng nhập     | Tạo helper ở `src/lib/auth/server-session.ts` dựa trên luồng Better Auth hiện có. Đối chiếu [đăng nhập email của Plane](./plane-demo-porting/02-auth.md#pd-1035) và [quyền dựa trên vai trò](./plane-demo-porting/01-platform.md#pd-0271).                                                                                                                                       |
| Danh sách workspace | `GET /api/v1/workspaces` ở `src/server/api/v1/routes/workspaces.ts` gọi [`listWorkspaces`](./plane-demo-porting/03-workspace.md#pd-0866) trong `src/server/workspace/service.ts`.                                                                                                                                                                                                |
| Tạo workspace       | Server Action ở `src/app/workspaces/actions.ts` và `POST /api/v1/workspaces` gọi [`createWorkspace`](./plane-demo-porting/03-workspace.md#pd-0865).                                                                                                                                                                                                                              |
| Tạo project         | Server Action ở `src/app/projects/actions.ts` và Hono router `projects.ts` gọi [`createProject`](./plane-demo-porting/04-project.md#pd-0739) trong `src/server/project/service.ts`.                                                                                                                                                                                              |
| Tạo issue           | Server Action ở `src/app/issues/actions.ts` và Hono router `issues.ts` dùng [`createIssueInputSchema`](./plane-demo-porting/05-issue.md#pd-0322) rồi gọi [`createIssue`](./plane-demo-porting/05-issue.md#pd-0586). Đối chiếu phần ghi của [serializer](./plane-demo-porting/05-issue.md#pd-0323) và các quy tắc trong [`Issue.save`](./plane-demo-porting/05-issue.md#pd-1418). |

## Danh mục checklist

Số liệu `[x]` và `[ ]` được đếm trên từng file sau khi chạy `scripts/checklist/apply-handoffs.ts`.

| Nhóm | Function gốc | Adapter kế thừa | Đã tick `[x]` | Còn trống `[ ]` |
| --- | ---: | ---: | ---: | ---: |
| [01. Nền tảng API và phân quyền](./plane-demo-porting/01-platform.md) | 282 | 0 | 277 | 5 |
| [02. Xác thực và danh tính](./plane-demo-porting/02-auth.md) | 162 | 0 | 152 | 10 |
| [03. Workspace](./plane-demo-porting/03-workspace.md) | 132 | 9 | 141 | 0 |
| [04. Project](./plane-demo-porting/04-project.md) | 122 | 4 | 126 | 0 |
| [05. Issue, trạng thái và cộng tác](./plane-demo-porting/05-issue.md) | 267 | 9 | 262 | 14 |
| [06. Job, lịch sử và phiên bản issue](./plane-demo-porting/06-issue-background.md) | 67 | 0 | 67 | 0 |
| [07. Cycle, module, estimate, intake và draft](./plane-demo-porting/07-planning.md) | 221 | 19 | 236 | 4 |
| [08. Page, mô tả và asset](./plane-demo-porting/08-content.md) | 135 | 0 | 135 | 0 |
| [09. Thông báo, email và ghi chú](./plane-demo-porting/09-notification.md) | 57 | 4 | 61 | 0 |
| [10. View, tìm kiếm, báo cáo, nhập và xuất](./plane-demo-porting/10-reporting.md) | 215 | 8 | 223 | 0 |
| [11. Webhook và tích hợp](./plane-demo-porting/11-integrations.md) | 48 | 0 | 48 | 0 |
| [12. Chia sẻ công khai](./plane-demo-porting/12-public.md) | 67 | 5 | 67 | 5 |
| [13. Quản trị instance](./plane-demo-porting/13-instance.md) | 54 | 0 | 54 | 0 |
| [14. Live và PDF](./plane-demo-porting/14-live.md) | 307 | 0 | 281 | 26 |
| [15. Bảo trì, seed và CLI](./plane-demo-porting/15-maintenance.md) | 87 | 0 | 71 | 16 |
| [16. Data migration](./plane-demo-porting/16-migrations.md) | 67 | 0 | 67 | 0 |
| **Tổng** | **2.290** | **58** | **2.268** | **80** |

## Cách cập nhật trạng thái

- `[ ]` là chưa chuyển hoặc chưa xác nhận chức năng thay thế. `[x]` là đã chuyển hoặc đã xác nhận tương đương qua kiểm thử. Khi đánh dấu, thêm link đến file thực tế và ghi ca kiểm thử liên quan ngay ở mục đó.
- **Port** là chuyển nghiệp vụ. **Gộp** là rà soát các biến thể và dùng chung hàm khi hành vi khớp. **Thay thế** là dùng tính năng runtime hoặc thư viện tương đương. **Có nền tảng** ghi các phần Lancity đã có để đối chiếu. **Theo nhu cầu** và **Tham chiếu** giúp giữ dấu vết các function cần quyết định phạm vi, ví dụ CLI, job định kỳ và migration Django.
- Với mục tick từ handoff, dòng trạng thái ngay dưới mục (kết thúc bằng `<!-- handoff-status -->`) ghi cách xử lý, file mã, file test và handoff nguồn. Nhãn **`Đã chuyển, có test nhóm`** nghĩa là file test của nhóm tồn tại trong `tests/` và đã qua, không có nghĩa mỗi mục có một ca riêng. Nhãn **`Đã chuyển, chưa có test riêng`** nghĩa là chưa có file test nào cho mục đó. Lọc bằng `grep -c 'Đã chuyển, chưa có test riêng' docs/plane-demo-porting/*.md`. Khi một mục có ca kiểm thử riêng, ghi tên ca vào dòng trạng thái.
- Mục ngoài phạm vi, để trống hoặc mới làm một phần giữ `[ ]`, kèm dòng trạng thái ghi quyết định và lý do. Mục chưa handoff nào nhắc tới ghi **Chưa có handoff nhận**.
- Cập nhật hàng loạt bằng script, không sửa tay: sửa handoff rồi chạy `pnpm exec tsx scripts/checklist/extract-handoffs.ts` (tạo lại [`status.json`](../scripts/checklist/status.json)) và `pnpm exec tsx scripts/checklist/apply-handoffs.ts`. Script không đụng vào mục đã `[x]` từ trước và chạy lại được nhiều lần.
- Một hàm Lancity có thể thay nhiều function Plane. Các mục có cùng đích đều có checkbox riêng. Nếu một mục được chốt ngoài phạm vi, ghi quyết định cạnh mục và giữ ô trống.
- Tên và file đích là đề xuất thiết kế. Các mục đầu đã được đối chiếu theo luồng thực thi. Các mục dài được ánh xạ từ tên, module và đồ thị tĩnh. Đọc source, kiểm tra caller và xác nhận input/output trước khi chốt tên hoặc viết code.

## Kết quả triển khai theo đợt

Mỗi đợt do nhiều agent chạy song song, handoff của từng agent nằm ở [`plane-demo-porting/handoff/`](./plane-demo-porting/handoff/). Số mục là số PD mà handoff đó thắng khi gộp. Khi hai handoff cùng nhận một PD, script chọn handoff có file mã rõ hơn.

| Đợt | Handoff | Mục đã tick | Luồng đã có trong Lancity | Phần còn trống |
| --- | --- | ---: | --- | --- |
| 0 | [p0-infra](./plane-demo-porting/handoff/p0-infra.md) | 0 (3 mục dùng chung với p1-platform) | `src/worker.ts`, Queues `lancity-jobs`, Cron `*/5 * * * *`, nodemailer qua Gmail, registry job tự nạp. | Chưa gửi thử email trên Worker thật. Chưa xác nhận Vinext nhận entrypoint mới. |
| 1 | p1-platform, p1-auth, p1-workspace, p1-project, p1-issue-core, p1-issue-collab, p1-issue-background | 1.005 | Nền tảng API và phân quyền, xác thực (Better Auth, OAuth, magic code), workspace, project, issue lõi và cộng tác, activity/version qua job. | 11 mục ở nhóm 01 (read replica, `not-found.tsx`, Redis), 10 mục ở nhóm 02, `__str__` model issue. |
| 2 | p2-asset, p2-cycle, p2-module, p2-estimate, p2-intake-draft, p2-page, p2-notification | 438 | Asset trên R2, cycle (kèm snapshot hằng ngày), module, estimate, intake, draft, page, thông báo, sticky và email. | Bốn mục `PUT/PATCH` của cycle issue và module issue (ngoài phạm vi). |
| 3 | p3-view-search, p3-analytics, p3-export, p3-integrations, p3-public, p3-instance | 388 | View và tìm kiếm, analytics, xuất và nhập issue, API token, webhook (gửi, retry, chữ ký), board công khai, quản trị instance. | Năm mục serializer công khai ngoài phạm vi. |
| 4 | p4-live, p4-pdf, p4-maintenance, p4-migrations | 415 | Live trên Durable Object, PDF qua Browser Rendering, job dọn dẹp, seed, CLI quản trị, công cụ nhập dữ liệu Plane. | 26 mục Redis của Live, 16 mục lệnh Django/Docker. |
| Editor | (không có handoff, xem [README](../README.md#editor)) | 0 | Editor Plane (`@plane/editor` cùng phần dùng của Blocks, Utils, Propel) ở `src/components/editor`. Codec HTML/JSON của page giữ block id, callout, embed, màu, emoji, bảng, ảnh. Sửa `denySocket` để client nhận `PermissionDenied`. Ảnh lưu trên R2 qua `useEditorFileHandler` và các route asset của project. | Chưa gắn editor vào màn hình page. |
| Bổ sung | [p3-view-search](./plane-demo-porting/handoff/p3-view-search.md), [p3-public](./plane-demo-porting/handoff/p3-public.md), [p4-migrations](./plane-demo-porting/handoff/p4-migrations.md), [issue-type](./plane-demo-porting/handoff/issue-type.md) | 10 | Đối chiếu cập nhật view và danh sách yêu thích, nhóm issue công khai, nhập dashboard/widget lịch sử, định dạng issue type. | |

Phân bố 80 mục còn trống

| Lý do | Số mục | Nhóm |
| --- | ---: | --- |
| Ngoài phạm vi theo quyết định của handoff (gồm 14 hàm `__str__` của Django ở 05) | 75 | 01 (4), 02 (6), 05 (14), 07 (4), 12 (5), 14 (26), 15 (16) |
| Làm một phần, giữ ô trống | 1 | 01 (trang 404 web PD-0521) |
| Để trống, chưa nhóm nào nhận | 4 | 02 (avatar OAuth PD-0967, 0969, 0971, 0972) |

Danh sách PD và lý do từng mục nằm trong [handoff của bước tích hợp checklist](./plane-demo-porting/handoff/i-checklist.md).

Nhãn `có test nhóm` ghi nhận kết quả của file kiểm thử liên quan. Mười mục bổ sung có ca kiểm thử cho hành vi tương ứng trong handoff của từng nhóm. [Review-fixes](./plane-demo-porting/handoff/review-fixes.md) ghi các điểm Lancity chủ động điều chỉnh so với Plane.

[Kiểm thử Worker](../tests/worker.integration.mjs) · [Kiểm thử lời mời](../tests/workspace-invitations.integration.mjs) · [Kiểm thử project](../tests/project.integration.mjs) · [Kiểm thử planning](../tests/planning.integration.mjs) · [Kiểm thử migration](../tests/migrations.test.mjs). Các ca của từng đợt có tên `tests/p<đợt>-<nhóm>.*` (ví dụ `tests/p1-auth.integration.mjs`, `tests/p4-live.test.ts`).

## Quyết định hạ tầng

Chủ dự án ưu tiên dịch vụ Cloudflare. Chi tiết cách dùng, rủi ro và ví dụ mã nằm ở [hạ tầng dùng chung](./plane-demo-porting/infrastructure.md).

| Nhu cầu trong Plane | Quyết định cho Lancity | Trạng thái |
| --- | --- | --- |
| Email (SMTP của Django) | nodemailer qua Gmail SMTP (`smtp.gmail.com:465`) bằng app password. Secret `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM`. Thiếu secret thì `sendMail` chỉ ghi log. | Đã có `sendMail`. Chưa gửi thử trên Worker thật (rủi ro `node:dns`/`node:tls`). Gmail giới hạn khoảng 500 thư mỗi ngày. |
| Celery task | Cloudflare Queues, queue `lancity-jobs` và dead-letter `lancity-jobs-dlq`, consumer là chính Worker. | Cần tạo hai queue trước lần deploy đầu. |
| Celery beat | Cron Triggers, một trigger `*/5 * * * *`, các job định kỳ khai báo bằng `registerScheduled`. | Đã có, giờ chạy theo UTC. |
| Lưu file (S3/MinIO) | R2, binding `ASSET_BUCKET`, bucket `lancity-assets`. Upload đi qua Worker bằng `PUT`, không dùng presigned POST. | Đã có cho asset, attachment, export, PDF nền và ảnh trong editor (`src/lib/editor/file-handler.ts`). Chuyển byte S3 → R2 của dữ liệu cũ cần bước riêng. |
| Live (Hocuspocus, Redis) | Durable Objects (SQLite), một DO cho mỗi page, WebSocket Hibernation. Redis không còn. | Mã có trong `src/server/live/` và `src/server/collaboration/`. Binding `COLLABORATION` đã khai trong `cloudflare.config.ts`. Editor phía client đã chuyển vào `src/components/editor` và kết nối bằng `@hocuspocus/provider` với `pageId` làm tên tài liệu. `tests/editor-live.integration.mjs` kiểm tra nhiều phiên, quyền, lưu khi ngắt và chỉnh sửa offline. Chưa gắn vào màn hình page thật. |
| Xuất PDF | Browser Rendering (`env.BROWSER.quickAction('pdf', ...)`), không dùng thư viện PDF JS. | Cần binding `BROWSER`. Thiếu binding thì `POST` trả 503. Chưa thử với Chromium thật. |
| Redis cache | Không dùng. Cache và rate limit lưu trong D1. | Đã có `src/server/common/cache.ts`. |
| Workflows cho import/export lớn | Chưa dùng. Import chạy theo chunk qua Queues. | Chưa có binding. |

Thông tin liên quan: [thư mục handoff](./plane-demo-porting/handoff/) · [handoff tích hợp checklist](./plane-demo-porting/handoff/i-checklist.md) · [`scripts/checklist/`](../scripts/checklist).
