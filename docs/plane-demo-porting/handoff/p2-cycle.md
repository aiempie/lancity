# Handoff p2-cycle

Nhóm: phần cycle của `docs/plane-demo-porting/07-planning.md` (cycle, cycle issues, favorite, user properties, progress, analytics, snapshot, transfer, archive, adapter DRF). Module, estimate, intake, draft không thuộc nhóm này.

Chưa chạy test, build, typecheck theo quy ước. ESLint và Prettier sạch trên mọi file bên dưới. Test: [`tests/p2-cycle.integration.mjs`](../../../tests/p2-cycle.integration.mjs) dùng D1 giả trên `node:sqlite` (cùng cách với `planning-archive.test.mjs`), không cần Worker. Chạy bằng `pnpm exec tsx --test tests/p2-cycle.integration.mjs`. Test tự tạo bảng `cycle_progress_snapshots` vì migration chưa có.

Mã: [`src/server/cycle/`](../../../src/server/cycle) · route [`routes/cycles.ts`](../../../src/server/api/v1/routes/cycles.ts) · Zod [`p2-cycle-schema.ts`](../../../src/types/planning/p2-cycle-schema.ts) · schema [`ext-p2-cycle.ts`](../../../src/db/schema/ext-p2-cycle.ts).

## (a) PD đã xong

Tất cả PD cycle trong checklist đã xử lý. Hai mục (PD-0510, PD-0512) ghi ngoài phạm vi kèm lý do.

| PD | Kết quả | Code |
| --- | --- | --- |
| 0081 | Port. `GET /cycles?per_page=` hoặc `?cursor=` trả khung phân trang Plane; có `cycle_view` (`all`, `current`, `upcoming`, `completed`, `draft`, `incomplete`) và `order_by` theo allowlist. `current` trả mảng, không phân trang. | `service.ts` (`listCyclesPaginated`), `model-rules.ts` (`cycleViewCondition`, `cycleOrderBy`) |
| 0082-0086, 0089, 0096, 0101 | Gộp vào adapter cha: callback `on_results` nằm trong `onResults` của `paginate`, serializer là `presentCycle`, `presentCycleLite`, `issueOnResults` | `service.ts`, `presenters.ts` |
| 0087, 0496 | Port. `createCycle`: ngày đổi sang UTC theo múi giờ project (`convertDateToUtc`), cả hai ngày hoặc không ngày nào, `owned_by`, `external_id` trùng trả 409 kèm `id`, đưa lên đầu `sort_order`, gửi `webhook.model_activity` | `service.ts` |
| 0088 | Port. `GET /cycles-lite` phân trang, không có số đếm | `service.ts` (`listCyclesLite`) |
| 0091, 0498 | Port. `retrieveCycle` (`GET /cycles/:id`) trả DTO có số đếm, `status`, `assigneeIds`, `isFavorite`, `subIssues`; cycle đã archive trả 404 | `service.ts` |
| 0092, 0497, 0304 | Port. `updateCycle`: cycle đã archive bị chặn, cycle đã hoàn thành chỉ nhận `sort_order`, gộp ngày với giá trị cũ, kiểm tra trùng external id | `service.ts` |
| 0093, 0499 | Port. `deleteCycle`: chỉ admin (project hoặc workspace) hoặc người tạo; xóa mềm cycle, cycle issues, user properties; xóa favorite và recent visit của cycle; gửi `cycle.activity.deleted` và webhook | `service.ts` |
| 0095, 0097, 0098, 0490-0492 | Port. Danh sách archive có số đếm, điểm estimate, `status`; chi tiết archive thêm `subIssues`, `distribution`, `estimateDistribution`. Archive và restore giữ nguyên `setCycleArchived` | `archive.ts` |
| 0100, 0515-0518, 0514 | Gộp. Có tham số truy vấn thì `GET /cycle-issues` trả danh sách issue của `paginateIssues` (lọc, `group_by`, `sub_group_by`, `order_by`). Cách lọc: đặt filter `cycle`. Không có tham số thì giữ mảng `{assignment, issue}` cũ. Annotation (PD-0514) là `ISSUE_ANNOTATIONS` | `issue.ts` (`listCycleIssuesPage`) |
| 0102, 0519 | Port. `assignCycleIssues`: issue ở cycle khác thì chuyển, issue đã ở cycle này thì bỏ qua, phần còn lại thêm mới; một batch; gửi `cycle.activity.created` (`notification: true`). Vẫn trả 204 và 404 khi có issue ngoài project | `service.ts` |
| 0104, 0511 | Port. `GET /cycle-issues/:issueId`; guest không phải người tạo nhận 404 | `issue.ts` (`getCycleIssue`) |
| 0105, 0520 | Port. `removeCycleIssue` xóa mềm và gửi `cycle.activity.deleted` | `service.ts` |
| 0106, 0505, 1725 | Port. `transferCycleIssues` giữ chữ ký; snapshot nay có thêm `distribution` (labels, assignees, completion_chart) và `estimate_distribution`; sau batch gửi job `cycle.transfer.notify` | `cycle-transfer-issues.ts`, `progress.ts`, `jobs.ts` |
| 0080, 0090, 0094, 0494, 0489, 0099, 0103, 0513, 0502 | Port. Một builder SQL dùng chung (`annotatedCyclesSql`): favorite, số đếm theo state group, `assignee_ids`, `status`, điểm estimate, múi giờ project | `queries.ts` |
| 0500 | Port. `POST /cycles/date-check`, ba điều kiện giao nhau như Plane, loại trừ `cycle_id` | `service.ts` (`checkCycleDates`) |
| 0501, 0503, 0504 | Port. `GET/POST /user-favorite-cycles`, `DELETE /user-favorite-cycles/:cycleId`. POST lặp lại là no-op (Plane báo lỗi trùng) | `service.ts` |
| 0506, 0507 | Port. `GET/PATCH /cycles/:id/user-properties`, mặc định theo model-rules, PATCH tạo hàng nếu chưa có (Plane trả 404), trả 201 | `service.ts` |
| 0508 | Port. `GET /cycles/:id/progress`: điểm estimate tính trực tiếp, số issue lấy từ snapshot nếu cycle đã transfer | `progress.ts` (`getCycleProgress`) |
| 0509 | Port. `GET /cycles/:id/analytics?type=issues\|points`: phân bố assignee, label và burndown. Có snapshot thì đọc snapshot | `progress.ts` (`getCycleAnalytics`, `burndownPlot`, `cycleDistribution`) |
| 0881 | Port. `getWorkspaceCycles`, route `workspaceCyclesRoutes` | `service.ts`, `routes/cycles.ts` |
| 0010, 1383-1385 | Port. `presentCycle`, `presentCycleLite`, `formatCycle`, `formatCycleIssue`, `formatCycleUserProperties` | `presenters.ts` |
| 0011 | Port, đặt ở file Zod mới thay vì `schema.ts`: `createCycleApiInputSchema` | `p2-cycle-schema.ts` |
| 0493 | Gộp. `PUT /cycles/:id` dùng chung xử lý với PATCH (serializer của `CycleViewSet.update` trong Plane là read-only) | `routes/cycles.ts` |
| 1379-1381 | Port | `model-rules.ts` |
| 1382 | Port. `nextCycleSortOrder` (nhỏ nhất của project trừ 10000, mặc định 65535) | `model-rules.ts` |
| 0510, 0512 | Ngoài phạm vi. PUT/PATCH `cycle-issues/<issue_id>` của Plane lỗi: DRF tìm theo `pk` nhưng URL đặt tên `issue_id`, và serializer chỉ cho ghi trường `issue` (đổi issue của assignment). Không có use case hợp lệ. | |

Mã bổ sung ngoài checklist (yêu cầu của chủ dự án):
- Cron `cycle.snapshot` (`55 23 * * *`, UTC) ghi một hàng mỗi ngày cho mỗi cycle đang chạy vào `cycle_progress_snapshots` (upsert theo `cycle_id` và ngày, nên retry an toàn). `GET /cycles/:id/snapshots` đọc lịch sử, có `remainingIssues`. Plane không có việc tương đương: burndown ở Plane luôn tính lại từ `completed_at`. File: `snapshot.ts`, `jobs.ts`.
- Job `cycle.transfer.notify`: đọc các activity mà batch transfer vừa ghi và gửi mỗi issue một job `notification.issue` (cùng payload mà `issue.activity` gửi), theo từng nhóm 200. File: `jobs.ts`.

Hook phát ra (xử lý ở agent khác): `webhook.model_activity` (cycle tạo, sửa) và `webhook.activity` (cycle xóa) theo định dạng của `project/events.ts`; `issue.activity` loại `cycle.activity.created|deleted` (job của p1-issue-background, đã có handler); `notification.issue` (agent notification cần handler).

Khác Plane có chủ đích:
- DTO là camelCase, mở rộng từ hàng Drizzle cũ (thêm `isFavorite`, `totalIssues`, `completedIssues`, `cancelledIssues`, `startedIssues`, `unstartedIssues`, `backlogIssues`, `assigneeIds`, `status`; archive thêm điểm estimate). `startDate` và `endDate` là chuỗi ISO theo múi giờ project như Plane. Khóa phân bố trong progress và analytics giữ snake_case của Plane.
- ID là số nguyên. Nhóm "unassigned" của analytics đếm 0 theo `Count("assignee_id")` của Plane.
- Retrieve và list dành cho guest (Plane retrieve app chặn guest). List cycle issue vẫn cần member trở lên.
- Xóa cycle yêu cầu admin hoặc người tạo (trước đây member nào cũng xóa được). Xóa xóa luôn favorite của mọi người dùng, không chỉ của người gọi.
- Assign và remove cycle issue: remove là xóa mềm (trước đây xóa cứng).
- Tạo và sửa cycle lưu ngày đã chuẩn hóa (đầu ngày +1 giây, hoặc "bây giờ" nếu là hôm nay; cuối ngày 23:59) thay vì giá trị client gửi.
- Analytics với `type=points` trên cycle đã có snapshot trả `estimate_distribution` nếu có (Plane luôn trả phân bố issue).
- Chưa ghi recent visit khi xem cycle: `recentVisitEntitySchema` của workspace chỉ có `issue`, `page`, `project`.
- PD-1695 (`burndown_plot`, nhóm 10) đã có phần cycle trong `progress.ts`. Phần module (`module_id`) chưa làm.
- D1 giới hạn 100 biến mỗi câu: `assignCycleIssues` chia 15 hàng mỗi `insert` và 50 id mỗi truy vấn `in`.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

`cyclesRoutes` (named export, cũng là default export) đã được import và mount ở `linkto.apiProject`. Thêm:

```ts
import { cyclesRoutes, workspaceCyclesRoutes } from '@/server/api/v1/routes/cycles'
app.route(linkto.apiProject, cyclesRoutes) // đã có
app.route(linkto.apiWorkspace, workspaceCyclesRoutes) // mới: GET /workspaces/:slug/cycles
```

Thứ tự không quan trọng. `workspaceCyclesRoutes` chỉ có `GET /cycles`.

## (c) Schema ext

[`src/db/schema/ext-p2-cycle.ts`](../../../src/db/schema/ext-p2-cycle.ts): bảng `cycle_progress_snapshots` (khóa duy nhất `cycle_id` + `snapshot_date`). Thêm `export * from './schema/ext-p2-cycle'` vào `src/db/schema.ts`. Gợi ý: `pnpm db:generate --name cycle_progress_snapshots`. Chỉ `snapshot.ts` (cron và `GET /snapshots`) dùng bảng này; mọi chức năng khác chạy khi chưa có bảng. `snapshot.ts` import `* as schema from '@/db/schema'`, nên cần merge trước khi chạy cron.

## (d) Key linkto cần thêm

Route đang dựng đường dẫn từ khóa sẵn có (khối `paths` đầu `routes/cycles.ts`). Khi thêm key, thay khối đó:

| Key đề xuất | Giá trị |
| --- | --- |
| `cyclesLite` | `/cycles-lite` |
| `cycleDateCheck` | `/cycles/date-check` |
| `cycleProgress` | `/cycles/:cycleId/progress` |
| `cycleAnalytics` | `/cycles/:cycleId/analytics` |
| `cycleSnapshots` | `/cycles/:cycleId/snapshots` |
| `cycleUserProperties` | `/cycles/:cycleId/user-properties` |
| `favoriteCycles` | `/user-favorite-cycles` |
| `favoriteCycle` | `/user-favorite-cycles/:cycleId` |

## (e) Dependency, binding, env

Không có dependency, binding hay env mới. Cần binding `JOBS_QUEUE` (đã có) và Cron 5 phút (đã có; lịch `55 23 * * *` rơi vào mốc 5 phút). `src/server/cycle/jobs.ts` tự nạp qua `job-registry.ts`.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm exec tsx --test tests/p2-cycle.integration.mjs`, rồi chạy lại `tests/planning-archive.test.mjs`, `planning.integration.mjs`, `planning-worker.integration.mjs` (đã đổi: xóa cycle cần admin hoặc người tạo, list archive trả DTO, snapshot transfer có thêm khóa), sau đó `pnpm typecheck`.
2. Điểm dễ lỗi kiểu: `db.batch` với mảng câu lệnh ép kiểu trong `assignCycleIssues` và danh sách 5 câu trong `deleteCycle`; `OffsetPaginator<CycleSqlRow>` và `onResults` trả DTO (`Record<string, unknown>`); `sortOrder` nhận `SQL` ở `insert(...).values`; spread tuple `scope(c)` trong `routes/cycles.ts`; `cycleDistributions(..., cycle)` nhận `CycleRecord`.
3. SQL chưa chạy trên SQLite thật (quy ước cấm chạy test). Cần soi trước: `annotatedCyclesSql` (subquery tương quan lồng trong `json_group_array`), `json_set(... json(?))` trong câu `update cycles` của transfer, `insert ... select ... from (subquery) where 1 = 1 on conflict` trong `snapshot.ts`, `filter (where ...)` và `nulls last` trong `cycleDistribution`.
4. Server Action cho form web (`src/app/<x>/actions.ts`) chưa có; service dùng chung đã sẵn sàng.
5. Agent notification cần handler `notification.issue` với payload của job `cycle.transfer.notify` (`type: 'cycle.activity.created'`, `currentInstance.updated_cycle_issues`). Agent webhook cần handler `webhook.model_activity` cho `model_name: 'cycle'`.
6. Thêm `cycle` vào `recentVisitEntitySchema` (nhóm workspace) rồi gọi `recordRecentVisit` ở `retrieveCycle` để có `recent_visited_task` của Plane.
7. Chưa kiểm chứng trên Worker thật: lịch cron `55 23 * * *`, kích thước payload `progress_snapshot` với cycle rất nhiều label hoặc assignee (D1 giới hạn 100 KB mỗi câu SQL; snapshot đi qua tham số nên giới hạn dòng 2 MB).
