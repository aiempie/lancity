# Handoff p4-migrations

Nhóm 16 (`docs/plane-demo-porting/16-migrations.md`): 67 data migration Django. 16 mục đã tick từ trước (SQL trên SQLite cô lập, `scripts/db/import-plane/*.ts`) giữ nguyên và vẫn chạy. 51 mục còn trống nay có hàm biến đổi thuần trong `scripts/plane-import/`, kèm công cụ nhập đầy đủ. Không tạo migration Drizzle, không sửa `drizzle/*`, không sửa file dùng chung.

Đã chạy: `pnpm exec eslint` trên các file của nhóm (sạch) và một lần `tsc --noEmit` chỉ để đọc lỗi thuộc `scripts/plane-import` và `tests/p4-migrations*` (sạch). **Chưa chạy test, build.** Các phép tính trong test đã được kiểm tay, nhưng chưa có lần chạy thực tế.

## (a) PD đã xử lý

Mã: [`scripts/plane-import/`](../../../scripts/plane-import). Test: [`tests/p4-migrations.test.mjs`](../../../tests/p4-migrations.test.mjs). Bảng PD → hàm nằm ở [`coverage.ts`](../../../scripts/plane-import/coverage.ts) (test kiểm tra đủ 67 mục, mỗi mục trỏ tới một hàm có thật).

Mỗi hàm tương ứng đúng function gốc trong Plane (đã đọc từng migration). Cột "file" là file trong `scripts/plane-import/`.

| PD | Hàm | File | Ghi chú |
| --- | --- | --- | --- |
| 1290 | `updateCompanyOrganizationSize` | transforms-accounts | `company_size` → chuỗi |
| 1291 | `onboardingDefaultSteps` | transforms-accounts | chỉ áp dụng khi nguồn < 0037 |
| 1292 | `restructureTheming` | transforms-accounts | chỉ áp dụng khi nguồn < 0038 |
| 1293, 1297 | `renameField`, `rectifyFieldIssueActivity` | transforms-history | bản hàng đơn của SQL trong `normalize-history.ts` (đã tick) |
| 1294 | `updateWorkspaceMemberProps` | transforms-props | |
| 1295, 1300, 1301, 1316 | `backfillSortOrder` và các alias tên gốc | transforms-props | Plane dùng số ngẫu nhiên. Ở đây giữ giá trị đã có, thiếu thì `thứ hạng theo ID nguồn × 100` để chạy lại ra cùng kết quả |
| 1296 | `generateDisplayName` | transforms-accounts | giữ tên hiển thị đã có (theo README) |
| 1298 | `updateAssigneeIssueActivity` | transforms-history | tra theo email; identifier là UUID Plane, importer đổi sang ID `user` |
| 1299 | `updateNameActivity` | transforms-history | |
| 1302, 1303 | `updateUserIssueProperties`, `workspaceMemberProperties` | transforms-props | |
| 1304 | `updateUserTimezone` | transforms-accounts | giữ múi giờ hợp lệ, còn lại UTC |
| 1305 | `createIssueRelation` | transforms-history | importer bỏ qua quan hệ đã có |
| 1306 | `updateIssuePriorityChoice` | transforms-props | |
| 1307–1309 | `workspaceMemberProps`, `projectMemberProps`, `cycleModuleProps` | transforms-props | chạy lại không đổi kết quả |
| 1310–1313 | `updateWorkspaceMemberViewProps`, `updateProjectMemberViewProps`, `updateCycleProps`, `updateModuleProps` | transforms-props | cycle/module chỉ đổi khi `view_props` có khóa cũ `filter`, đúng như nguồn |
| 1314, 1315 | `updateIssueActivityPriority`, `updateIssueActivityBlocked` | transforms-history | |
| 1317 | `updatePages` | transforms-content | gộp PageBlock vào `description_html`, tạo `page_logs`; tên block và tiêu đề được escape; `entity_identifier` trong embed là ID D1 |
| 1318 | `userPasswordAutoset` | transforms-accounts | **Không nhập hash Django** (không tương thích Better Auth). Tài khoản `credential` có `password = NULL`, người dùng đặt lại mật khẩu |
| 1319, 1320 | `workspaceUserProperties`, `projectUserProperties` | transforms-props | |
| 1321 | `issueView` | transforms-content | `project_id` rỗng |
| 1322, 1323, 1324, 1326 | Port. Importer tạo widget, dashboard cá nhân và liên kết cho dump trước 0055. Dump trước 0059 chạy thêm bước đổi filter. | [transforms-content.ts](../../../scripts/plane-import/transforms-content.ts) · [convert.ts](../../../scripts/plane-import/convert.ts) · [dashboard.ts](../../../src/db/schema/dashboard.ts) | D1 lưu dữ liệu lịch sử bằng ID số và hỗ trợ tên bảng `deprecated_*` của 0090. Dump từ 0092 trở đi thiếu các bảng đã bị Plane xóa sẽ không được seed lại. |
| 1325 | `createNotificationPreferences` | transforms-accounts | |
| 1327 | `updateProjectLogoProps` | transforms-accounts | |
| 1328 | `updateProjectStateGroup` | transforms-history | đã tick, thêm bản hàng đơn |
| 1329 | `migrateUserProfile` | transforms-accounts | |
| 1330 | `userFavoriteMigration` | transforms-content | importer nhận tệp `cycle_favorites`, `module_favorites`, `project_favorites`, `page_favorites`, `issue_view_favorites` hoặc `view_favorites`. **Tên bảng cũ chưa đối chiếu được vì repo Plane hiện tại đã bỏ model này** |
| 1331 | `issueEstimatePoint` | transforms-history | khác nguồn: key không khớp được ghi cảnh báo thay vì crash |
| 1332 | `lastUsedEstimate` | transforms-history | đã tick, thêm bản hàng đơn |
| 1333 | `populateDeployBoard` | transforms-content | giữ `anchor` của board cũ (README), khác nguồn tạo anchor mới |
| 1334 | `migratePages` | transforms-content | |
| 1335 | `populateViewsOwnedBy` | transforms-content | |
| 1336 | `updateWorkspaceProjectMemberRole` | transforms-props | **Xung đột tài liệu**: README ghi `10` → `15`, nhưng migration `0076` gốc đổi `10` → `5`. Tôi theo source (5). Đổi một dòng nếu chủ dự án muốn 15 |
| 1337 | `migrateDraftIssues` | transforms-content | issue `is_draft` chỉ vào `draft_issues` (không vào `issues`), ánh xạ ID riêng |
| 1338, 1339 | `moveAttachmentToFileasset`, `markExistingFileUploads` | transforms-content | `is_uploaded` chỉ bật khi key nằm trong `--uploaded-keys` hoặc có `--assume-uploaded`. **Công cụ không sao chép byte S3 → R2**; nó ghi `asset-copies.json` (id + key) để một bước riêng sao chép rồi xác nhận |
| 1340, 1341, 1342 | `setDefaultSourceType`, `setPageSortOrder`, `reverseSetPageSortOrder` | transforms-history / transforms-content | đã tick, thêm bản hàng đơn |
| 1343, 1344 | `migrateFiltersToRichFilters`, `reverseMigrateRichFiltersToFilters` | transforms-content | nhận converter tiêm vào; CLI nạp `LegacyToRichFiltersConverter` của p1-platform |
| 1345 | `createTriageState` | transforms-history | |
| 1346–1348 | `setDefaultProductTourToFalse`, `getDefaultProductTour`, `populateProductTour` | transforms-accounts | importer ưu tiên `profiles.product_tour` có sẵn |
| 1349 | `moveIssueUserPropertiesToProjectUserProperties` | transforms-props | |
| 1350 | `migrateExistingApiTokens` | transforms-accounts | importer **bỏ qua `api_tokens` mặc định**; `--include-api-tokens` nhập token không phải service ở trạng thái `is_active = 0`, `workspace_id = NULL`. Cần chính sách thu hồi và tạo lại |
| 1351–1355 | `setGettingStartedChecklist`, `setDefaultTips`, `setDefaultExploredFeatures`, `setDefaultProductTour`, `migrateAllTheProductTourToTrue` | transforms-accounts | đã tick, thêm bản hàng đơn |
| 1356 | `resetProjectDeployBoardIdentity` | transforms-content | bản hàng đơn của SQL đã tick; importer chạy khi nguồn < 0125 |

PD để trống: không. Mục còn hạn chế (không phải "ngoài phạm vi"): PD-1322–1324 và PD-1326 thiếu bảng đích; PD-1338/1339 thiếu bước sao chép R2 thật; PD-1318 không mang mật khẩu.

### Công cụ nhập

```sh
pnpm exec tsx scripts/plane-import/cli.ts --dump ./dump --out ./out --validate
wrangler d1 execute <db> --remote --file ./out/001-user.sql   # lần lượt từng tệp, theo thứ tự số
```

- Đầu vào: thư mục có `<bảng Plane>.json | .jsonl | .csv` (CSV là `COPY ... CSV HEADER` của Postgres; ô trống không có nháy là NULL, `t`/`f` là boolean, `\x…` là bytea). Bảng `users` → `user`, `accounts` → `account`; các bảng khác trùng tên bảng D1.
- Schema đích: đọc trực tiếp từ `drizzle/*.sql` (chạy vào SQLite trong bộ nhớ, đọc `PRAGMA table_info` và `foreign_key_list`). Khóa ngoại, kiểu cột, NOT NULL và mặc định đều lấy từ đó, nên bảng ext mới tự được nhập khi migration được merge.
- ID: mỗi bảng một bộ đếm riêng; `id-map.json` (UUID → ID) giữ ổn định giữa các lần chạy (`--id-map`) và `--start bảng=n` cho D1 đã có dữ liệu. Giá trị tham chiếu không tìm thấy: cột NOT NULL thì bỏ cả hàng, cột nullable thì đặt NULL, đều ghi `report.json`.
- Thời gian: chuỗi timestamp Postgres → epoch mili giây khi cột đích là số nguyên; ngày `YYYY-MM-DD` ở cột text giữ nguyên; `issue_activities.epoch` giữ theo giây.
- `--source-migration <n>` (mặc định 125): chỉ áp dụng quy tắc của migration lớn hơn `n`. Các phép chuẩn hóa vô hại (role, priority, activity) luôn chạy.
- Mỗi tệp SQL mở đầu bằng `PRAGMA defer_foreign_keys = on;` và chỉ có `INSERT` từng hàng (không có BEGIN/COMMIT vì D1 không cho). `--validate` áp toàn bộ vào schema mới trong một transaction rồi `PRAGMA foreign_key_check`.
- Một hàng có thể vượt giới hạn 100 KB mỗi câu lệnh của D1 (mô tả rất dài). Công cụ chưa cảnh báo việc này.

Migration [0006_historical_dashboards.sql](../../../drizzle/0006_historical_dashboards.sql) giữ `logo_props`, dấu xóa mềm và ràng buộc duy nhất cho liên kết widget đang hoạt động. `identifier` của dashboard được giữ dạng text để bảo toàn UUID đa loại của Plane. [Kiểm thử import dashboard](../../../tests/dashboard-import.test.mjs)

## (b) Route cần đăng ký

Không có.

## (c) Schema ext cần merge

Không có. Không thêm bảng hay cột.

## (d) Key linkto cần thêm

Không có.

## (e) Dependency, binding, env cần thêm

Không có dependency mới (dùng `zod` và `node:sqlite` có sẵn). Chạy CLI bằng `tsx` (đã có) vì `--validate` và converter cần alias `@/` và `node:sqlite`. Nếu muốn có script ngắn: `"db:import-plane": "tsx scripts/plane-import/cli.ts"` trong `package.json` (tôi không sửa).

Zod: [`src/types/database/p4-migrations-schema.ts`](../../../src/types/database/p4-migrations-schema.ts) (dòng dump, ID map, tùy chọn, báo cáo).

## (f) Việc dang dở và chỗ dễ lỗi

- **Chưa có lần chạy nào của `tests/p4-migrations.test.mjs`.** Chạy: `pnpm exec tsx --test tests/p4-migrations.test.mjs`. Hai ca đầu-cuối (dump hiện tại và dump migration 48) dựng dữ liệu nhỏ vào schema thật; nếu một cột NOT NULL không mặc định bị thiếu, hàng sẽ bị bỏ và ca đó fail kèm tên cột trong `report.warnings`.
- Parse thời gian dựa vào `Date.parse` của V8 cho chuỗi có microsecond (`.123456`).
- `PRAGMA defer_foreign_keys` chỉ có hiệu lực trong cùng một transaction. D1 chạy mỗi tệp `--file` như một lô; nếu một tệp lớn bị tách, các vòng khóa ngoại `projects`↔`estimates` có thể báo lỗi. Nhập theo đúng thứ tự tệp và cân nhắc `--validate` trước.
- Ánh xạ định danh trong `issue_activities.new_identifier/old_identifier` theo trường (`assignees`, `state`, `labels`, `cycles`, `modules`, `parent`, `estimate_point`, `blocked_by`…). Trường khác bị đặt NULL và ghi một dòng cảnh báo tổng.
- `entity_identifier` (user_favorites, page_logs, deploy_boards) suy ra bảng từ `entity_name`/`entity_type`; giá trị lạ thành NULL.
- Giá trị cần xác nhận với dữ liệu thật: tên bảng favorite cũ (PD-1330), cột `inbox` của ProjectDeployBoard (map sang `intake_id`, PD-1333), và việc các export Postgres thật có đúng tên cột Django.
- `scripts/db/import-plane/*.ts` (đã có) không đổi. Chúng làm việc trên SQLite đã nhập; `scripts/plane-import` làm việc trên dữ liệu Plane trước khi nhập. Hai bên cùng quy tắc, nên không cần chạy cả hai.
