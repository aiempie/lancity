# Handoff p2-module

Phạm vi: các mục module trong `docs/plane-demo-porting/07-planning.md` (module, module issues, module link, favorite, user properties, archive, adapter DRF của module, `WorkspaceModulesEndpoint`). Chưa chạy typecheck, build, test theo quy ước. ESLint và Prettier sạch trên mọi file bên dưới.

Code: [`src/server/module/`](../../../src/server/module) · [`routes/modules.ts`](../../../src/server/api/v1/routes/modules.ts) · [`p2-module-schema.ts`](../../../src/types/planning/p2-module-schema.ts). Test: [`tests/p2-module.integration.mjs`](../../../tests/p2-module.integration.mjs) (một kịch bản Worker + D1, chưa chạy).

Cấu trúc file: `service.ts` (module, workspace modules; re-export `issue.ts`, `link.ts`, `favorite.ts`, `user-properties.ts`) · `queries.ts` · `detail.ts` (chi tiết, phân bổ, phân trang) · `issue.ts` · `archive.ts` · `presenters.ts` · `serializers.ts` · `model-rules.ts` · `events.ts` · `access.ts`.

## (a) PD đã xử lý

JSON trả về dùng camelCase như phần còn lại của Lancity (`totalIssues`, `memberIds`, `isFavorite`). Input giữ snake_case như Plane (`start_date`, `member_ids`, `lead_id`).

| PD | Kết quả | Code |
| --- | --- | --- |
| 0201, 0667, 0036, 0341 | Port `createModule`. Thêm `lead_id`, `member_ids` (hoặc `lead`, `members` của API), `description_text/html`, `view_props`, `sort_order`, `external_*`, `logo_props`. Chỉ giữ thành viên đang hoạt động của project, lead phải là thành viên (400). Không truyền `lead_id` thì người tạo làm lead (hành vi cũ của Lancity). 409 khi trùng tên hoặc trùng `external_source` + `external_id`. Queue `webhook.model_activity` sau khi ghi | service.ts |
| 0207, 0670, 0664, 0037, 0342 | Port `updateModule` (PATCH và PUT). Module đã archive trả 400. `member_ids` thay toàn bộ danh sách (xóa phần thừa, thêm phần thiếu). Kiểm tra ngày theo giá trị đã lưu | service.ts, route PATCH/PUT |
| 0209, 0671 | Port `deleteModule`. Chỉ admin project hoặc người tạo (đổi so với bản cũ cho mọi member xóa). Xóa mềm module, members, links, user properties, draft_issue_modules; xóa hẳn module_issues, favorite, recent visit; mỗi issue nhận `module.activity.deleted` qua `issue.activity` | service.ts |
| 0202, 0203 | Port `listModulesPaginated` (`GET /modules?cursor=&per_page=` trả khung phân trang, có `fields`, `expand`). Không có tham số phân trang thì trả mảng như trước | service.ts, detail.ts (`paginateModules`) |
| 0668 | Port `listModules`: mảng module kèm bộ đếm, `isFavorite`, `memberIds`; favorite trước, rồi mới nhất trước. Mỗi dòng là superset của dòng Drizzle cũ | service.ts |
| 0204, 0205 | Port `listModulesLite` (`GET /modules-lite`), sắp xếp theo `MODULE_ORDER_BY_ALLOWLIST` | service.ts, p2-module-schema.ts |
| 0208 | Port `getModuleApi` (`GET /modules/:id?fields=&expand=`) | service.ts |
| 0669 | Port `getModuleDetail`: `linkModule`, `subIssues`, ước lượng theo nhóm trạng thái, `distribution` (assignee, label, `completionChart`), `estimateDistribution` khi project dùng estimate kiểu points, ghi recent visit. Module archive trả 404 | service.ts, detail.ts, queries.ts |
| 0661 | Port `listArchivedModules(…, moduleId?)`: danh sách có bộ đếm, hoặc chi tiết đầy đủ như 0669 (biểu đồ chỉ cần hai ngày) | archive.ts |
| 0219, 0220 | Port `listArchivedModulesPaginated` (`GET /archived-modules?per_page=`) | archive.ts |
| 0221, 0222, 0662, 0663 | Đã có `setModuleArchived` (POST/DELETE archive, restore, xóa favorite khi archive). Không đổi | archive.ts |
| 0922 | Port `getWorkspaceModules` (`GET /workspaces/:slug/modules`, router `workspaceModulesRoutes`): module của project chưa archive mà người gọi là thành viên | service.ts |
| 0200, 0206, 0218, 0660, 0666 | Port. Một truy vấn `queryModules` thay cho ba bản queryset trùng lặp của Plane (12 subquery đếm thành một `left join` gom nhóm). Các tên của checklist là alias | queries.ts |
| 0211, 0212, 0691 đến 0694 | Port `listModuleIssuesApi` (API, mặc định `order_by=created_at`, thêm `bridgeId`) và `listModuleIssuesPaginated` (app, member trở lên). Dùng `paginateIssues` của p1-issue-core với filter `module=<id>`, nên nhận đủ filter, `group_by`, `sub_group_by`, `order_by` của danh sách issue. Guest bị hạn chế chỉ thấy issue mình tạo | issue.ts |
| 0215, 0216, 0687 | Port `getModuleIssueItem` (`GET /modules/:id/module-issues/:issueId` và `/issues/:issueId`) | issue.ts |
| 0213 | Port `assignModuleIssues` (`POST /module-issues`, 204): issue đang ở module khác thì chuyển sang (như Plane chuyển assignment đầu tiên), issue mới thì thêm. Mọi id phải là issue của project (404). Chia lô 50/10 vì D1 giới hạn 100 tham số, bản cũ vượt giới hạn khi gửi trên 16 issue | issue.ts |
| 0695 | Port `createModuleIssues` (`POST /modules/:id/issues`, 201 `{message: "success"}`): chỉ thêm, bỏ qua id không hợp lệ, một issue có thể ở nhiều module | issue.ts |
| 0696 | Port `createIssueModules` (`POST /issues/:issueId/modules`, body `modules`, `removed_modules`) | issue.ts |
| 0217, 0697 | `removeModuleIssue`: API 404 khi thiếu, app (`DELETE /modules/:id/issues/:issueId`) 204. Có thêm activity `module.activity.deleted` | issue.ts |
| 0210, 0214, 0689, 0690 | Gộp. Danh sách issue dùng chung `ISSUE_LIST_SELECT` (đã chứa `cycle_id`, `link_count`, `attachment_count`, `sub_issues_count`); `queryModuleIssueBridges` trả `bridge_id`; `moduleIssueQuery` thêm filter module | queries.ts, issue.ts |
| 0672 đến 0677, 0678, 0679, 0343 đến 0346, 0039 | Port link: list, get, create, PATCH và PUT, delete. URL thêm `http://` nếu thiếu, chỉ nhận http/https, không có user:pass, tối đa 200 ký tự; trùng URL trong module trả 400 `URL_ALREADY_EXISTS`. PATCH chỉ đổi trường có trong body (Plane đòi `url` kể cả khi chỉ đổi title). Xóa mềm | link.ts, p2-module-schema.ts |
| 0680, 0681 | Thay thế. `list` của Plane không có serializer nên lỗi; trả các dòng favorite của module trong project | favorite.ts |
| 0682, 0683 | Port tạo (204, 404 nếu module không thấy được; gọi lại là no-op) và xóa favorite (204, 404 nếu không có) | favorite.ts |
| 0684, 0685 | Port get (tạo với mặc định lần đầu) và PATCH (201). PATCH tạo dòng nếu chưa có thay vì 404; mọi role kể cả guest | user-properties.ts |
| 0665 | Thay thế bằng `selectModuleSchema` (write cho create/update/partial_update, read còn lại). Route chọn schema Zod tường minh theo thao tác | serializers.ts |
| 0035, 0340 | Port Zod `moduleWriteInputSchema` (POST, PUT) và `moduleUpdateInputSchema` (PATCH). Đích `types/planning/schema.ts` đổi sang `p2-module-schema.ts` theo quy ước nhóm | p2-module-schema.ts |
| 0038 | Port `toModuleResponseApi` (thêm `members`) | presenters.ts |
| 0339 | Port `toModuleWriteResponse` | presenters.ts |
| 1445 đến 1447 | Port `getDefaultFilters`, `getDefaultDisplayFilters`, `getDefaultDisplayProperties` | model-rules.ts |
| 1448 | Port `saveModule`: sort order mới = nhỏ nhất của project trừ 10000 | model-rules.ts |
| 1449 đến 1453 | Tham chiếu. `formatModule`, `formatModuleMember`, `formatModuleIssue`, `formatModuleLink`, `formatModuleUserProperties` | presenters.ts |
| 0664 | Gộp vào `PUT /modules/:id` (cùng `updateModule`, schema yêu cầu `name`) | route |

PD để trống (ngoài phạm vi):
- **0686, 0688** (`ModuleIssueViewSet.partial_update`, `update`): hai handler DRF thừa kế serialize một `Issue` bằng `ModuleIssueSerializer` nên không có hành vi dùng được. Route `PATCH` và `PUT /modules/:id/issues/:issueId` trả 405. Thêm hoặc bỏ issue dùng POST và DELETE.

## (b) Route cần đăng ký vào `index.ts`

`modulesRoutes` đã mount tại `linkto.apiProject`. Thêm router workspace:

```ts
import { modulesRoutes, workspaceModulesRoutes } from '@/server/api/v1/routes/modules'
app.route(linkto.apiWorkspace, workspaceModulesRoutes) // MỚI: GET /workspaces/:slug/modules
```

Không cần thứ tự đặc biệt. Đường dẫn mới trong `modulesRoutes` (project): `/modules-lite`, `/modules/:moduleId/issues[/:issueId]`, `/modules/:moduleId/module-links[/:linkId]`, `/modules/:moduleId/user-properties`, `/issues/:issueId/modules` (POST), `/user-favorite-modules[/:moduleId]`, `PUT /modules/:moduleId`, `GET /modules/:moduleId/module-issues/:issueId`. Không trùng router khác đã có.

Đổi so với route cũ:
- `GET /modules` và `GET /modules/:id` trả DTO có bộ đếm và camelCase mở rộng. `GET /modules/:id` nay là chi tiết đầy đủ.
- `GET /archived-modules` trả mảng DTO; `GET /archived-modules/:id` trả chi tiết.
- `POST /modules` trả DTO đầy đủ (vẫn 201).
- `GET /modules/:id/module-issues` vẫn trả mảng `{assignment, issue}`, trừ khi có `cursor`, `per_page`, `order_by`, `group_by` hoặc `fields` (khi đó là khung phân trang). `POST` vẫn 204.
- Xóa module cần admin project hoặc người tạo (trước đây mọi member).

## (c) Schema ext

Không có bảng hoặc cột mới, nên không có `ext-p2-module.ts` và không cần migration. Không cần chỉ mục mới (`module_issues_module_id_idx` đã có).

## (d) Key linkto cần thêm

Hiện khai báo cục bộ trong `routes/modules.ts` (`moduleRoutes`). Khi thêm vào `apiV1Routes` thì thay hằng cục bộ:

```ts
modulesLite: '/modules-lite',
moduleLinks: '/modules/:moduleId/module-links',
moduleLink: '/modules/:moduleId/module-links/:linkId',
moduleUserProperties: '/modules/:moduleId/user-properties',
moduleAppIssues: '/modules/:moduleId/issues',
moduleAppIssue: '/modules/:moduleId/issues/:issueId',
issueModules: '/issues/:issueId/modules',
userFavoriteModules: '/user-favorite-modules',
userFavoriteModule: '/user-favorite-modules/:moduleId',
workspaceModules: '/modules' // dùng ở mức workspace
```

## (e) Dependency, binding, env

Không có. Job đẩy đi (qua `JOBS_QUEUE` có sẵn):
- `issue.activity` kiểu `module.activity.created` và `module.activity.deleted`, mỗi issue một job, `requestedData: { module_id }`, `currentInstance: { module_name }` khi xóa, `notification: true`. Handler của p1-issue-background ghi activity (không có cờ `activityRecorded`).
- `webhook.model_activity` (`MODEL_ACTIVITY_JOB` của `project/events.ts`) khi tạo và sửa module, payload `{ model_name: 'module', model_id, requested_data, current_instance, actor_id, slug }`. Handler thuộc nhóm webhook; chưa có thì job bị bỏ và ghi log.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chưa chạy `pnpm typecheck`, test, build. Điểm đáng soi:
   - `db.batch(statements as unknown as Parameters<typeof db.batch>[0])` trong `service.ts` và `issue.ts` (mảng động).
   - `service.createModule`: giá trị `moduleId: sql<number>…` (subquery) trong `insert(moduleMembers).values(...)`; kiểu `JsonValue` của `view_props`, `logo_props` (`z.record(z.string(), z.json())`).
   - `queries.ts`, `detail.ts`: `db.all<…>(sql…)`, kiểu trả về của `paginate` với `controller`.
   - `routes/modules.ts`: spread tuple `...project(c)` vào hàm có thêm tham số.
   - `getModuleDetail` ép `entity_name: 'module'` sang `RecordRecentVisit['entity_name']` vì `recentVisitEntitySchema` của nhóm workspace chỉ liệt kê `issue`, `page`, `project` (Plane cũng ghi `module`). Nhóm workspace nên thêm `module` và `cycle` vào enum, rồi bỏ ép kiểu.
2. SQL thô trong `queries.ts` (`moduleStatsJoin`, phân bổ assignee/label, burndown) chưa chạy trên D1 thật. Kiểm tra tên bảng `"user"`, `profiles`, `estimate_points`, `estimates`.
3. Burndown (PD-1695, nhóm reporting) được port cục bộ cho module trong `queryModuleBurndown` vì `src/server/analytics/analytics-plot.ts` chưa tồn tại. Khi nhóm 10 xong thì có thể thay bằng `burndownPlot`.
4. Khác Plane có chủ đích: thời gian trả ISO UTC (không đổi theo múi giờ người dùng, thay `user_timezone_converter`); `expand` chỉ nạp `lead` và `members` (hàng user gồm `id`, `name`, `username`, `image`) và dùng serializer đã `registerExpansion`; activity module-issue gửi theo từng issue (Plane gửi một job với `issue_id=None` cho API, tracker của Lancity cần `issueId`); thêm issue qua route app chỉ gửi activity cho issue mới thêm.
5. Delete module hard-delete `module_issues` để `module_ids` của issue không còn tham chiếu module đã xóa (phép join `module_ids` trong `issue/filter.ts` không kiểm tra `modules.deleted_at`).
6. Test `tests/p2-module.integration.mjs` giả định `POST /issues` chỉ cần `name` và dự án có `module_view = 1` (bật bằng SQL). Chưa có ca cho member không phải người tạo bị 403 khi xóa, vì cần thêm project member qua SQL.
7. Hoãn: Server Action cho module (`src/app/modules/actions.ts`) và giao diện web. Service đã dùng chung được, nhưng prompt không giao phạm vi UI.
