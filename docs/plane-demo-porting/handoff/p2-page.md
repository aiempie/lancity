# Handoff p2-page

Nhóm 08 (`docs/plane-demo-porting/08-content.md`), phần page: CRUD, lock/archive/duplicate/access, favorite, sub-page, mô tả nhị phân (Yjs), version, validator HTML/binary, `strip_tags`, job `page_transaction` và `page_version`. Chưa chạy typecheck, build, test theo quy ước. ESLint sạch trên mọi file bên dưới.

Phần asset, attachment, `copy_s3_object`, `file_asset_task`, `storage_metadata` của cùng file checklist không thuộc phạm vi này (xem mục "PD để trống").

## (a) PD đã xử lý

Test: [`tests/p2-page.test.ts`](../../../tests/p2-page.test.ts) (đơn vị, `tsx --test`) và [`tests/p2-page.integration.mjs`](../../../tests/p2-page.integration.mjs) (Worker + D1, cần Worker không có `JOBS_QUEUE` để job chạy inline). `tests/page.test.mjs` hiện có vẫn dùng đúng chữ ký service cũ.

| PD | Kết quả | Code |
| --- | --- | --- |
| 0714, 0347 | Port. `createPage` (gộp `PageSerializer.create`): sanitize HTML, nhị phân base64, nhãn, parent, màu, view/logo props, ghi `pages` + `project_pages` + nhãn trong một batch D1, đẩy job `page.transaction` | [service.ts](../../../src/server/page/service.ts) |
| 0715, 0348 | Port. `updatePage` (gộp `PageSerializer.update`): khóa/lưu trữ chặn (409), chỉ chủ sở hữu đổi `access`, kiểm tra parent cùng project và không tạo vòng, thay nhãn (xóa mềm nhãn cũ rồi thêm mới) | service.ts |
| 0716 | Port. `getPage(..., { trackVisit })`: trả `issueIds` từ `page_logs`, ghi `user_recent_visits` khi `trackVisit` (route mặc định `track_visit=true`) | service.ts, [presenters.ts](../../../src/server/page/presenters.ts) |
| 0717, 0718 | Đã có sẵn, giữ nguyên: `setPageLocked`. Khóa cần quyền ghi, mở khóa cần quản trị viên hoặc chủ sở hữu | service.ts |
| 0719 | Port. `setPageAccess` (`POST …/access`): người không phải chủ đổi sang giá trị khác trả 400 | service.ts |
| 0720 | Port. `listPages` có `orderBy` (allowlist `created_at, updated_at, name, sort_order`), `search`; trang yêu thích lên đầu; trả `labelIds`, `projectIds`, `isFavorite`, `parentId` | service.ts, [queries.ts](../../../src/server/page/queries.ts) |
| 0721, 0722, 0712 | Đã có sẵn, giữ nguyên: `setPageArchived` (CTE đệ quy cho hậu duệ nằm trong hàm, tương ứng `unarchive_archive_page_and_descendants`; bỏ yêu thích khi lưu trữ; gỡ parent đã lưu trữ khi bỏ lưu trữ) | service.ts |
| 0723 | Port. `deletePage(..., { requireArchived })`: route bắt buộc đã lưu trữ (400 `PAGE_NOT_ARCHIVED`), trang con mất parent, xóa yêu thích và lượt xem gần đây của trang trong cùng batch | service.ts |
| 0724 | Port. `summaryPage` (`GET …/pages-summary`): `publicPages`, `privatePages`, `archivedPages` | service.ts, queries.ts |
| 0725, 0726 | Port. `createPageFavorite` (dùng lại `createWorkspaceFavorite`, idempotent), `deletePageFavorite` (404 khi chưa có). Cần vai trò project từ thành viên trở lên | service.ts |
| 0727, 0728 | Port. `getPagesDescription` trả `Uint8Array`; route trả `application/octet-stream` khi `?format=binary` hoặc `Accept: application/octet-stream`. Mặc định vẫn trả JSON như trước | service.ts, [pages.ts](../../../src/server/api/v1/routes/pages.ts) |
| 0729, 0352 | Port. `updatePagesDescription`: 400 `PAGE_LOCKED`/`PAGE_ARCHIVED`, kiểm tra binary/HTML, đẩy job `page.transaction` khi có HTML và `page.version` khi HTML đổi | service.ts |
| 0730 | Port. `duplicatePage`: tên `(Copy)`, chủ là người gọi, không chép binary/nhãn/external id, nối với mọi project của trang gốc, đẩy `page.transaction` và `asset.copy_s3_objects` | service.ts |
| 0713 | Port. `queryPage` (phạm vi workspace, liên kết project còn hiệu lực, xóa mềm, project lưu trữ, khách bị giới hạn) và `queryPageSummary` | queries.ts |
| 0732 | Port. `getPageVersion` (chi tiết có base64) và `listPageVersions`; version bị ràng buộc theo `pageId` và liên kết project còn hiệu lực | [version.ts](../../../src/server/page/version.ts), service.ts |
| 0275-0280, 1963-1968 | Port thành hàm thuần và hàm đọc D1: `checkProjectActionAccess`, `hasPublicPageActionAccess`, `hasPrivatePageActionAccess`, `checkProjectMemberAccess`, `checkAccessAndGetRole`, `hasPermissionProjectPagePermission`. Service dùng cùng ma trận qua `requirePageAccess`; các hàm này để domain khác (live) tái sử dụng | [permissions.ts](../../../src/server/page/permissions.ts) |
| 0349, 0351 | Port vào service thay cho `src/types/content/schema.ts` (file đó không thuộc p2-page): `resolveDescription` gọi `validateHtmlContent`; Zod `descriptionHtml` ở `p2-page-schema.ts` | service.ts, [p2-page-schema.ts](../../../src/types/content/p2-page-schema.ts) |
| 0350 | Port. `resolveBinary` gọi `validateBinaryData` (base64, tối đa 10 MB, tối thiểu 4 byte, mẫu đáng ngờ) | service.ts |
| 1712-1716 | Port: `validateBinaryData`, `computeHtmlSanitizationDiff` (+ `collect`), `validateHtmlContent`, `hasAlphanumeric`. Thay `nh3` bằng `sanitizeHtml` của [`issue/comment-html.ts`](../../../src/server/issue/comment-html.ts) | [content-validator.ts](../../../src/server/page/content-validator.ts) |
| 1844-1847 | Port: `MLStripper`, `stripTags`, kèm `decodeEntities` | [html-processor.ts](../../../src/server/page/html-processor.ts) |
| 1210-1214 | Port: `extractAllComponents`, `getEntityDetails`, `planPageTransactions` (logic của `page_transaction`) và `syncPageTransactions`/`pageTransaction`; hai lambda `extract` nằm trong `COMPONENT_MAP` | [jobs/page-transaction.ts](../../../src/server/page/jobs/page-transaction.ts) |
| 1215 | Port. `trackPageVersion`: gộp vào version cuối nếu cùng người và trong 600 giây, giữ tối đa 20 version (xóa mềm phần cũ) | [jobs/page-version.ts](../../../src/server/page/jobs/page-version.ts) |
| 1457, 1459, 1463 | Port. `getViewProps`, `savePage`/`pageDescriptionStripped`, `savePageVersion`, hằng `MAX_PAGE_VERSIONS`, `PAGE_VERSION_TASK_TIMEOUT` | [model-rules.ts](../../../src/server/page/model-rules.ts) |
| 1458, 1460-1462 | Tham chiếu. `formatPage`, `formatPageLog`, `formatPageLabel`, `formatProjectPage` | presenters.ts |

Đăng ký job: [`jobs.ts`](../../../src/server/page/jobs.ts) (`page.transaction`, `page.version`), registry tự nạp. Hằng số loại job ở [`events.ts`](../../../src/server/page/events.ts).

### Khác Plane có chủ đích

- `description_html` của Plane gửi vào `page_transaction`/`track_page_version` qua Celery. Ở đây payload chỉ có id (Queue giới hạn 128 KB, HTML tới 10 MB); job đọc trang từ D1. `page_transaction` so với `page_logs` hiện có thay vì HTML cũ, xóa log theo `page_id` (Plane xóa theo `transaction` trên mọi trang) và xóa cứng (Plane xóa mềm nên mention thêm lại sau khi xóa bị chặn bởi ràng buộc duy nhất).
- `track_page_version` của Plane đọc `page.description`, thuộc tính không tồn tại nên task luôn lỗi. Ở đây dùng `description_json`.
- `PageViewSet.retrieve` của Plane lọc `parent__isnull=True` nên trang con trả 404. Ở đây `getPage` trả cả trang con (cần cho sub-page); danh sách vẫn chỉ trả trang gốc.
- `PageViewSet.access` của Plane đặt `access = 0` khi thiếu trường. Ở đây bắt buộc có `access` (400 nếu thiếu).
- Duplicate không chép `external_id`/`external_source`. Plane gán sai `project_id` của job chép asset (biến vòng lặp ghi đè); ở đây dùng project trong URL.
- Parent phải thuộc cùng project và không được là hậu duệ của chính trang (Plane không kiểm tra).
- `description_binary` ở `create` của Plane lưu nguyên chuỗi; ở đây là base64, giải mã và kiểm tra rồi lưu byte.
- `entity_identifier` của `page_logs` là số nguyên: mention có id không phải số và ảnh (`src`) lưu `null`, còn `entity_name` vẫn được giữ.
- Body nhận cả camelCase và snake_case (`description_html`). Response dùng camelCase, giống API trang hiện có (`archived_at` của route archive giữ như cũ).
- Kết quả `validateHtmlContent` là object `{ isValid, error, cleanHtml }` thay vì tuple. `cleanHtml === null` nghĩa là đầu vào rỗng, giữ giá trị gốc.
- `getPage` và `listPageVersions` trả HTML đã lưu (đã sanitize khi ghi) thay vì dựng lại từ văn bản; trang cũ tạo bằng `descriptionText` đã được escape sẵn.

### PD để trống (ngoài phạm vi p2-page)

| PD | Lý do |
| --- | --- |
| 0048-0060 | Asset API v1: thuộc agent asset |
| 0297, 0298, 0434-0440, 0441-0470 | Asset, validator file: thuộc agent asset |
| 0570-0576 | Attachment issue: thuộc agent asset |
| 1097-1103 | `copy_s3_object`: thuộc agent asset. `duplicatePage` đẩy job `asset.copy_s3_objects` (payload `{ entityName: 'PAGE', entityIdentifier, projectId, slug, userId }`). Nếu chưa có handler, `handleQueueBatch` xác nhận và bỏ qua loại job lạ |
| 1135 | `file_asset_task`: asset |
| 1219 | `storage_metadata_task`: asset |
| 1372-1376 | Model asset: asset |
| 1388, 1389 | `Description`/`DescriptionVersion` là model mô tả dùng chung (issue, comment), không phải page |
| 0731 | `PageLiveAccessEndpoint`: nhóm 14-live (đã có `collaboration/access.ts`) |

## (b) Route cần đăng ký vào `index.ts`

Không cần thay đổi. `pagesRoutes` (export có tên trong `src/server/api/v1/routes/pages.ts`) đã được mount; file chỉ thêm route. Route mới (mọi đường dẫn nằm cùng prefix với route trang hiện có):

- `GET …/projects/:projectId/pages-summary`
- `POST …/projects/:projectId/pages/:pageId/access`
- `POST …/projects/:projectId/pages/:pageId/duplicate`
- `POST`, `DELETE …/projects/:projectId/favorite-pages/:pageId`

Hành vi đổi trên route cũ: `DELETE …/pages/:pageId` giờ yêu cầu trang đã lưu trữ (400 nếu chưa); `GET …/pages/:pageId` ghi lượt xem gần đây trừ khi `?track_visit=false`; `PATCH …/description` có body `description_binary`/`description_html`/`description_json` thì chạy cập nhật nhị phân của Plane và trả `{ message }`, body khác vẫn chạy cập nhật văn bản như trước; `GET …/versions/:versionId` trả chi tiết đầy đủ (kèm `descriptionJson` và `descriptionBinary` base64) thay vì phần tử của danh sách.

## (c) Schema ext cần merge

Không có. Mọi bảng cần dùng (`pages`, `project_pages`, `page_labels`, `page_logs`, `page_versions`, `user_favorites`, `user_recent_visits`) đã có trong migration `0001`; không tạo `ext-p2-page.ts`. Gợi ý thêm sau này nếu truy vấn chậm: chỉ mục `page_versions(page_id, last_saved_at)`.

## (d) Key linkto cần thêm

Đề xuất (route hiện dựng đường dẫn từ key cũ trong `pagePaths` của `pages.ts`, thay bằng key khi có):

- `projectPagesSummary: '/:slug/projects/:projectId/pages-summary'`
- `projectPageAccess: '/:slug/projects/:projectId/pages/:pageId/access'`
- `projectPageDuplicate: '/:slug/projects/:projectId/pages/:pageId/duplicate'`
- `projectPageFavorite: '/:slug/projects/:projectId/favorite-pages/:pageId'`

## (e) Dependency, binding, env

- Dependency: không thêm. Sanitizer dùng lại `sanitizeHtml` của p1-issue-collab, nên nếu file đó đổi tên export thì `content-validator.ts` cần sửa theo.
- Binding: dùng `DB` và `JOBS_QUEUE` hiện có. Không cần env mới.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`. Chỗ dễ lỗi: `queryPage` chọn `descriptionHtml: includeDescription ? pages.descriptionHtml : sql<string | null>\`null\`` (kiểu union cột/SQL); `db.all<{ id: number }>` trong `assertParent`; kiểu `Buffer` cho `descriptionBinary` khi `.set()`; `c.body(bytes.buffer as ArrayBuffer, …)` trong route; `z.preprocess` kết hợp `.refine` khi truyền vào `readJson`.
2. Chạy `pnpm exec tsx --test tests/p2-page.test.ts tests/page.test.mjs` rồi `tests/p2-page.integration.mjs`. Các câu SQL batch mới (`with np as materialized … last_insert_rowid()` trong `createPage`/`duplicatePage`, `json_each`) chưa được chạy; kiểm tra bằng test tích hợp trên D1 thật. `tests/page.test.mjs` giả lập `prepare().bind()`, câu mới dùng cùng cách.
3. Binary ghi qua `.update().toSQL()` rồi `bind(...params)` (cùng kiểu với tạo version cũ). Cần xác nhận D1 nhận `Buffer` đúng như các bảng khác dùng blob.
4. `src/app/pages/*` (Server Action và form) chưa mở rộng: chưa có UI cho lock, archive, duplicate, favorite. Service dùng chung đã sẵn sàng.
5. Handler `asset.copy_s3_objects` thuộc agent asset; chưa có thì bản sao trang không kèm bản sao tệp trong mô tả.
6. Khi có `JOBS_QUEUE`, job `page.transaction` và `page.version` chạy bất đồng bộ nên `page_logs`/`page_versions` xuất hiện sau phản hồi.
