# Handoff p3-analytics

Nhóm: phần analytics của `docs/plane-demo-porting/10-reporting.md`. Các file Python gốc: `analytic/advance.py`, `analytic/base.py`, `analytic/project_analytics.py`, `serializers/analytic.py`, `bgtasks/analytic_plot_export.py`, `db/models/analytic.py`, `utils/analytics_plot.py`, `utils/build_chart.py`. View, search, export issue, import và các file `utils/exporters`, `utils/porters` không thuộc nhóm này.

Chưa chạy test, build, typecheck theo quy ước. ESLint và Prettier sạch trên mọi file bên dưới. Test: [`tests/p3-analytics.integration.mjs`](../../../tests/p3-analytics.integration.mjs) dùng D1 giả trên `node:sqlite` (cùng cách với `p2-cycle.integration.mjs`), không cần Worker. Chạy bằng `pnpm exec tsx --test tests/p3-analytics.integration.mjs`. Test tự tạo bảng `analytic_exports` vì migration chưa có. Các giá trị kỳ vọng được tính tay, nên lần chạy đầu có thể lộ sai lệch nhỏ.

Mã: [`src/server/analytics/`](../../../src/server/analytics) · route [`routes/analytics.ts`](../../../src/server/api/v1/routes/analytics.ts) · Zod [`p3-analytics-schema.ts`](../../../src/types/reporting/p3-analytics-schema.ts) · schema [`ext-p3-analytics.ts`](../../../src/db/schema/ext-p3-analytics.ts).

## (a) PD đã xong

Tất cả PD trong phạm vi đã xử lý. Không có PD để trống.

| PD | Kết quả | Code |
| --- | --- | --- |
| 0401, 0404, 0407 | Port. `GET /advance-analytics`, `/advance-analytics-stats`, `/advance-analytics-charts` của workspace. Quyền admin/member (guest bị 403). `tab`/`type` sai trả 400 | [advance.ts](../../../src/server/analytics/advance.ts) (`getAdvanceAnalytics`, `getAdvanceAnalyticsStats`, `getAdvanceAnalyticsChart`) |
| 0395 | Port. `initializeWorkspaceAdvanceAnalyticsBase` gọi `getAnalyticsFilters` của p1-platform, trả ngữ cảnh gồm scope issue (workspace, thành viên project, `project_ids`) | advance.ts |
| 0396-0398 | Port. `getFilteredCountsAdvanceAnalytics`, `getFilteredCount`, `getPreviousCount` (Plane định nghĩa nhưng không dùng; giữ để tham chiếu) | advance.ts |
| 0399, 0400 | Port. `getOverviewDataAdvanceAnalytics`, `getWorkItemsStatsAdvanceAnalytics` | advance.ts |
| 0402, 0403 | Port. Số issue theo state group của từng project (có và không có chu kỳ biểu đồ) | advance.ts |
| 0405, 0406 | Port. `projectChartAdvanceAnalyticsChart` (work items, cycles, modules, intake, members, pages, views) và `workItemCompletionChartAdvanceAnalyticsChart` (theo tháng) | advance.ts |
| 0408 | Port. `GET /analytics`: `total`, `distribution`, `extras` (state, assignee, label, cycle, module) | [service.ts](../../../src/server/analytics/service.ts) (`getAnalytics`) |
| 0414, 0415, 0294, 0295 | Port/gộp. CRUD `analytic_views` (`createAnalyticView`, `updateAnalyticView`, `deleteAnalyticView`, `getAnalyticView`, `listAnalyticViews`) và `queryAnalyticView` | service.ts, [queries.ts](../../../src/server/analytics/queries.ts) |
| 0409-0413 | Gộp. Adapter Hono `POST/GET /analytic-view`, `GET/PATCH/DELETE /analytic-view/:viewId` | [routes/analytics.ts](../../../src/server/api/v1/routes/analytics.ts) |
| 0416 | Port. `GET /saved-analytic-view/:analyticId?segment=` | service.ts (`getSavedAnalytic`) |
| 0417 | Port. `POST /export-analytics` ghi một dòng `analytic_exports`, đẩy job `analytics.export_plot`, trả `message` và `exportId`. Thêm `GET /export-analytics/:exportId/download` để tải file | service.ts (`exportAnalytics`, `getAnalyticExport`), routes |
| 0418 | Port. `GET /default-analytics` (guest cũng xem được) | service.ts (`getDefaultAnalytics`) |
| 0419 | Port. `GET /project-stats?fields=&project_ids=` | service.ts (`getProjectStats`) |
| 0420-0423 | Port. Project advance analytics: số issue theo state group, có thể giới hạn theo `cycle_id` hoặc `module_id` | [project-analytics.ts](../../../src/server/analytics/project-analytics.ts) |
| 0424, 0427, 0429 | Port. `GET /projects/:projectId/advance-analytics`, `-stats`, `-charts`. Charts cho cả guest, hai endpoint còn lại chỉ admin/member | project-analytics.ts, routes |
| 0425, 0426, 0428 | Port. Thống kê project theo từng assignee, và biểu đồ hoàn thành theo ngày (cycle, module) hoặc theo tháng (project) | project-analytics.ts |
| 1367 | Port. `formatAnalytic` và `presentAnalyticView` | [presenters.ts](../../../src/server/analytics/presenters.ts) |
| 1689-1694 | Port. `annotateWithMonthlyDimension`, `extractAxis`, `sortData`, `buildGraphPlot` thành SQL trên bảng `issues`. Nhãn tháng không đệm số 0 (`2024-3`) như Plane | [analytics-plot.ts](../../../src/server/analytics/analytics-plot.ts) |
| 1695 | Port. `burndownPlot` dùng chung: cycle gọi lại `burndownPlot` của `cycle/progress.ts` qua import (không sửa file đó), module có bản riêng (`module_issues`, ngày dạng text, `issues` hoặc `points`) | analytics-plot.ts |
| 1696-1702 | Port. `getYAxisFilter`, `getXAxisField`, `processGroupedData`, `buildNumberChartResponse`, `buildGroupedChartResponse`, `buildSimpleChartResponse`, `buildAnalyticsChart` | [build-chart.ts](../../../src/server/analytics/build-chart.ts) |
| 1074-1084 | Port (đích checklist là `export/jobs/analytic-plot-export.ts`, đặt ở `analytics/export.ts` vì `src/server/export/` không thuộc nhóm này). `sendExportEmail`, các `get*Details`, `generateCsvFromRows`, `generateSegmentedRows`, `generateNonSegmentedRows`, `analyticExportTask`, `exportAnalyticsToCsvEmail` | [export.ts](../../../src/server/analytics/export.ts), [jobs.ts](../../../src/server/analytics/jobs.ts) |

Job (đăng ký qua `register()` trong `jobs.ts`, tên trong `events.ts`):
- `analytics.export_plot`, payload `{ exportId }`. Idempotent: dòng `analytic_exports` ghi `status`, `object_key`, `emailed_at`; nhận lại message sau khi đã gửi mail thì không làm gì. Như Plane, lỗi nghiệp vụ không retry: ghi log, đặt `status = failed`.
- `analytics.export_csv_email`, payload `{ data, headers, keys, email, slug, userId, workspaceId }` (Plane không có `userId`/`workspaceId`; cần để gắn quyền tải). Không có nơi nào trong phạm vi gọi job này, Plane cũng vậy. Payload tối đa 128 KB.

Khác Plane có chủ đích:
- **CSV không đính kèm email.** `sendMail` chưa hỗ trợ attachment. Job lưu CSV vào R2 (`analytics-exports/<workspaceId>/<userId>/<exportId>.csv`) và email chứa link `GET /api/v1/workspaces/:slug/export-analytics/:exportId/download` (chỉ người yêu cầu tải được). Khi không có binding `ASSET_BUCKET`, CSV nằm trong phần text của email. Nếu p0 thêm `attachments` vào `sendMail`, chỉ cần sửa `finishExport` trong `export.ts`.
- **Saved analytic.** `query` lưu các tham số lọc của `query_dict` (bỏ `x_axis`, `y_axis`, `segment`) và được đánh giá lại bằng `issueFilters(query, 'POST')` lúc đọc, vì Lancity không lưu lookup Django. `PATCH`: Plane đọc `query_data` (khóa không ai gửi) nên mỗi lần sửa xóa trắng `query`. Ở đây `query` đổi theo `query_dict` khi có, giữ nguyên khi không có.
- **Quyền.** `WorkSpaceAdminPermission` của Plane thực tế cho admin và member, nên CRUD analytic view dùng `[ADMIN, MEMBER]`.
- **Liên kết đã xóa mềm.** Nhóm theo label, assignee, cycle, module bỏ các dòng nối có `deleted_at` (Plane chỉ lọc ở vài chỗ). Biểu đồ cycle/module theo ngày bỏ issue đã xóa mềm và tra cycle/module trong đúng workspace.
- Bước resolve tên của cột segment `module` dùng danh sách module (Plane tra nhầm vào danh sách label). Header trục `state_id` là `State` (Plane rơi về `X-Axis`).
- `assignee_details` không còn lọc "có avatar" (Lancity có `user.image` nullable). `first_name`/`last_name` lấy `user.name` và chuỗi rỗng. `member__is_bot` không áp dụng vì bảng `user` không có cột này.
- JSON object luôn sắp khóa kiểu số theo thứ tự tăng dần, nên `distribution` có thể khác thứ tự của Plane với trục id (chỉ ảnh hưởng thứ tự duyệt khóa).
- DTO analytic view là camelCase (`queryDict`, `workspaceId`), cùng quy ước các nhóm p2. Số liệu analytics giữ khóa snake_case của Plane.
- Đường dẫn project trong `routes/analytics.ts`: `GET /projects/:projectId/analytics` (đã có, không đổi) cùng ba route advance mới.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

`analyticsRoutes` (project, đã import và mount ở `linkto.apiProject`) giữ nguyên tên và có thêm 3 route. Thêm router workspace:

```ts
import { analyticsRoutes, workspaceAnalyticsRoutes } from '@/server/api/v1/routes/analytics'
app.route(linkto.apiProject, analyticsRoutes) // đã có
app.route(linkto.apiWorkspace, workspaceAnalyticsRoutes) // mới
```

Thứ tự không quan trọng; không route nào khác ở `apiWorkspace` trùng `/analytics`, `/advance-analytics*`, `/analytic-view*`, `/saved-analytic-view/*`, `/export-analytics*`, `/default-analytics`, `/project-stats`. File cũng có `export default workspaceAnalyticsRoutes`.

## (c) Schema ext

[`src/db/schema/ext-p3-analytics.ts`](../../../src/db/schema/ext-p3-analytics.ts): bảng `analytic_exports` (workspace, user, email, `params` JSON, `status`, `object_key`, `error`, `completed_at`, `emailed_at`). Thêm `export * from './schema/ext-p3-analytics'` vào `src/db/schema.ts`. Gợi ý: `pnpm db:generate --name analytic_exports`. `analytic_views` đã có ở migration `0001`, không cần đổi. Chỉ luồng export dùng bảng mới; mọi endpoint analytics khác chạy khi chưa có bảng. `service.ts` và `export.ts` import bảng trực tiếp từ file ext, còn `export.ts` import `* as schema from '@/db/schema'` nên cần merge trước khi chạy job.

## (d) Key linkto cần thêm

Route đang dùng khối `paths` ở đầu `routes/analytics.ts`. Khi thêm key, thay khối đó:

| Key đề xuất | Giá trị |
| --- | --- |
| `advanceAnalytics` | `/advance-analytics` (workspace và project) |
| `advanceAnalyticsStats` | `/advance-analytics-stats` |
| `advanceAnalyticsCharts` | `/advance-analytics-charts` |
| `workspaceAnalytics` | `/analytics` |
| `analyticViews` | `/analytic-view` |
| `analyticView` | `/analytic-view/:viewId` |
| `savedAnalytic` | `/saved-analytic-view/:analyticId` |
| `exportAnalytics` | `/export-analytics` |
| `exportAnalyticsDownload` | `/export-analytics/:exportId/download` |
| `defaultAnalytics` | `/default-analytics` |
| `projectStats` | `/project-stats` |

Link email dựng bằng `linkto.apiV1` có sẵn.

## (e) Dependency, binding, env

Không có dependency hay binding mới. Cần `JOBS_QUEUE` (đã có). `ASSET_BUCKET` tùy chọn (R2): có thì CSV được lưu và gửi link, không có thì CSV vào thân email. Link email dùng `WEB_URL`, `APP_BASE_URL` hoặc `BETTER_AUTH_URL`, như `baseHost`. Không có cron mới. File R2 `analytics-exports/` không tự hết hạn: nên đặt lifecycle rule của R2 theo tiền tố này hoặc để job dọn export (PD-1134, nhóm export) xử lý. Đề nghị p0: thêm `attachments` vào `MailInput` của `sendMail`.

## (f) Việc còn dang dở và chỗ dễ lỗi

1. Chạy `pnpm exec tsx --test tests/p3-analytics.integration.mjs`, sau đó `pnpm typecheck`.
2. Điểm dễ lỗi kiểu: `db.all<...>` với `sql` nhúng nhiều lớp; `PlotRow` và `Distribution` trong `export.ts` (`generateSegmentedRows` đọc `obj[key]`); kiểu `ChartItem` (giao `Record<string, string | number>`); `analyticViews` `.returning()` và `queryDict: Record<string, JsonValue>`; `params as Record<string, unknown>` ở `exportAnalytics`; `drizzle(env.DB, { schema }) as unknown as LancityDb` trong `export.ts`; `requireProjectRole` trả `PermissionContext`.
3. SQL chưa chạy trên SQLite thật. Cần soi: `count(*) filter (where ...)` trong `STATE_GROUP_COUNTS`, biểu thức `strftime(...) || '-' || cast(...)` của `annotateWithMonthlyDimension`, `order by ... is null` ở `buildSimpleChartResponse` và `getWorkItemsStatsProjectAdvanceAnalyticsStats`, join có alias `x_*`/`g_*` trong `getXAxisField`, `group by` trên cột không gộp trong các hàm `get*Details`.
4. `buildGraphPlot` và `buildAnalyticsChart` đếm issue theo từng liên kết (nhiều label, assignee, cycle, module) giống Plane. Bảng lớn dùng nhiều join nên cần kiểm tra thời gian trên D1.
5. `workItemCompletionChart` giữ nguyên lỗi của Plane khi có chu kỳ biểu đồ: ngày bắt đầu không phải mùng 1 nên không khớp khóa `YYYY-MM-01` của thống kê và tháng hiện tại bị bỏ. Ngày 31 chuyển sang tháng ngắn hơn được kẹp về ngày cuối tháng (Plane báo `ValueError`).
6. Server Action cho giao diện chưa có; service dùng chung đã sẵn sàng. Burndown module hiện chỉ gọi được từ code (chưa có route, Plane cũng không có endpoint riêng); nhóm module có thể import `burndownPlot` từ `analytics/analytics-plot.ts`.
