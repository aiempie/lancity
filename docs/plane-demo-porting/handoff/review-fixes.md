# Vòng sửa theo review độc lập

[Về checklist](../../plane-demo-porting.md) · [Hạ tầng](../infrastructure.md) · [Endpoint](../endpoints.md)

Sau bốn đợt chuyển backend, tám agent review độc lập (r1 đến r8) đối chiếu mã Lancity với Plane Demo (commit `da21a8ff8b`) và đưa ra danh sách lỗi. Mỗi lỗi được kiểm tra lại với source Plane trước khi sửa. Tài liệu này ghi kết quả. Ca kiểm thử của vòng này nằm ở `tests/r1-sanitize.test.ts` đến `tests/r8-http.test.ts`.

Trạng thái: `pnpm lint`, `pnpm typecheck`, `pnpm build` và 219 test đơn vị đã qua. 28/28 file integration Worker qua ở lần chạy trước vòng sửa này và sẽ chạy lại. Migration mới: `drizzle/0004_job_claims.sql`.

## (a) Lỗi đã sửa

| Nhóm        | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Agent      | Test                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------- |
| Bảo mật     | Sanitizer HTML chặn `href`/`src` nguy hiểm, giữ `rel` cho link, chỉ cho phép thuộc tính `data-*` của Plane, escape thuộc tính và văn bản. Chặn open redirect ở `next_path` và URL chuyển hướng. Mật khẩu kiểm bằng zxcvbn, ngưỡng score 3. Giới hạn tốc độ xác thực mặc định `10/minute` như Plane. Ghi bằng cookie từ origin lạ bị chặn                                                                                                                                        | r1, r2, r8 | `r1-sanitize`, `r2-auth`, `r8-http`           |
| Mất dữ liệu | Durable Object của Live giữ bản chưa lưu khi lưu lỗi, retry từ alarm, không bỏ state khi client cuối ngắt kết nối, force close lưu cả thay đổi trong cửa sổ debounce. Nhân bản page giữ mô tả (chuyển đổi chạy trong tiến trình, không cần secret Live). Xóa issue chạy cascade qua queue và ẩn ngay sub-issue. Issue đã archive xóa được. PATCH comment công khai không làm mất `comment_json`                                                                                 | r3, r4, r7 | `r3-live-content`, `r4-issue-core`, `r7-data` |
| Job         | Payload job dùng snake_case như handler mong đợi (mention trong mô tả giờ gửi được thông báo). Job idempotent qua bảng `job_claims` và `meta.jobId`: giao lại không tạo trùng activity hay thông báo, fan-out chỉ chạy một lần. Version mô tả issue gộp trong 600 giây. Chuyển issue giữa cycle ghi activity `cycles` có tên và ID                                                                                                                                              | r4, r5     | `r4-issue-core`, `r5-jobs`                    |
| Quyền       | Thành viên workspace mời được nhưng không vượt vai trò của mình. Mọi admin workspace xóa được workspace. Guest không retrieve cycle, không đọc cycle archive và cycle issue. Tham gia project bằng lời mời cần email đã xác minh. Bulk cover project không biến attachment thành cover. Bot không tính vào số thành viên và danh sách. Quy tắc admin cuối cùng theo Plane: chỉ chặn admin là thành viên duy nhất của project. Assignee đã rời project không còn trong danh sách | r4, r6     | `r4-issue-core`, `r6-perms`                   |
| Thư viện    | Giải mã Fernet đọc được token do Python `cryptography` tạo, báo lỗi thay vì trả chuỗi rỗng, nhập cấu hình instance giữ Fernet hoặc mã hóa lại thành v1 khi có đủ hai khóa. Tìm kiếm và so khớp tên label không phân biệt hoa thường theo Unicode trên D1. Xuất issue gồm cả issue archived, draft và triage. Payload webhook theo serializer của Plane                                                                                                                          | r7         | `r7-data`                                     |
| HTTP        | `X-API-Key` xác thực như chủ token (token hết hạn, vô hiệu, chủ bị vô hiệu đều 401, key sai không được cookie cứu). Key bị từ chối ở route quản lý token, quản trị instance và đổi mật khẩu. Giới hạn tốc độ theo key. CORS qua `CORS_ALLOWED_ORIGINS` (preflight cho phép `X-API-Key`, không bao giờ gộp `*` với credentials). Chặn ghi bằng cookie từ origin chưa cấu hình                                                                                                    | r8         | `r8-http`                                     |

## (b) Điểm review sai so với source Plane

Các điểm sau được review nêu là lỗi, nhưng source Plane làm giống Lancity. Lancity giữ nguyên.

| Nhận định của review                                       | Source Plane                                                                | Kết luận                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ENABLE_SIGNUP` mặc định phải tắt                          | `authentication/adapter/base.py:104` đọc `ENABLE_SIGNUP` với mặc định `'1'` | Mặc định bật đăng ký, giữ nguyên                                 |
| Cần `enqueueIssueVersion` khi tạo hoặc sửa issue           | Plane không gọi `issue_task` ở các đường này                                | Không thêm job. Chỉ job version mô tả chạy                       |
| Guest không được xem list, progress và analytics của cycle | Plane cho guest các route đọc này                                           | Cho phép. Chỉ retrieve, archive và cycle issue bị chặn với guest |
| `copy_s3_object` phải gửi secret sang Live                 | Plane cũng không gửi secret trong lệnh gọi này                              | Giữ nguyên. Lancity chuyển đổi trong tiến trình                  |
| `Football2023!!!!` phải bị từ chối                         | zxcvbn cho score 3, đạt ngưỡng của Plane                                    | Chấp nhận                                                        |
| Token API phải bị giới hạn theo workspace                  | Plane không giới hạn token theo workspace                                   | Xem mục (c): Lancity chủ động thêm giới hạn này                  |

## (c) Lệch có chủ đích giữ nguyên

Lancity phục vụ client web và mobile riêng, nên các điểm dưới đây khác Plane có chủ ý.

- **ID số, path và lỗi.** Khóa chính là số tự tăng, không dùng UUID. Path nằm dưới `/api/v1` và khác Plane (xem [endpoints.md](../endpoints.md)). Lỗi dạng `{ "error": { "code", "message", "details" } }`.
- **API token.** Lưu hash SHA-256, không lưu bản rõ. Token khóa theo workspace (Plane không có giới hạn này).
- **Asset.** R2 kiểm magic bytes của file tải lên.
- **Public intake.** Chỉ trả bài do chính người gửi tạo.
- **404 thay 403.** Tài nguyên người dùng không có quyền xem trả 404 để không lộ sự tồn tại.
- **OAuth.** Tắt liên kết tài khoản ngầm: người dùng đã có tài khoản mật khẩu phải đăng nhập rồi mới liên kết nhà cung cấp.
- **Sửa bug của Plane.** Danh sách vote rỗng trả mảng rỗng. Query analytic không còn reset. `sort_order` của cycle hoàn thành đúng thứ tự. State fallback `cancelled` đúng nhóm.
- **Page.** `PATCH` page tạo version qua job nền, không đồng bộ trong request. Draft retrieve cho cả ba vai trò.
- **Workspace.** Owner không bị gỡ và không tự rời được.
- **So khớp Unicode.** Hạn chế: `ß` không khớp `SS` và dấu tổ hợp rời không được chuẩn hóa như dấu dựng sẵn.
- **PDF.** Thiếu metadata author và subject.

## (d) Hạn chế còn lại

- **XLSX.** Thiếu styles, ngày xuất ra không phải số serial của Excel.
- **Live.** Codec HTML/JSON khác TipTap ở thuộc tính mặc định và class CSS. Cần so sánh với trình soạn thảo thật trước khi dùng chung tài liệu giữa hai codec.
- **Webhook.** Kiểm SSRF không pin IP nên vẫn có nguy cơ DNS rebinding.
- **PDF.** Ảnh nhúng không nén có thể làm file vượt 24 MB.
- **Chưa thử trên Worker thật.** nodemailer (Gmail SMTP) và Browser Rendering mới chạy ở local và test đơn vị.
- **Đã giữ ô trống ở checklist.** Avatar OAuth (PD-0967, 0969, 0971, 0972) cần helper tải ảnh chặn SSRF. Trang 404 web (PD-0521) chưa có `src/app/not-found.tsx`. Seed widget/dashboard (PD-1322, 1323, 1324, 1326) vì Lancity chưa có bảng này.

## Cập nhật checklist đi kèm

- Nhãn `Đã chuyển, chưa chạy test` đổi thành `Đã chuyển, có test nhóm` (file test tồn tại và đã qua) hoặc `Đã chuyển, chưa có test riêng`. Logic nằm ở `scripts/checklist/apply-handoffs.ts`.
- Sửa path sai nhưng đã có code: PD-0141 (`getIssueByIdentifier`, `src/server/issue/list.ts`), PD-0580 (`listWhere`), PD-0581 (`ISSUE_ANNOTATIONS`, `src/server/issue/filter.ts`), PD-0495 (`listCycles`, `src/server/cycle/service.ts`), PD-1439 và PD-1440 (`src/server/issue/version/snapshot.ts`), PD-1588 đến PD-1593 (`src/server/common/request-scope.ts`, mới port cờ theo request, D1 chưa dùng Sessions API). Các bản ghi này nằm ở `OVERRIDES` trong script.
- Các hàm `__str__` của Django còn trống (PD-1422 đến PD-1438, trừ những mục đã tick) được ghi là không cần port và giữ ô trống theo quy tắc ngoài phạm vi.
