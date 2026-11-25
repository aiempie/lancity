# Handoff p3-view-search

Phạm vi: view đã lưu (workspace và project), view yêu thích, view issue theo bộ lọc, tìm kiếm toàn cục, tìm entity/mention, tìm issue của project. Nguồn Plane: `app/views/view/base.py`, `app/views/search/base.py`, `app/views/search/issue.py`, `app/serializers/view.py`, `db/models/view.py`. Checklist: `docs/plane-demo-porting/10-reporting.md`.

Chưa chạy typecheck, build, test theo quy ước. ESLint sạch trên mọi file bên dưới.

## (a) PD đã xong

Mã: [`src/server/view/`](../../../src/server/view) (`service.ts`, `queries.ts`, `model-rules.ts`, `presenters.ts`), [`src/server/search/`](../../../src/server/search) (`service.ts`, `issue.ts`), route [`views.ts`](../../../src/server/api/v1/routes/views.ts) và [`search.ts`](../../../src/server/api/v1/routes/search.ts), Zod [`p3-view-schema.ts`](../../../src/types/reporting/p3-view-schema.ts). Test: [`tests/p3-view-search.integration.mjs`](../../../tests/p3-view-search.integration.mjs) (3 ca: view và yêu thích, view issue workspace, ba loại tìm kiếm). Test cũ `tests/notification-views.integration.mjs` vẫn nên chạy lại.

| PD | Kết quả | Code |
| --- | --- | --- |
| 0832, 0833, 0374 | Port. `createView` (workspace) dùng `saveIssueView` (mặc định JSON, `query` suy ra từ `filters`, `sort_order` = lớn nhất + 10000). Serializer `create` gộp vào đây | service.ts, model-rules.ts |
| 0835, 0834 | Port. `listViews(db, actor, slug, query?)` nhận `fields`, `order_by` (allowlist `created_at`, `updated_at`, `name`); guest workspace chỉ thấy view của mình | service.ts, queries.ts (`queryWorkspaceView`) |
| 0831, 0844 | Thay thế. `PUT` trả 401 khi thiếu phiên và 405 khi đã xác thực, tương đương guard của Plane với action `update` kế thừa từ DRF. Cập nhật qua `PATCH`. | [views.ts](../../../src/server/api/v1/routes/views.ts), [index.ts](../../../src/server/api/v1/index.ts) |
| 0836, 0375 | Port. `updateView`: chủ sở hữu, không bị khóa; `query` tính lại chỉ khi body có `filters` | service.ts, model-rules.ts |
| 0837 | Port. `retrieveWorkspaceView` ghi lượt xem gần đây (`entity_name = 'view'`) | service.ts |
| 0838 | Đã có, giữ nguyên (`deleteView`: admin hoặc chủ sở hữu, xóa favorite) | service.ts |
| 0842, 0843, 0839, 0840, 0841 | Port. `listWorkspaceViewIssues` + `queryWorkspaceViewIssues`: issue sống, `filters` JSON (`ComplexFilterBackend` của p1-platform), bộ lọc query-string cũ (`issueFilters` của p1-issue-core), quyền guest theo `guest_view_all_features`, sắp xếp `orderIssueQueryset`, phân trang `pageEnvelope`. `apply_annotations` dùng lại `ISSUE_LIST_SELECT` (p1-issue-core). Callback `on_results` là `toViewIssueListResponse` | service.ts, queries.ts |
| 0845, 0846, 0374 | Port. `createProjectView` | service.ts |
| 0848, 0847 | Port. `listProjectViews` trả thêm `isFavorite`, xếp yêu thích trước rồi theo tên | service.ts, queries.ts (`queryIssueView`) |
| 0849 | Port. `retrieveProjectView` (kèm lượt xem gần đây) | service.ts |
| 0850, 0375 | Port. `updateProjectView` | service.ts |
| 0851 | Đã có, giữ nguyên (`deleteProjectView`) | service.ts |
| 0854, 0853 | Port. `createIssueViewFavorite` (member trở lên, 404 nếu view không hiển thị; tạo lặp là no-op như module), `listIssueViewFavorites` | service.ts, queries.ts |
| 0852 | Có sẵn. Lancity giữ `GET /user-favorite-views` với quyền truy cập project và danh sách theo người gọi trong project. Guard của Plane trả 405 cho action `list` kế thừa. | [views.ts](../../../src/server/api/v1/routes/views.ts), [service.ts](../../../src/server/view/service.ts), [queries.ts](../../../src/server/view/queries.ts) |
| 0855 | Port. `deleteIssueViewFavorite` (xóa cứng, 404 khi không có) | service.ts |
| 0370-0373 | Port. `getAssigneeIdsViewIssueList`, `getLabelIdsViewIssueList`, `getModuleIdsViewIssueList`, `toViewIssueListResponse` (camelCase như các danh sách issue khác) | presenters.ts |
| 0374, 0375 | Gộp vào `createView`, `createProjectView`, `updateView`, `updateProjectView` | service.ts |
| 1502-1504 | Port `getDefaultFilters`, `getDefaultDisplayFilters`, `getDefaultDisplayProperties` | model-rules.ts |
| 1505 | Port `saveIssueView` (checklist ghi `saveIssue`) | model-rules.ts |
| 1506 | Tham chiếu `formatIssueView` | presenters.ts |
| 0789, 0781-0788 | Port. `getGlobalSearch` và 8 hàm `filter*GlobalSearch` (workspace, project, issue, cycle, module, page, view, intake) | search/service.ts |
| 0790 | Port. `search` (entity-search): `user_mention`, `project`, `issue`, `cycle`, `module`, `page` | search/service.ts |
| 0799, 0791-0798 | Port. `getIssueSearch` và 8 hàm điều kiện | search/issue.ts |

Khác Plane có chủ đích:
- Khóa kết quả viết camelCase (`sequenceId`, `projectIdentifier`, `workspaceSlug`...) cho khớp phần còn lại của Lancity. Khóa cấp trên (`results`, `issue_view`, `user_mention`) giữ nguyên.
- `query` của view: Plane lưu kết quả `issue_filters` (lookup Django). Lancity lưu các khóa `filters` còn giá trị (`viewQueryFromFilters`) và đọc lại bằng helper lọc issue. Plane `IssueViewSerializer.update` xóa `query` khi PATCH không có `filters` (lỗi); ở đây `query` giữ nguyên.
- Bảng kết quả tìm kiếm giới hạn 100 dòng cho mọi entity (Plane không giới hạn cycle, module, view, page, project). Workspace, project tìm toàn cục chỉ lấy dòng chưa xóa mềm và thành viên còn hoạt động.
- `count` của entity-search nằm trong 1..100; `count`, `project_id`, `issue_id`, `module` sai định dạng trả 400 thay vì lỗi 500 của Plane.
- `IssueSearchEndpoint` yêu cầu là thành viên workspace (404 nếu không), Plane chỉ trả danh sách rỗng. `filter_root_issues_only` của Plane lỗi 500 khi `issue_id` không tồn tại; ở đây bỏ qua bộ lọc.
- Giữ nguyên hành vi đã có: không-owner sửa view nhận 403, guest bị hạn chế nhận 404 khi xem view không phải của mình (Plane trả 403), view đã lưu trữ không xuất hiện trong danh sách.
- Lượt xem gần đây của view ghi đồng bộ (không qua queue) và bỏ qua lỗi. Ép kiểu `entity_name: 'view' as unknown as 'issue'` vì `recordRecentVisit` của workspace chỉ khai báo `issue | page | project`. Danh sách recent của workspace vẫn chỉ trả ba loại đó.

Ngoài phạm vi (không thuộc nhóm của tôi hoặc không áp dụng): quick filter không có trong source `view/*` của Plane (không có PD) nên không làm. Các PD analytics, exporter trong cùng checklist thuộc agent khác.

## (b) Route cần đăng ký vào `index.ts`

Các router sau đã được mount từ trước, không đổi: `viewsRoutes` và `workspaceSearchRoutes` ở `linkto.apiWorkspace`, `projectViewsRoutes` và `projectSearchRoutes` ở `linkto.apiProject`.

Cần thêm một router mới:

```ts
import { projectViewsRoutes, viewsRoutes, workspaceViewIssuesRoutes } from '@/server/api/v1/routes/views'
app.route(linkto.apiWorkspace, workspaceViewIssuesRoutes) // GET /issues
```

Thứ tự: `workspaceViewIssuesRoutes` chỉ có `GET /issues` (đường dẫn đúng), `issuesWorkspaceRoutes` của p1-issue-core chỉ có `/issues/search` và `/issues/:identifier`, nên không xung đột. Đường dẫn mới trong router đã mount: `GET /global-search`, `GET /entity-search` (workspace), `GET /search-issues` (project, cùng `POST`/`DELETE /user-favorite-views[/:viewId]` và `GET /user-favorite-views` trong `projectViewsRoutes`).

`/search` (workspace) và `/issue-search` (project) giữ nguyên phản hồi dạng mảng issue để không làm gãy client cũ. Nếu muốn dùng đúng đường dẫn Plane, đổi `/global-search` thành `/search` và `/search-issues` thành `/issue-search` rồi cập nhật client.

## (c) Schema ext

Không có bảng hoặc cột mới, nên không có `ext-p3-view.ts`. Mọi truy vấn dùng `issue_views`, `user_favorites`, `user_recent_visits` và các bảng sẵn có. Chỉ mục gợi ý (không bắt buộc), tên `0003_view_search_indexes`: `issue_views(workspace_id, project_id, deleted_at)` và `user_favorites(user_id, entity_type, entity_identifier)` nếu danh sách view chậm. Tìm kiếm dùng `like '%q%'` nên quét bảng; có thể cân nhắc FTS5 về sau.

## (d) Key linkto cần thêm

Hiện khai báo cục bộ trong route (`p3ViewRoutes`, `p3SearchRoutes`). Khi thêm vào `apiV1Routes`:

```ts
viewFavorites: '/user-favorite-views',
viewFavorite: '/user-favorite-views/:viewId',
workspaceViewIssues: '/issues',
globalSearch: '/global-search',
entitySearch: '/entity-search',
searchIssues: '/search-issues'
```

## (e) Dependency, binding, env

Không cần. Không có job nền mới (lượt xem gần đây ghi đồng bộ).

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`. Điểm dễ lỗi: `queries.ts` (`exists(db.select(...))` kèm `.then` trên truy vấn Drizzle, so sánh `userFavorites.entityIdentifier` với cột `issueViews.id` trong subquery tương quan); `model-rules.ts` (`columns()` trả union object khi trải vào `db.insert().values`); kiểu `ViewInput` (`z.input` kèm `access`); `service.ts` (`input as ViewUpdate` khi nhận `SavedViewUpdate | ViewUpdate`).
2. `queries.ts` import `LIVE_ISSUES` từ `issue/list`, và `search/*` cũng vậy. Nếu có vòng import, chuyển `LIVE_ISSUES` sang file chung.
3. Chạy `tests/notification-views.integration.mjs` (route cũ) và `tests/p3-view-search.integration.mjs` sau khi mount `workspaceViewIssuesRoutes`. Chưa chạy lần nào. Ca "workspace view issues" giả định `filters={"priority__in":"low"}` được `issueFilterSet` chấp nhận.
4. Mô tả `fields=` của danh sách view nhận cả snake_case lẫn camelCase.
5. Giới hạn D1: `ComplexFilterBackend` cho tối đa 80 phần tử mỗi danh sách; bộ lọc cũ trong query-string có thể vượt 100 tham số nếu gửi hàng trăm id.
6. `json_group_array` trong `filterPagesGlobalSearch` và `searchEntityPages` dựa vào việc mỗi (page, project) chỉ có một dòng nên không cần DISTINCT. Nếu `project_pages` có bản ghi trùng chưa xóa mềm, mảng sẽ lặp.
