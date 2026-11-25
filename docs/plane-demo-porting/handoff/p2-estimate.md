# Handoff p2-estimate

Phạm vi: estimate và estimate point trong `07-planning.md`. Issue type chỉ có hai mục `__str__` (PD-1441, PD-1442). Chưa chạy typecheck, build, test. ESLint sạch trên các file bên dưới.

Code: [`service.ts`](../../../src/server/estimate/service.ts) · [`queries.ts`](../../../src/server/estimate/queries.ts) · [`presenters.ts`](../../../src/server/estimate/presenters.ts) · [`routes/estimates.ts`](../../../src/server/api/v1/routes/estimates.ts) · [`p2-estimate-schema.ts`](../../../src/types/planning/p2-estimate-schema.ts). Test: [`tests/p2-estimate.integration.mjs`](../../../tests/p2-estimate.integration.mjs).

## (a) PD đã xử lý

| PD | Kết quả |
| --- | --- |
| 0522 | Port `generateRandomName` (10 chữ thường, `crypto.getRandomValues`) trong service.ts |
| 0523 | Port `getProjectEstimatePoints` + `GET /project-estimates` (admin/member; rỗng nếu project chưa có estimate) |
| 0524, 0526 | Port. `listEstimates` nay trả kèm `points` (Plane `EstimateReadSerializer`); `getEstimate` giữ nguyên |
| 0525 | Port `bulkCreateEstimate`: tên tùy chọn (ngẫu nhiên nếu thiếu), trả estimate kèm points. `POST /estimates` dùng hàm này, vẫn 201 |
| 0527 | Port `bulkUpdateEstimate`: bắt buộc có `estimate_points` (400 nếu rỗng), đổi `name`/`type`, cập nhật `key`/`value` theo `id`, bỏ qua id không thuộc estimate. `PATCH /estimates/:id` nhận cả dạng bulk lẫn dạng cũ `{name, description}` |
| 0528 | Đã có `deleteEstimate` (xóa mềm estimate và point, gỡ `projects.estimate_id`, gỡ điểm khỏi issue và draft). Không đổi |
| 0529 | Port `createEstimatePoint` (key >= 1 và value bắt buộc như Plane vì Plane từ chối giá trị falsy). `POST /estimates/:id/estimate-points` nhận thêm dạng một điểm (201, trả object); dạng mảng và `{estimate_points}` giữ nguyên |
| 0530 | Đã có `updateEstimatePoint` (strict, giới hạn `value` 20 ký tự theo PD-0013/0310). Không đổi |
| 0531 | Port `deleteEstimatePoint(..., newPointId?)`: chuyển issue sang `new_estimate_id` hoặc để trống, giảm `key` của các điểm có key lớn hơn, xóa mềm điểm, enqueue `issue.activity.updated` cho từng issue (qua `enqueueIssueActivity`, không có `activityRecorded` nên handler p1-issue-background ghi activity). Trả danh sách điểm đã đổi key. **Đổi hành vi route**: `DELETE .../estimate-points/:pointId` trả 200 với mảng thay vì 204, body tùy chọn `{new_estimate_id}` |
| 0891 | Port `getWorkspaceEstimates` + `GET /workspaces/:slug/estimates` (router `workspaceEstimatesRoutes`). Admin thấy mọi project; member thấy project mình tham gia và project công khai (`network = 2`); guest chỉ project mình tham gia. Không cache (Plane cache 2 giờ). Sau này nếu cần cache thì dùng `cache.ts` của p1-platform |
| 0012 | Gộp vào `createEstimate` (gán workspace/project từ context) |
| 0013, 0310 | Port ở Zod: `estimatePointInputSchema`/`updateEstimatePointInputSchema` (đã có, `value` <= 20) và `bulkUpdateEstimateInputSchema`. Đích `schema.ts` thay bằng [`p2-estimate-schema.ts`](../../../src/types/planning/p2-estimate-schema.ts) cho phần mới |
| 0107, 0112, 0115 | Port ở [`queries.ts`](../../../src/server/estimate/queries.ts): `queryProjectEstimates`, `queryEstimatePoints` (kèm lọc theo `pointId`), `queryPointsOf` |
| 0108-0111, 0113, 0114, 0116, 0117 | Gộp. Plane không đăng ký URL cho các endpoint API-key này (đồ thị ghi "chưa nối"), nên dùng chung route và service ở trên: 409 khi trùng tên (`createEstimate`), PATCH chỉ nhận `name`/`description` (schema strict), PATCH điểm chỉ nhận `key`/`value`/`description`, DELETE dùng `deleteEstimate`/`deleteEstimatePoint`. Không giữ ràng buộc "một estimate mỗi project" vì endpoint app của Plane cho phép nhiều estimate |
| 1396, 1397 | Tham chiếu. `formatEstimate`, `formatEstimatePoint` trong presenters.ts (cùng `toEstimateRead` cho `EstimateReadSerializer`) |
| 1441, 1442 | Ngoài phạm vi p2-estimate. Chỉ là `__str__` của `IssueType`/`ProjectIssueType`; không có route hay service issue type trong nhóm 07, và `src/server/issue-type/` nằm ngoài vùng sở hữu. Nếu nhóm issue type được làm sau thì thêm `presenters.ts` ở đó. Để trống ô |

## (b) Route cần đăng ký vào `index.ts`

- `estimatesRoutes` đã mount tại `linkto.apiProject` (giữ nguyên).
- Thêm: `import { estimatesRoutes, workspaceEstimatesRoutes } from '@/server/api/v1/routes/estimates'` và `app.route(linkto.apiWorkspace, workspaceEstimatesRoutes)`. Không cần thứ tự đặc biệt. Cả hai router dùng `authenticate` như các router hiện có.

## (c) Schema ext

Không có bảng hoặc cột mới, nên không có `ext-p2-estimate.ts` và không cần migration.

## (d) Key linkto cần thêm

Trong `src/data/linkto.ts` mục `apiV1Routes`: `projectEstimates: '/project-estimates'` và `workspaceEstimates: '/estimates'`. Hiện `routes/estimates.ts` khai báo hằng cục bộ `estimateRoutes`; sau khi thêm key thì thay bằng `apiV1Routes.projectEstimates`/`apiV1Routes.workspaceEstimates` và xóa hằng cục bộ.

## (e) Dependency, binding, env

Không có. Activity dùng queue `JOBS_QUEUE` có sẵn qua `enqueueIssueActivity`.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. `bulkUpdateEstimate`: `db.batch(updates as [...])` ép kiểu tuple, có thể cần chỉnh theo kiểu `LancityDb`.
2. `getWorkspaceEstimates`: `inArray(col, subquery)` với `db.select(...)` và điều kiện `visible` có thể là `undefined` trong `and(...)`; `sql\`... is not null\`` thay `isNotNull` cho `projects.estimateId`.
3. `emitPointActivity` import động `@/server/common/env` và `@/server/issue/activity` để module vẫn tải được ngoài Worker (như `issue/events.ts`). `requestedData.estimate_point` và `currentInstance.estimate_point` là số, khác Plane gửi chuỗi UUID.
4. `deleteEstimatePoint` không kiểm tra điểm thay thế thuộc cùng estimate ở mức DB; service kiểm tra trong `estimate.points`, và FK ghép `(estimate_point_id, project_id)` bảo vệ cùng project.
5. Danh sách điểm nay sắp xếp theo `key` (Plane sắp theo `value`).
6. Test `tests/p2-estimate.integration.mjs` chưa chạy; giả định `POST /issues` chỉ cần `name`.
