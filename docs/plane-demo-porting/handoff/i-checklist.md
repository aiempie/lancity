# Handoff i-checklist

Bước tích hợp checklist: đọc toàn bộ handoff `p0` đến `p4`, tạo `scripts/checklist/status.json`, tick checklist bằng script, đếm lại bằng `grep` và cập nhật `docs/plane-demo-porting.md` cùng `README.md`. Không sửa `src/` hay `tests/`. **Chưa chạy typecheck, build, test.** Chỉ chạy `pnpm lint` cho `scripts/checklist` (kết quả ở cuối file).

## Đã làm

- [`scripts/checklist/extract-handoffs.ts`](../../../scripts/checklist/extract-handoffs.ts): đọc phần (a) của 25 handoff (trừ `i-wiring` và `i-checklist`), phân loại từng PD thành `done`, `out`, `open`, `partial`, `defer` và ghi [`status.json`](../../../scripts/checklist/status.json). Các chỗ viết tự do (bullet, đoạn văn, lưu ý) khai báo trong `MANUAL`, `OVERRIDES` và `CAVEATS` ở đầu file để chạy lại ra cùng kết quả.
- [`scripts/checklist/apply-handoffs.ts`](../../../scripts/checklist/apply-handoffs.ts): tick `[x]` các mục `done`, thêm dòng trạng thái (link file mã, file test, handoff nguồn, nhãn `chưa chạy test`) và ghi quyết định cạnh mục còn trống. Chạy lại an toàn, không đụng mục đã `[x]` từ trước.
- Quy tắc gộp khi nhiều handoff nhận cùng một PD: `done` thắng `out`, rồi `open`, `partial`, `defer`. Hai handoff cùng `done` thì chọn handoff có nhiều file mã hơn. 112 PD có xung đột như vậy (ví dụ 1074-1084 giữa p3-analytics và p3-export, 1097-1103 giữa p2-asset và p2-page); `status.json` giữ danh sách `alsoClaimedBy`.
- Chỉ tick mục mà handoff nêu rõ đã xử lý. Mục làm một phần, ngoài phạm vi, để trống hoặc không handoff nào nhắc giữ `[ ]`.
- Đường dẫn mã lấy từ link trong handoff. Khi hàng chỉ ghi tên file, script tìm file đó trong thư mục của nhóm và bỏ qua nếu không tìm thấy. Tên test là các file `tests/<handoff>.*` có thật trên đĩa, không phải tên từng ca.

## Số liệu thật (đếm bằng `grep`, 2026-11-23)

Lệnh: `grep -c '^- \[x\]' f`, `grep -c '^- \[ \]' f`, `grep -c 'Đã chuyển, chưa chạy test' f`.

| Nhóm | Tổng | `[x]` | Trong đó tick từ trước | Tick từ handoff (`chưa chạy test`) | `[ ]` |
| --- | ---: | ---: | ---: | ---: | ---: |
| 01. Nền tảng API và phân quyền | 282 | 271 | 2 | 269 | 11 |
| 02. Xác thực và danh tính | 162 | 152 | 0 | 152 | 10 |
| 03. Workspace | 141 | 141 | 1 | 140 | 0 |
| 04. Project | 126 | 126 | 0 | 126 | 0 |
| 05. Issue, trạng thái và cộng tác | 276 | 257 | 0 | 257 | 19 |
| 06. Job, lịch sử, phiên bản issue | 67 | 67 | 0 | 67 | 0 |
| 07. Cycle, module, estimate, intake, draft | 240 | 233 | 0 | 233 | 7 |
| 08. Page, mô tả, asset | 135 | 135 | 0 | 135 | 0 |
| 09. Thông báo, email, ghi chú | 61 | 61 | 0 | 61 | 0 |
| 10. View, tìm kiếm, báo cáo, nhập, xuất | 223 | 220 | 2 | 218 | 3 |
| 11. Webhook và tích hợp | 48 | 48 | 3 | 45 | 0 |
| 12. Chia sẻ công khai | 72 | 66 | 7 | 59 | 6 |
| 13. Quản trị instance | 54 | 54 | 1 | 53 | 0 |
| 14. Live và PDF | 307 | 281 | 1 | 280 | 26 |
| 15. Bảo trì, seed, CLI | 87 | 71 | 0 | 71 | 16 |
| 16. Data migration | 67 | 63 | 16 | 47 | 4 |
| **Tổng** | **2348** | **2246** | **33** | **2213** | **102** |

(Các số `tick từ trước` đã có kiểm thử chạy qua ở các đợt trước. Số `tick từ handoff` là số dòng có chuỗi `Đã chuyển, chưa chạy test`, đếm bằng `grep -c`.)

## Phân loại 102 mục còn trống

| Nhóm | Ngoài phạm vi | Làm một phần | Để trống | Thuộc nhóm khác | Chưa handoff nào nhắc |
| --- | ---: | ---: | ---: | ---: | ---: |
| 01 | 4 | 7 | 0 | 0 | 0 |
| 02 | 6 | 0 | 4 | 0 | 0 |
| 05 | 11 | 0 | 0 | 2 | 6 |
| 07 | 4 | 0 | 2 | 0 | 1 |
| 10 | 0 | 0 | 0 | 0 | 3 |
| 12 | 5 | 1 | 0 | 0 | 0 |
| 14 | 26 | 0 | 0 | 0 | 0 |
| 15 | 16 | 0 | 0 | 0 | 0 |
| 16 | 0 | 4 | 0 | 0 | 0 |
| **Tổng** | **72** | **12** | **6** | **2** | **10** |

## PD còn trống và lý do theo handoff


### Ngoài phạm vi (quyết định của handoff, giữ ô trống)

| Nhóm | PD | Handoff | Lý do |
| --- | --- | --- | --- |
| 01 | 0473-0474 (2) | [p1-platform](./p1-platform.md) | Không áp dụng. DRF tự sinh action từ mixin và cần chặn action chưa có phân quyền. Hono chỉ có route khai báo tường minh, route không khai báo trả 404/405 |
| 01 | 1605, 1608 (2) | [p1-platform](./p1-platform.md) | Ngoài phạm vi. Không dùng Redis; cache dùng D1 (`cache.ts`) |
| 02 | 1052-1053 (2) | [p1-auth](./p1-auth.md) | Ngoài phạm vi: không có CSRF token. Better Auth và `protectCookieWrites` kiểm tra Origin cho request ghi mang cookie. |
| 02 | 1481-1484 (4) | [p1-auth](./p1-auth.md) | Ngoài phạm vi: bảng `session` của Better Auth thay session store của Django |
| 05 | 1423-1424, 1426, 1429-1430, 1432, 1434-1438 (11) | [p1-issue-collab](./p1-issue-collab.md) | chỉ để in chuỗi, không cần port. Đề nghị đánh dấu "Tham chiếu, không port". |
| 07 | 0510, 0512 (2) | [p2-cycle](./p2-cycle.md) | Ngoài phạm vi. PUT/PATCH `cycle-issues/<issue_id>` của Plane lỗi: DRF tìm theo `pk` nhưng URL đặt tên `issue_id`, và serializer chỉ cho ghi trường `issue` (đổi issue của assignment). Không có use case hợp lệ. |
| 07 | 0686, 0688 (2) | [p2-module](./p2-module.md) | hai handler DRF thừa kế serialize một `Issue` bằng `ModuleIssueSerializer` nên không có hành vi dùng được. Route `PATCH` và `PUT /modules/:id/issues/:issueId` trả 405. Thêm hoặc bỏ issue dùng POST và DELETE. |
| 12 | 1618 (1) | [p3-public](./p3-public.md) | Ngoài phạm vi. `space/serializer/issue.py` không được view nào của space dùng (các view import `plane.app.serializers`). Quy tắc URL trùng của link đã nằm ở `issue/link.ts` (p1-issue-collab) |
| 12 | 1619-1622 (4) | [p3-public](./p3-public.md) | Ngoài phạm vi, cùng lý do. Public intake dùng schema Zod riêng `publicIntakeCreateSchema` và batch ở `intake.ts` |
| 14 | 2217-2242 (26) | [p4-live](./p4-live.md) | Ngoài phạm vi vì không còn Redis: `RedisManager`, `waitForRedisReady`, `getRedisClient`, retry, get/set/del/expire |
| 15 | 1256, 1265-1271, 1280-1284, 1287-1289 (16) | [p4-maintenance](./p4-maintenance.md) | Ngoài phạm vi |

### Làm một phần (giữ ô trống)

| Nhóm | PD | Handoff | Lý do |
| --- | --- | --- | --- |
| 01 | 0521 (1) | [p1-platform](./p1-platform.md) | Một phần. API: `handleNotFound` (JSON 404). UI: `src/app/not-found.tsx` chưa tồn tại và nằm ngoài phạm vi p1, cần tạo ở bước tích hợp |
| 01 | 1588-1593 (6) | [p1-platform](./p1-platform.md) | Port một phần. `readReplicaRouting`, `useReadReplica` và cờ theo request (`AsyncLocalStorage`). Chưa nối với D1 Sessions API vì `src/db/client.ts` thuộc hạ tầng |
| 12 | 1623 (1) | [p3-public](./p3-public.md) | Thay thế một phần. `issueQuerysetGrouper` chỉ kiểm tra `group_by` và `sub_group_by` (không trùng nhau). Annotation và join nhóm do `groupSpec` và `paginateIssues` (p1-issue-core) đảm nhiệm |
| 16 | 1322-1324, 1326 (4) | [p4-migrations](./p4-migrations.md) | Chỉ có hàm seed. Lancity chưa có bảng widget/dashboard nên importer không ghi gì và đưa vào `skippedTables` nếu dump có. |

### Để trống (chưa nhóm nào nhận)

| Nhóm | PD | Handoff | Lý do |
| --- | --- | --- | --- |
| 02 | 0967, 0969, 0971-0972 (4) | [p1-auth](./p1-auth.md) | Plane tải avatar OAuth về storage, xóa avatar cũ qua `FileAsset`. Lancity giữ nguyên URL ảnh của nhà cung cấp (đúng với nhánh fallback của Plane). Cần helper tải ảnh có chặn SSRF của nhóm asset (R2) rồi mới làm được. |
| 07 | 1441-1442 (2) | [p2-estimate](./p2-estimate.md) | Chỉ là `__str__` của `IssueType`/`ProjectIssueType`. Chưa có route hay service issue type trong nhóm 07, nên chưa nhóm nào nhận. |

### Handoff ghi thuộc nhóm khác, chưa ai làm

| Nhóm | PD | Handoff | Lý do |
| --- | --- | --- | --- |
| 05 | 1439-1440 (2) | [p1-issue-collab](./p1-issue-collab.md) | thuộc nhóm lịch sử/phiên bản (p1-issue-core/06). Tôi chỉ đọc bảng. |

### Không handoff nào nhắc tới

| Nhóm | PD | Handoff | Lý do |
| --- | --- | --- | --- |
| 05 | 0141, 0580-0581, 1422, 1427-1428 (6) | - | Không có handoff nào nêu mục này (kiểm tra thêm khi viết bước kiểm thử). |
| 07 | 0495 (1) | - | Không có handoff nào nêu mục này (kiểm tra thêm khi viết bước kiểm thử). |
| 10 | 0831, 0844, 0852 (3) | - | Không có handoff nào nêu mục này (kiểm tra thêm khi viết bước kiểm thử). |

## Việc cần làm tiếp

1. Chạy `pnpm typecheck`, `pnpm build` và các ca test theo README. Mỗi handoff liệt kê chỗ dễ lỗi kiểu ở mục (f).
2. Sau mỗi ca test qua, sửa handoff hoặc `MANUAL` rồi chạy lại hai script để cập nhật nhãn. Cách đơn giản nhất: thay `chưa chạy test` bằng tên ca đã chạy trong dòng trạng thái của nhóm đó.
3. Chọn người nhận cho 10 PD chưa ai nhắc, 2 PD `__str__` của issue type, 2 PD thuộc nhóm lịch sử/phiên bản (1439, 1440), và các mục làm một phần (read replica, `src/app/not-found.tsx`, widget/dashboard, grouper công khai).
4. Cần quyết định của chủ dự án cho PD-1336 (README ghi vai trò 10 → 15, migration Django gốc đổi 10 → 5; hàm hiện theo source).
5. Chạy `grep -c 'Đã chuyển, chưa chạy test' docs/plane-demo-porting/*.md` để theo dõi phần chưa kiểm chứng.


## Kiểm tra đã chạy

- `pnpm lint` toàn repo: thoát với mã 0, không có cảnh báo.
- Chạy `apply-handoffs.ts` hai lần liên tiếp cho cùng số liệu (idempotent). Bản sao lưu 16 checklist trước khi tick nằm ở `/tmp/checklist-backup/` (ngoài repo).
- Không chạy typecheck, build, test.
