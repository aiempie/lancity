# Data migration Django cần đối chiếu khi nhập dữ liệu

[Về kế hoạch chuyển đổi](../plane-demo-porting.md) · [Danh mục endpoint](./endpoints.md)

**Đợt Khi nhập dữ liệu** · **67 function gốc** · **0 adapter kế thừa**.

Đánh dấu riêng từng mục sau khi đã chuyển hoặc xác nhận chức năng thay thế tương đương. Nếu chốt ngoài phạm vi, giữ ô trống và ghi quyết định cạnh mục. Đường dẫn sau mũi tên là nơi dự kiến ở Lancity.

Các mục theo nhu cầu hoặc tham chiếu cần quyết định phạm vi trước khi phát triển.

## Ánh xạ dữ liệu lịch sử sang D1

Bản xuất Plane sau migration `0125` đã qua các phép biến đổi Django. Giữ số thứ tự, thứ tự hiển thị, trạng thái xóa mềm và JSON hiện có. Với bản xuất cũ hơn, áp dụng quy tắc tương ứng trước khi ghi các hàng đích. Dùng bảng ánh xạ UUID nguồn sang ID tự tăng riêng cho từng bảng và kiểm tra khóa ngoại theo workspace/project. Chuyển timestamp sang epoch mili giây cho `timestamp_ms`, giữ ngày nghiệp vụ dạng `YYYY-MM-DD`, và giữ `issue_activities.epoch` theo giây.

| PD | Mục đích và quy tắc ánh xạ |
| --- | --- |
| PD-1290 | Ghi `company_size` dạng chuỗi vào `workspaces.organization_size`. |
| PD-1291, PD-1292 | Chuyển trạng thái onboarding và theme lồng của tài khoản cũ vào `profiles`, liên kết với ID Better Auth. |
| PD-1293, PD-1297 | Chuẩn hóa tên trường lịch sử `assignee` thành `assignees`. |
| PD-1294 | Điền `workspace_members.view_props` khi trống, giữ JSON đã tùy chỉnh. |
| PD-1295, PD-1300, PD-1301, PD-1316 | Giữ `sort_order` đã phát sinh cho project member, cycle, module và label. Với bản xuất thiếu giá trị, dùng thứ tự ổn định theo ID nguồn để có thể chạy lại. |
| PD-1296 | Dùng phần email trước `@` làm `user.name` khi bản xuất thiếu tên hiển thị. |
| PD-1298 | Tìm người được giao theo email cũ, dùng tên hiển thị và ánh xạ cả hai identifier activity sang ID `user`. |
| PD-1299 | Sửa nội dung sự kiện đổi tên đang ghi nhầm `start date`. |
| PD-1302, PD-1303 | Điền thuộc tính hiển thị ngày bắt đầu trong thiết lập issue cá nhân và workspace member, giữ tùy chỉnh sau nâng cấp. |
| PD-1304 | Gán UTC cho dữ liệu cũ thiếu timezone, nhập giá trị hiện có vào `profiles.user_timezone`. |
| PD-1305 | Chuyển IssueBlocker sang `issue_relations`, giữ chiều quan hệ và dịch hai khóa issue trong cùng project. |
| PD-1306 | Chuẩn hóa priority `NULL` thành `none` trước khi ghi issue. |
| PD-1307–PD-1313 | Giữ JSON `filters`, `display_filters`, `display_properties` đã chuẩn hóa trong view props của workspace member, project member, cycle và module. Giữ `default_props` riêng cho membership. |
| PD-1314, PD-1315 | Đổi priority rỗng trong activity thành `none` và tên trường `blocks` thành `blocked_by`. |
| PD-1317 | Hợp nhất PageBlock vào nội dung Page và chuyển liên kết issue trong block sang ID D1. Dùng dữ liệu editor từ bản xuất đã nâng cấp và kiểm tra nội dung trước khi hiển thị. |
| PD-1318 | Django đánh dấu mật khẩu đã thiết lập. Xác minh tương thích credential hoặc yêu cầu đặt lại mật khẩu bằng Better Auth khi nhập tài khoản. |
| PD-1319, PD-1320 | Tách thiết lập cá nhân sang `workspace_user_properties` và `project_user_properties` theo user và scope. Giữ JSON filter/display đã chuyển. |
| PD-1321 | Chuyển GlobalView thành `issue_views` có `project_id` rỗng và ánh xạ workspace/chủ sở hữu. |
| PD-1322–PD-1324, PD-1326 | Nhập widget, dashboard cá nhân và liên kết vào D1. Seed cho dump trước 0055, cập nhật filter cho dump trước 0059, hỗ trợ tên bảng `deprecated_*` của 0090. |
| PD-1325 | Ánh xạ tùy chọn thông báo theo user vào `user_notification_preferences`. |
| PD-1327 | Giữ emoji, icon và `logo_props.in_use` để phản ánh loại logo đang dùng. |
| PD-1328 | Đổi state `Triage` từ `backlog` thành `triage` và đặt `is_triage`. |
| PD-1329 | Tách hồ sơ khỏi user. Giữ credential trong Better Auth và dữ liệu hồ sơ trong `profiles`. |
| PD-1330 | Hợp nhất favorite của cycle, module, project, page và view vào `user_favorites`, giữ loại entity, ID đã ánh xạ và thứ tự. |
| PD-1331, PD-1332 | Đổi giá trị estimate của issue và activity thành ID `estimate_points` theo project. Ghi cờ `last_used` cho estimate đã được gán. |
| PD-1333 | Chuyển ProjectDeployBoard sang `deploy_boards`, giữ anchor và flags, gán các ID theo PD-1356. |
| PD-1334 | Tạo `project_pages` từ quan hệ project cũ của Page, giữ cùng workspace. |
| PD-1335 | Dùng `created_by_id` làm `issue_views.owned_by_id` nếu bản xuất thiếu chủ sở hữu. |
| PD-1336 | Đổi role membership `10` thành `15` trước khi ghi để khớp CHECK của D1. |
| PD-1337 | Tách issue draft và liên kết assignee, label, cycle, module vào các bảng draft. Dùng ánh xạ ID riêng với issue đã công bố. |
| PD-1338, PD-1339 | Chuyển metadata attachment vào `file_assets`. Sao chép byte S3 sang R2 và xác nhận object trước khi đặt `is_uploaded`. |
| PD-1340 | Chuẩn hóa source `in-app` theo enum intake hiện tại. |
| PD-1341, PD-1342 | Giữ `sort_order` page hiện có; với bản cũ, tạo thứ tự tăng theo tên và ID nguồn. Mục reverse mô tả snapshot sau rollback về giá trị mặc định. |
| PD-1343, PD-1344 | Giữ `rich_filters` đã chuyển. Bản chỉ có `filters` cần chuyển toán tử và ID trước khi truy vấn. Mục reverse mô tả việc xóa rich filters khi rollback. |
| PD-1345 | Tạo triage state còn thiếu và gán issue triage tương ứng, duy trì cùng project. |
| PD-1346–PD-1348 | Dùng mặc định tour chưa hoàn thành cho user mới, điền tour đã hoàn thành cho workspace cũ. Khi nhập, ưu tiên `profiles.product_tour` sau PD-1355. |
| PD-1349 | Chuyển tùy chọn issue-user và sort order sang `project_user_properties.preferences` theo project/member. |
| PD-1350 | Bỏ workspace scope của token người dùng cũ theo quy tắc nguồn. Các token này cần chính sách thu hồi và tạo lại trước khi có adapter Lancity. |
| PD-1351–PD-1355 | Điền tour vào `profiles`, checklist/tips/explored features vào `workspace_members`. |
| PD-1356 | Gán `entity_identifier` theo `project_id` kể cả board đã xóa mềm. Ưu tiên board đã khớp và hủy công bố bản trùng đang dùng. |

Các phép biến đổi issue activity, board, triage, estimate, intake, thứ tự page và onboarding đã chạy trên SQLite cô lập. Migration `0002` giữ các quan hệ issue đã lưu và cho phép quan hệ giữa project cùng workspace. Các quy tắc còn lại cần dữ liệu nguồn đại diện để kiểm chứng. [Kiểm thử migration](../../tests/migrations.test.mjs)

## `apps/api/plane/db/migrations/0035_auto_20230704_2225.py`

- [x] <a id="pd-1290" name="pd-1290"></a> **PD-1290** [`update_company_organization_size`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0035_auto_20230704_2225.py#L6) → `updateCompanyOrganizationSize` → `scripts/db/import-plane/0035-auto-20230704-2225.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1289).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0037_issue_archived_at_project_archive_in_and_more.py`

- [x] <a id="pd-1291" name="pd-1291"></a> **PD-1291** [`onboarding_default_steps`, dòng 11](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0037_issue_archived_at_project_archive_in_and_more.py#L11) → `onboardingDefaultSteps` → `scripts/db/import-plane/0037-issue-archived-at-project-archive-in-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1290).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0038_auto_20230720_1505.py`

- [x] <a id="pd-1292" name="pd-1292"></a> **PD-1292** [`restructure_theming`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0038_auto_20230720_1505.py#L6) → `restructureTheming` → `scripts/db/import-plane/0038-auto-20230720-1505.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1291).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0039_auto_20230723_2203.py`

- [x] <a id="pd-1293" name="pd-1293"></a> **PD-1293** [`rename_field`, dòng 7](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0039_auto_20230723_2203.py#L7) → `renameField` → `scripts/db/import-plane/0039-auto-20230723-2203.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Ánh xạ `assignee` thành `assignees` trong fixture đã áp dụng hai migration Drizzle. [Mã Lancity](../../scripts/db/import-plane/normalize-history.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1294" name="pd-1294"></a> **PD-1294** [`update_workspace_member_props`, dòng 17](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0039_auto_20230723_2203.py#L17) → `updateWorkspaceMemberProps` → `scripts/db/import-plane/0039-auto-20230723-2203.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1293).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1295" name="pd-1295"></a> **PD-1295** [`update_project_member_sort_order`, dòng 63](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0039_auto_20230723_2203.py#L63) → `updateProjectMemberSortOrder` → `scripts/db/import-plane/0039-auto-20230723-2203.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1294).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py`

- [x] <a id="pd-1296" name="pd-1296"></a> **PD-1296** [`generate_display_name`, dòng 14](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L14) → `generateDisplayName` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1295).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1297" name="pd-1297"></a> **PD-1297** [`rectify_field_issue_activity`, dòng 29](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L29) → `rectifyFieldIssueActivity` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Gộp với PD-1293, fixture kiểm tra đổi tên trường và chạy lại. [Mã Lancity](../../scripts/db/import-plane/normalize-history.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1298" name="pd-1298"></a> **PD-1298** [`update_assignee_issue_activity`, dòng 39](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L39) → `updateAssigneeIssueActivity` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1297).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-history.ts`](../../scripts/plane-import/transforms-history.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1299" name="pd-1299"></a> **PD-1299** [`update_name_activity`, dòng 89](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L89) → `updateNameActivity` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận sửa nội dung sự kiện đổi tên. [Mã Lancity](../../scripts/db/import-plane/normalize-history.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1300" name="pd-1300"></a> **PD-1300** [`random_cycle_order`, dòng 99](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L99) → `randomCycleOrder` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1299).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1301" name="pd-1301"></a> **PD-1301** [`random_module_order`, dòng 110](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L110) → `randomModuleOrder` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1300).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1302" name="pd-1302"></a> **PD-1302** [`update_user_issue_properties`, dòng 121](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L121) → `updateUserIssueProperties` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1301).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1303" name="pd-1303"></a> **PD-1303** [`workspace_member_properties`, dòng 132](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0041_cycle_sort_order_issuecomment_access_and_more.py#L132) → `workspaceMemberProperties` → `scripts/db/import-plane/0041-cycle-sort-order-issuecomment-access-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1302).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0042_alter_analyticview_created_by_and_more.py`

- [x] <a id="pd-1304" name="pd-1304"></a> **PD-1304** [`update_user_timezones`, dòng 9](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0042_alter_analyticview_created_by_and_more.py#L9) → `updateUserTimezones` → `scripts/db/import-plane/0042-alter-analyticview-created-by-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1303).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0043_alter_analyticview_created_by_and_more.py`

- [x] <a id="pd-1305" name="pd-1305"></a> **PD-1305** [`create_issue_relation`, dòng 9](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0043_alter_analyticview_created_by_and_more.py#L9) → `createIssueRelation` → `scripts/db/import-plane/0043-alter-analyticview-created-by-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1304).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-history.ts`](../../scripts/plane-import/transforms-history.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1306" name="pd-1306"></a> **PD-1306** [`update_issue_priority_choice`, dòng 33](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0043_alter_analyticview_created_by_and_more.py#L33) → `updateIssuePriorityChoice` → `scripts/db/import-plane/0043-alter-analyticview-created-by-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1305).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0044_auto_20230913_0709.py`

- [x] <a id="pd-1307" name="pd-1307"></a> **PD-1307** [`workspace_member_props`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L6) → `workspaceMemberProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1306).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1308" name="pd-1308"></a> **PD-1308** [`project_member_props`, dòng 61](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L61) → `projectMemberProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1307).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1309" name="pd-1309"></a> **PD-1309** [`cycle_module_props`, dòng 91](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L91) → `cycleModuleProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1308).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1310" name="pd-1310"></a> **PD-1310** [`update_workspace_member_view_props`, dòng 112](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L112) → `updateWorkspaceMemberViewProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1309) · Liên kết gọi [PD-1307](./16-migrations.md#pd-1307).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1311" name="pd-1311"></a> **PD-1311** [`update_project_member_view_props`, dòng 126](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L126) → `updateProjectMemberViewProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1310) · Liên kết gọi [PD-1308](./16-migrations.md#pd-1308).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1312" name="pd-1312"></a> **PD-1312** [`update_cycle_props`, dòng 138](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L138) → `updateCycleProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1311) · Liên kết gọi [PD-1309](./16-migrations.md#pd-1309).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1313" name="pd-1313"></a> **PD-1313** [`update_module_props`, dòng 150](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0044_auto_20230913_0709.py#L150) → `updateModuleProps` → `scripts/db/import-plane/0044-auto-20230913-0709.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1312) · Liên kết gọi [PD-1309](./16-migrations.md#pd-1309).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0045_issueactivity_epoch_workspacemember_issue_props_and_more.py`

- [x] <a id="pd-1314" name="pd-1314"></a> **PD-1314** [`update_issue_activity_priority`, dòng 10](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0045_issueactivity_epoch_workspacemember_issue_props_and_more.py#L10) → `updateIssueActivityPriority` → `scripts/db/import-plane/0045-issueactivity-epoch-workspacemember-issue-props-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận cả `NULL` và chuỗi rỗng được chuyển thành `none`. [Mã Lancity](../../scripts/db/import-plane/normalize-history.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1315" name="pd-1315"></a> **PD-1315** [`update_issue_activity_blocked`, dòng 25](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0045_issueactivity_epoch_workspacemember_issue_props_and_more.py#L25) → `updateIssueActivityBlocked` → `scripts/db/import-plane/0045-issueactivity-epoch-workspacemember-issue-props-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận đổi tên trường `blocks` thành `blocked_by`. [Mã Lancity](../../scripts/db/import-plane/normalize-history.ts) · [Kiểm thử](../../tests/migrations.test.mjs).

## `apps/api/plane/db/migrations/0046_label_sort_order_alter_analyticview_created_by_and_more.py`

- [x] <a id="pd-1316" name="pd-1316"></a> **PD-1316** [`random_sort_ordering`, dòng 11](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0046_label_sort_order_alter_analyticview_created_by_and_more.py#L11) → `randomSortOrdering` → `scripts/db/import-plane/0046-label-sort-order-alter-analyticview-created-by-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1315).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0049_auto_20231116_0713.py`

- [x] <a id="pd-1317" name="pd-1317"></a> **PD-1317** [`update_pages`, dòng 9](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0049_auto_20231116_0713.py#L9) → `updatePages` → `scripts/db/import-plane/0049-auto-20231116-0713.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1316).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0050_user_use_case_alter_workspace_organization_size.py`

- [x] <a id="pd-1318" name="pd-1318"></a> **PD-1318** [`user_password_autoset`, dòng 7](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0050_user_use_case_alter_workspace_organization_size.py#L7) → `userPasswordAutoset` → `scripts/db/import-plane/0050-user-use-case-alter-workspace-organization-size.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1317).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). Lưu ý: Không nhập hash mật khẩu Django (không tương thích Better Auth); người dùng đặt lại mật khẩu. <!-- handoff-status -->

## `apps/api/plane/db/migrations/0053_auto_20240102_1315.py`

- [x] <a id="pd-1319" name="pd-1319"></a> **PD-1319** [`workspace_user_properties`, dòng 5](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0053_auto_20240102_1315.py#L5) → `workspaceUserProperties` → `scripts/db/import-plane/0053-auto-20240102-1315.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1318).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1320" name="pd-1320"></a> **PD-1320** [`project_user_properties`, dòng 28](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0053_auto_20240102_1315.py#L28) → `projectUserProperties` → `scripts/db/import-plane/0053-auto-20240102-1315.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1319).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1321" name="pd-1321"></a> **PD-1321** [`issue_view`, dòng 51](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0053_auto_20240102_1315.py#L51) → `issueView` → `scripts/db/import-plane/0053-auto-20240102-1315.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1320).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0055_auto_20240108_0648.py`

- [x] <a id="pd-1322" name="pd-1322"></a> **PD-1322** [`create_widgets`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0055_auto_20240108_0648.py#L6) → `createWidgets` → `scripts/db/import-plane/0055-auto-20240108-0648.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1321).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts), [`convert.ts`](../../scripts/plane-import/convert.ts), [`dashboard.ts`](../../src/db/schema/dashboard.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1323" name="pd-1323"></a> **PD-1323** [`create_dashboards`, dòng 52](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0055_auto_20240108_0648.py#L52) → `createDashboards` → `scripts/db/import-plane/0055-auto-20240108-0648.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1322).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts), [`convert.ts`](../../scripts/plane-import/convert.ts), [`dashboard.ts`](../../src/db/schema/dashboard.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1324" name="pd-1324"></a> **PD-1324** [`create_dashboard_widgets`, dòng 71](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0055_auto_20240108_0648.py#L71) → `createDashboardWidgets` → `scripts/db/import-plane/0055-auto-20240108-0648.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1323).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts), [`convert.ts`](../../scripts/plane-import/convert.ts), [`dashboard.ts`](../../src/db/schema/dashboard.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0057_auto_20240122_0901.py`

- [x] <a id="pd-1325" name="pd-1325"></a> **PD-1325** [`create_notification_preferences`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0057_auto_20240122_0901.py#L6) → `createNotificationPreferences` → `scripts/db/import-plane/0057-auto-20240122-0901.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1324).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0059_auto_20240208_0957.py`

- [x] <a id="pd-1326" name="pd-1326"></a> **PD-1326** [`widgets_filter_change`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0059_auto_20240208_0957.py#L6) → `widgetsFilterChange` → `scripts/db/import-plane/0059-auto-20240208-0957.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1325).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts), [`convert.ts`](../../scripts/plane-import/convert.ts), [`dashboard.ts`](../../src/db/schema/dashboard.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0061_project_logo_props.py`

- [x] <a id="pd-1327" name="pd-1327"></a> **PD-1327** [`Migration.update_project_logo_props`, dòng 8](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0061_project_logo_props.py#L8) → `updateProjectLogoPropsMigration` → `scripts/db/import-plane/0061-project-logo-props.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1326).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0063_state_is_triage_alter_state_group.py`

- [x] <a id="pd-1328" name="pd-1328"></a> **PD-1328** [`update_project_state_group`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0063_state_is_triage_alter_state_group.py#L6) → `updateProjectStateGroup` → `scripts/db/import-plane/0063-state-is-triage-alter-state-group.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture đổi state `Triage` ở `backlog` sang group `triage` và bật cờ tương ứng. [Mã Lancity](../../scripts/db/import-plane/normalize-planning.ts) · [Kiểm thử](../../tests/migrations.test.mjs).

## `apps/api/plane/db/migrations/0065_auto_20240415_0937.py`

- [x] <a id="pd-1329" name="pd-1329"></a> **PD-1329** [`migrate_user_profile`, dòng 13](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0065_auto_20240415_0937.py#L13) → `migrateUserProfile` → `scripts/db/import-plane/0065-auto-20240415-0937.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1328).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1330" name="pd-1330"></a> **PD-1330** [`user_favorite_migration`, dòng 48](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0065_auto_20240415_0937.py#L48) → `userFavoriteMigration` → `scripts/db/import-plane/0065-auto-20240415-0937.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1329).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). Lưu ý: Tên bảng favorite cũ chưa đối chiếu được vì repo Plane hiện tại đã bỏ model này. <!-- handoff-status -->

## `apps/api/plane/db/migrations/0067_issue_estimate.py`

- [x] <a id="pd-1331" name="pd-1331"></a> **PD-1331** [`issue_estimate_point`, dòng 11](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0067_issue_estimate.py#L11) → `issueEstimatePoint` → `scripts/db/import-plane/0067-issue-estimate.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1330).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-history.ts`](../../scripts/plane-import/transforms-history.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1332" name="pd-1332"></a> **PD-1332** [`last_used_estimate`, dòng 67](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0067_issue_estimate.py#L67) → `lastUsedEstimate` → `scripts/db/import-plane/0067-issue-estimate.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận estimate đã gán project có `last_used`, giữ nguyên bản ghi chưa gán. [Mã Lancity](../../scripts/db/import-plane/normalize-planning.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1333" name="pd-1333"></a> **PD-1333** [`populate_deploy_board`, dòng 80](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0067_issue_estimate.py#L80) → `populateDeployBoard` → `scripts/db/import-plane/0067-issue-estimate.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1332).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0068_remove_pagelabel_project_remove_pagelog_project_and_more.py`

- [x] <a id="pd-1334" name="pd-1334"></a> **PD-1334** [`migrate_pages`, dòng 9](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0068_remove_pagelabel_project_remove_pagelog_project_and_more.py#L9) → `migratePages` → `scripts/db/import-plane/0068-remove-pagelabel-project-remove-pagelog-project-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1333).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0069_alter_account_provider_and_more.py`

- [x] <a id="pd-1335" name="pd-1335"></a> **PD-1335** [`populate_views_owned_by`, dòng 9](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0069_alter_account_provider_and_more.py#L9) → `populateViewsOwnedBy` → `scripts/db/import-plane/0069-alter-account-provider-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1334).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0076_alter_projectmember_role_and_more.py`

- [x] <a id="pd-1336" name="pd-1336"></a> **PD-1336** [`update_workspace_project_member_role`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0076_alter_projectmember_role_and_more.py#L6) → `updateWorkspaceProjectMemberRole` → `scripts/db/import-plane/0076-alter-projectmember-role-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1335).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). Lưu ý: Xung đột tài liệu: README ghi 10 → 15 nhưng migration gốc 0076 đổi 10 → 5. Hàm theo source (5). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0077_draftissue_cycle_user_timezone_project_user_timezone_and_more.py`

- [x] <a id="pd-1337" name="pd-1337"></a> **PD-1337** [`migrate_draft_issues`, dòng 10](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0077_draftissue_cycle_user_timezone_project_user_timezone_and_more.py#L10) → `migrateDraftIssues` → `scripts/db/import-plane/0077-draftissue-cycle-user-timezone-project-user-timezone-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1336).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0079_auto_20241009_0619.py`

- [x] <a id="pd-1338" name="pd-1338"></a> **PD-1338** [`move_attachment_to_fileasset`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0079_auto_20241009_0619.py#L6) → `moveAttachmentToFileasset` → `scripts/db/import-plane/0079-auto-20241009-0619.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1337).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). Lưu ý: Công cụ không sao chép byte S3 → R2, chỉ ghi `asset-copies.json`. <!-- handoff-status -->
- [x] <a id="pd-1339" name="pd-1339"></a> **PD-1339** [`mark_existing_file_uploads`, dòng 43](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0079_auto_20241009_0619.py#L43) → `markExistingFileUploads` → `scripts/db/import-plane/0079-auto-20241009-0619.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1338).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). Lưu ý: Công cụ không sao chép byte S3 → R2, chỉ ghi `asset-copies.json`. <!-- handoff-status -->

## `apps/api/plane/db/migrations/0094_auto_20250425_0902.py`

- [x] <a id="pd-1340" name="pd-1340"></a> **PD-1340** [`set_default_source_type`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0094_auto_20250425_0902.py#L6) → `setDefaultSourceType` → `scripts/db/import-plane/0094-auto-20250425-0902.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture kiểm tra `In-App` đổi sang `IN_APP`, giữ source khác và rollback nếu ghi thất bại. [Mã Lancity](../../scripts/db/import-plane/normalize-planning.ts) · [Kiểm thử](../../tests/migrations.test.mjs).

## `apps/api/plane/db/migrations/0106_auto_20250912_0845.py`

- [x] <a id="pd-1341" name="pd-1341"></a> **PD-1341** [`set_page_sort_order`, dòng 8](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0106_auto_20250912_0845.py#L8) → `setPageSortOrder` → `scripts/db/import-plane/0106-auto-20250912-0845.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận thứ tự theo tên tăng từng bước 100, gồm page xóa mềm và phá hòa theo ID. [Mã Lancity](../../scripts/db/import-plane/page-sort-order.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1342" name="pd-1342"></a> **PD-1342** [`reverse_set_page_sort_order`, dòng 36](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0106_auto_20250912_0845.py#L36) → `reverseSetPageSortOrder` → `scripts/db/import-plane/0106-auto-20250912-0845.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture chạy reverse và xác nhận mọi page trở về `65535`. [Mã Lancity](../../scripts/db/import-plane/page-sort-order.ts) · [Kiểm thử](../../tests/migrations.test.mjs).

## `apps/api/plane/db/migrations/0107_migrate_filters_to_rich_filters.py`

- [x] <a id="pd-1343" name="pd-1343"></a> **PD-1343** [`migrate_filters_to_rich_filters`, dòng 20](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0107_migrate_filters_to_rich_filters.py#L20) → `migrateFiltersToRichFilters` → `scripts/db/import-plane/0107-migrate-filters-to-rich-filters.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1342) · Liên kết gọi [PD-1785](./01-platform.md#pd-1785), [PD-1817](./01-platform.md#pd-1817).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1344" name="pd-1344"></a> **PD-1344** [`reverse_migrate_rich_filters_to_filters`, dòng 42](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0107_migrate_filters_to_rich_filters.py#L42) → `reverseMigrateRichFiltersToFilters` → `scripts/db/import-plane/0107-migrate-filters-to-rich-filters.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1343) · Liên kết gọi [PD-1818](./01-platform.md#pd-1818).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-content.ts`](../../scripts/plane-import/transforms-content.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0112_auto_20251124_0603.py`

- [x] <a id="pd-1345" name="pd-1345"></a> **PD-1345** [`create_triage_state`, dòng 12](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0112_auto_20251124_0603.py#L12) → `createTriageState` → `scripts/db/import-plane/0112-auto-20251124-0603.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1344).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-history.ts`](../../scripts/plane-import/transforms-history.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0113_webhook_version.py`

- [x] <a id="pd-1346" name="pd-1346"></a> **PD-1346** [`set_default_product_tour_to_false`, dòng 7](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0113_webhook_version.py#L7) → `setDefaultProductTourToFalse` → `scripts/db/import-plane/0113-webhook-version.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1345).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1347" name="pd-1347"></a> **PD-1347** [`get_default_product_tour`, dòng 16](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0113_webhook_version.py#L16) → `getDefaultProductTour` → `scripts/db/import-plane/0113-webhook-version.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1346).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1348" name="pd-1348"></a> **PD-1348** [`populate_product_tour`, dòng 26](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0113_webhook_version.py#L26) → `populateProductTour` → `scripts/db/import-plane/0113-webhook-version.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1347) · Liên kết gọi [PD-1347](./16-migrations.md#pd-1347).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->

## `apps/api/plane/db/migrations/0115_auto_20260105_1406.py`

- [x] <a id="pd-1349" name="pd-1349"></a> **PD-1349** [`move_issue_user_properties_to_project_user_properties`, dòng 5](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0115_auto_20260105_1406.py#L5) → `moveIssueUserPropertiesToProjectUserProperties` → `scripts/db/import-plane/0115-auto-20260105-1406.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1348).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-props.ts`](../../scripts/plane-import/transforms-props.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). <!-- handoff-status -->
- [x] <a id="pd-1350" name="pd-1350"></a> **PD-1350** [`migrate_existing_api_tokens`, dòng 31](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0115_auto_20260105_1406.py#L31) → `migrateExistingApiTokens` → `scripts/db/import-plane/0115-auto-20260105-1406.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chỉ chuyển phép biến đổi dữ liệu nếu có bản ghi Plane cũ cần nhập. Đối chiếu UUID → ID số, ràng buộc D1 và version nguồn. [Đồ thị](../plane-demo-backend.html#f1349).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`transforms-accounts.ts`](../../scripts/plane-import/transforms-accounts.ts) · Kiểm thử: [`p4-migrations.test.mjs`](../../tests/p4-migrations.test.mjs) · Nguồn: [p4-migrations](./handoff/p4-migrations.md). Lưu ý: Importer bỏ qua `api_tokens` mặc định; chỉ nhập khi có `--include-api-tokens` và ở trạng thái không hoạt động. <!-- handoff-status -->

## `apps/api/plane/db/migrations/0118_remove_workspaceuserproperties_product_tour_and_more.py`

- [x] <a id="pd-1351" name="pd-1351"></a> **PD-1351** [`set_getting_started_checklist`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0118_remove_workspaceuserproperties_product_tour_and_more.py#L6) → `setGettingStartedChecklist` → `scripts/db/import-plane/0118-remove-workspaceuserproperties-product-tour-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture đối chiếu đầy đủ các khóa getting-started khi backfill. [Mã Lancity](../../scripts/db/import-plane/complete-legacy-tour.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1352" name="pd-1352"></a> **PD-1352** [`set_default_tips`, dòng 19](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0118_remove_workspaceuserproperties_product_tour_and_more.py#L19) → `setDefaultTips` → `scripts/db/import-plane/0118-remove-workspaceuserproperties-product-tour-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture đối chiếu cờ `mobile_app_download`. [Mã Lancity](../../scripts/db/import-plane/complete-legacy-tour.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1353" name="pd-1353"></a> **PD-1353** [`set_default_explored_features`, dòng 23](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0118_remove_workspaceuserproperties_product_tour_and_more.py#L23) → `setDefaultExploredFeatures` → `scripts/db/import-plane/0118-remove-workspaceuserproperties-product-tour-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture đối chiếu ba cờ explored features. [Mã Lancity](../../scripts/db/import-plane/complete-legacy-tour.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1354" name="pd-1354"></a> **PD-1354** [`set_default_product_tour`, dòng 27](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0118_remove_workspaceuserproperties_product_tour_and_more.py#L27) → `setDefaultProductTour` → `scripts/db/import-plane/0118-remove-workspaceuserproperties-product-tour-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture đối chiếu năm cờ product tour. [Mã Lancity](../../scripts/db/import-plane/complete-legacy-tour.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
- [x] <a id="pd-1355" name="pd-1355"></a> **PD-1355** [`migrate_all_the_product_tour_to_true`, dòng 37](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0118_remove_workspaceuserproperties_product_tour_and_more.py#L37) → `migrateAllTheProductTourToTrue` → `scripts/db/import-plane/0118-remove-workspaceuserproperties-product-tour-and-more.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận cập nhật hồ sơ và membership, giữ role và chạy lại an toàn. [Mã Lancity](../../scripts/db/import-plane/complete-legacy-tour.ts) · [Kiểm thử](../../tests/migrations.test.mjs).

## `apps/api/plane/db/migrations/0125_reset_project_deploy_board_identity.py`

- [x] <a id="pd-1356" name="pd-1356"></a> **PD-1356** [`reset_project_deploy_board_identity`, dòng 6](../../../cortex-town/plane-demo/apps/api/plane/db/migrations/0125_reset_project_deploy_board_identity.py#L6) → `resetProjectDeployBoardIdentity` → `scripts/db/import-plane/0125-reset-project-deploy-board-identity.ts` · **Tham chiếu** · Data migration · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Fixture xác nhận một anchor đang hoạt động cho mỗi project, xử lý board đã xóa mềm và giữ toàn vẹn khóa ngoại. [Mã Lancity](../../scripts/db/import-plane/0125-reset-project-deploy-board-identity.ts) · [Kiểm thử](../../tests/migrations.test.mjs).
