# Job bảo trì, seed và lệnh quản trị

[Về kế hoạch chuyển đổi](../plane-demo-porting.md) · [Danh mục endpoint](./endpoints.md)

**Đợt Khi cần** · **87 function gốc** · **0 adapter kế thừa**.

Đánh dấu riêng từng mục sau khi đã chuyển hoặc xác nhận chức năng thay thế tương đương. Nếu chốt ngoài phạm vi, giữ ô trống và ghi quyết định cạnh mục. Đường dẫn sau mũi tên là nơi dự kiến ở Lancity.

Các mục theo nhu cầu hoặc tham chiếu cần quyết định phạm vi trước khi phát triển.

## Vận hành trên Lancity

- Bootstrap instance admin từ tài khoản Better Auth đã xác minh trên D1 local bằng script dùng Node SQLite. Kiểm thử tạo lần đầu, từ chối email chưa xác minh và chạy lại. [Script](../../scripts/plane/create-instance-admin.ts) · [Kiểm thử](../../tests/migrations.test.mjs)
- Tạo và cập nhật schema bằng Drizzle Kit, áp dụng qua CLI Cloudflare D1. Các lệnh Django kiểm tra trạng thái kết nối và migration là tài liệu đối chiếu cho quy trình này. [README](../../README.md)
- Đặt lại mật khẩu và thu hồi phiên đi qua Better Auth. Việc tự động kích hoạt hoặc sửa tài khoản cũ cần quy trình xác minh người dùng.
- Quản lý bucket theo binding R2. Dọn object mồ côi, bản ghi đã xóa mềm và tác vụ bảo trì định kỳ cần job riêng để kiểm tra tham chiếu trước khi xóa.

## `apps/api/plane/bgtasks/cleanup_task.py`

- [x] <a id="pd-1085" name="pd-1085"></a> **PD-1085** [`process_cleanup_task`, dòng 34](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L34) → `processCleanupTask` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1084) · Liên kết gọi [PD-1086](./15-maintenance.md#pd-1086).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1086" name="pd-1086"></a> **PD-1086** [`process_cleanup_task.flush`, dòng 53](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L53) → `flush trong processCleanupTask` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Callback / hàm lồng · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chuyển cùng PD-1085, giữ thứ tự chạy và ngữ cảnh mà hàm cha truyền xuống. [Đồ thị](../plane-demo-backend.html#f1085) · Liên kết gọi [PD-1731](./01-platform.md#pd-1731).
      <br>**Đã chuyển, có test nhóm** (Gộp) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1087" name="pd-1087"></a> **PD-1087** [`get_api_logs_queryset`, dòng 85](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L85) → `getApiLogsQueryset` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1086).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1088" name="pd-1088"></a> **PD-1088** [`get_email_logs_queryset`, dòng 96](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L96) → `getEmailLogsQueryset` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1087).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1089" name="pd-1089"></a> **PD-1089** [`get_page_versions_queryset`, dòng 107](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L107) → `getPageVersionsQueryset` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1088).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1090" name="pd-1090"></a> **PD-1090** [`get_issue_description_versions_queryset`, dòng 128](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L128) → `getIssueDescriptionVersionsQueryset` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1089).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1091" name="pd-1091"></a> **PD-1091** [`get_webhook_logs_queryset`, dòng 149](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L149) → `getWebhookLogsQueryset` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1090).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1092" name="pd-1092"></a> **PD-1092** [`delete_api_logs`, dòng 162](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L162) → `deleteApiLogs` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1091) · Liên kết gọi [PD-1085](./15-maintenance.md#pd-1085), [PD-1087](./15-maintenance.md#pd-1087).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1093" name="pd-1093"></a> **PD-1093** [`delete_email_notification_logs`, dòng 172](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L172) → `deleteEmailNotificationLogs` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1092) · Liên kết gọi [PD-1085](./15-maintenance.md#pd-1085), [PD-1088](./15-maintenance.md#pd-1088).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1094" name="pd-1094"></a> **PD-1094** [`delete_page_versions`, dòng 182](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L182) → `deletePageVersions` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1093) · Liên kết gọi [PD-1085](./15-maintenance.md#pd-1085), [PD-1089](./15-maintenance.md#pd-1089).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1095" name="pd-1095"></a> **PD-1095** [`delete_issue_description_versions`, dòng 192](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L192) → `deleteIssueDescriptionVersions` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1094) · Liên kết gọi [PD-1085](./15-maintenance.md#pd-1085), [PD-1090](./15-maintenance.md#pd-1090).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1096" name="pd-1096"></a> **PD-1096** [`delete_webhook_logs`, dòng 202](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/cleanup_task.py#L202) → `deleteWebhookLogs` → `src/server/maintenance/jobs/cleanup.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1095) · Liên kết gọi [PD-1085](./15-maintenance.md#pd-1085), [PD-1091](./15-maintenance.md#pd-1091).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cleanup.ts`](../../src/server/maintenance/cleanup.ts), [`jobs.ts`](../../src/server/maintenance/jobs.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/bgtasks/deletion_task.py`

- [x] <a id="pd-1104" name="pd-1104"></a> **PD-1104** [`soft_delete_related_objects`, dòng 18](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/deletion_task.py#L18) → `softDeleteRelatedObjects` → `src/server/maintenance/jobs/deletion.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1103).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cascade.ts`](../../src/server/maintenance/cascade.ts), [`deletion.ts`](../../src/server/maintenance/deletion.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1105" name="pd-1105"></a> **PD-1105** [`restore_related_objects`, dòng 109](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/deletion_task.py#L109) → `restoreRelatedObjects` → `src/server/maintenance/jobs/deletion.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1104).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cascade.ts`](../../src/server/maintenance/cascade.ts), [`deletion.ts`](../../src/server/maintenance/deletion.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1106" name="pd-1106"></a> **PD-1106** [`hard_delete`, dòng 114](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/deletion_task.py#L114) → `hardDelete` → `src/server/maintenance/jobs/deletion.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1105).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`cascade.ts`](../../src/server/maintenance/cascade.ts), [`deletion.ts`](../../src/server/maintenance/deletion.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/bgtasks/dummy_data_task.py`

- [x] <a id="pd-1107" name="pd-1107"></a> **PD-1107** [`create_project`, dòng 44](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L44) → `createProject` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1106) · Liên kết gọi [PD-1471](./04-project.md#pd-1471), [PD-1474](./04-project.md#pd-1474).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1108" name="pd-1108"></a> **PD-1108** [`create_project_members`, dòng 63](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L63) → `createProjectMembers` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1107).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1109" name="pd-1109"></a> **PD-1109** [`create_states`, dòng 82](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L82) → `createStates` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1108).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1110" name="pd-1110"></a> **PD-1110** [`create_labels`, dòng 126](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L126) → `createLabels` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1109).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1111" name="pd-1111"></a> **PD-1111** [`create_cycles`, dòng 146](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L146) → `createCycles` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1110).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1112" name="pd-1112"></a> **PD-1112** [`create_modules`, dòng 191](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L191) → `createModules` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1111).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1113" name="pd-1113"></a> **PD-1113** [`create_pages`, dòng 221](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L221) → `createPages` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1112).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1114" name="pd-1114"></a> **PD-1114** [`create_page_labels`, dòng 249](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L249) → `createPageLabels` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1113).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1115" name="pd-1115"></a> **PD-1115** [`create_issues`, dòng 267](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L267) → `createIssues` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1114) · Liên kết gọi [PD-1360](./01-platform.md#pd-1360).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1116" name="pd-1116"></a> **PD-1116** [`create_intake_issues`, dòng 358](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L358) → `createIntakeIssues` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1115) · Liên kết gọi [PD-1115](./15-maintenance.md#pd-1115), [PD-1472](./04-project.md#pd-1472), [PD-1360](./01-platform.md#pd-1360).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1117" name="pd-1117"></a> **PD-1117** [`create_issue_parent`, dòng 378](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L378) → `createIssueParent` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1116).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1118" name="pd-1118"></a> **PD-1118** [`create_issue_assignees`, dòng 391](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L391) → `createIssueAssignees` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1117).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1119" name="pd-1119"></a> **PD-1119** [`create_issue_labels`, dòng 416](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L416) → `createIssueLabels` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1118).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1120" name="pd-1120"></a> **PD-1120** [`create_cycle_issues`, dòng 439](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L439) → `createCycleIssues` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1119).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1121" name="pd-1121"></a> **PD-1121** [`create_module_issues`, dòng 457](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L457) → `createModuleIssues` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1120).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`dummy-data.ts`](../../src/server/maintenance/dummy-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1122" name="pd-1122"></a> **PD-1122** [`create_dummy_data`, dòng 488](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/dummy_data_task.py#L488) → `createDummyData` → `src/server/maintenance/jobs/dummy-data.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1121) · Liên kết gọi [PD-1107](./15-maintenance.md#pd-1107), [PD-1108](./15-maintenance.md#pd-1108), [PD-1109](./15-maintenance.md#pd-1109) và 12 trong [đồ thị](../plane-demo-backend.html#f1121).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`p4-maintenance-schema.ts`](../../src/types/instance/p4-maintenance-schema.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/bgtasks/logger_task.py`

- [x] <a id="pd-1198" name="pd-1198"></a> **PD-1198** [`log_to_postgres`, dòng 20](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/logger_task.py#L20) → `logToPostgres` → `src/server/maintenance/jobs/logger.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1197) · Liên kết gọi [PD-1377](./01-platform.md#pd-1377), [PD-1731](./01-platform.md#pd-1731).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`logger.ts`](../../src/server/maintenance/logger.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1199" name="pd-1199"></a> **PD-1199** [`process_logs`, dòng 33](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/logger_task.py#L33) → `processLogs` → `src/server/maintenance/jobs/logger.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1198) · Liên kết gọi [PD-1198](./15-maintenance.md#pd-1198).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`logger.ts`](../../src/server/maintenance/logger.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/bgtasks/workspace_seed_task.py`

- [x] <a id="pd-1238" name="pd-1238"></a> **PD-1238** [`read_seed_file`, dòng 50](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L50) → `readSeedFile` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1237).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1239" name="pd-1239"></a> **PD-1239** [`create_project_and_member`, dòng 72](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L72) → `createProjectAndMember` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1238) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1467](./04-project.md#pd-1467), [PD-1471](./04-project.md#pd-1471).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`seed.ts`](../../src/server/workspace/seed.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1240" name="pd-1240"></a> **PD-1240** [`create_project_states`, dòng 177](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L177) → `createProjectStates` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1239) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1489](./05-issue.md#pd-1489).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1241" name="pd-1241"></a> **PD-1241** [`create_project_labels`, dòng 212](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L212) → `createProjectLabels` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1240) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1443](./05-issue.md#pd-1443).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1242" name="pd-1242"></a> **PD-1242** [`create_project_issues`, dòng 246](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L246) → `createProjectIssues` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1241) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1360](./01-platform.md#pd-1360), [PD-1418](./05-issue.md#pd-1418) và 1 trong [đồ thị](../plane-demo-backend.html#f1241).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1243" name="pd-1243"></a> **PD-1243** [`create_pages`, dòng 346](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L346) → `createPages` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1242) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1459](./08-content.md#pd-1459), [PD-1377](./01-platform.md#pd-1377).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1244" name="pd-1244"></a> **PD-1244** [`create_cycles`, dòng 392](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L392) → `createCycles` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1243) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1382](./07-planning.md#pd-1382).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1245" name="pd-1245"></a> **PD-1245** [`create_modules`, dòng 443](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L443) → `createModules` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1244) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1448](./07-planning.md#pd-1448).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1246" name="pd-1246"></a> **PD-1246** [`create_views`, dòng 478](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L478) → `createViews` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1245) · Liên kết gọi [PD-1238](./15-maintenance.md#pd-1238), [PD-1505](./10-reporting.md#pd-1505).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1247" name="pd-1247"></a> **PD-1247** [`workspace_seed`, dòng 505](../../../cortex-town/plane-demo/apps/api/plane/bgtasks/workspace_seed_task.py#L505) → `workspaceSeed` → `src/server/maintenance/jobs/workspace-seed.ts` · **Theo nhu cầu** · Job định kỳ / bảo trì
      <br>Chốt lịch chạy, giới hạn batch và điều kiện giữ/xóa dữ liệu trước khi bật. [Đồ thị](../plane-demo-backend.html#f1246) · Liên kết gọi [PD-1499](./02-auth.md#pd-1499), [PD-1501](./02-auth.md#pd-1501), [PD-1377](./01-platform.md#pd-1377) và 8 trong [đồ thị](../plane-demo-backend.html#f1246).
      <br>**Đã chuyển, có test nhóm** · Mã Lancity: [`workspace-seed.ts`](../../src/server/maintenance/workspace-seed.ts), [`seed-data.ts`](../../src/server/maintenance/seed-data.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/activate_user.py`

- [x] <a id="pd-1251" name="pd-1251"></a> **PD-1251** [`Command.add_arguments`, dòng 15](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/activate_user.py#L15) → `addArgumentsCommand` → `scripts/plane/activate-user.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1250).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1252" name="pd-1252"></a> **PD-1252** [`Command.handle`, dòng 19](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/activate_user.py#L19) → `handleCommand` → `scripts/plane/activate-user.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1251) · Liên kết gọi [PD-1499](./02-auth.md#pd-1499), [PD-1501](./02-auth.md#pd-1501).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/clear_cache.py`

- [x] <a id="pd-1253" name="pd-1253"></a> **PD-1253** [`Command.add_arguments`, dòng 13](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/clear_cache.py#L13) → `addArgumentsCommand` → `scripts/plane/clear-cache.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1252).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1254" name="pd-1254"></a> **PD-1254** [`Command.handle`, dòng 17](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/clear_cache.py#L17) → `handleCommand` → `scripts/plane/clear-cache.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1253).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/copy_issue_comment_to_description.py`

- [x] <a id="pd-1255" name="pd-1255"></a> **PD-1255** [`Command.handle`, dòng 17](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/copy_issue_comment_to_description.py#L17) → `handleCommand` → `scripts/plane/copy-issue-comment-to-description.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1254).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/create_bucket.py`

- [ ] <a id="pd-1256" name="pd-1256"></a> **PD-1256** [`Command.handle`, dòng 17](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/create_bucket.py#L17) → `handleCommand` → `scripts/plane/create-bucket.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1255).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->

## `apps/api/plane/db/management/commands/create_dummy_data.py`

- [x] <a id="pd-1257" name="pd-1257"></a> **PD-1257** [`Command.handle`, dòng 16](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/create_dummy_data.py#L16) → `handleCommand` → `scripts/plane/create-dummy-data.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1256) · Liên kết gọi [PD-1377](./01-platform.md#pd-1377), [PD-1122](./15-maintenance.md#pd-1122).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/create_instance_admin.py`

- [x] <a id="pd-1258" name="pd-1258"></a> **PD-1258** [`Command.add_arguments`, dòng 16](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/create_instance_admin.py#L16) → `addArgumentsCommand` → `scripts/plane/create-instance-admin.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1257).
      <br>**Đã chuyển, có test nhóm** (Có sẵn) · Mã Lancity: [`create-instance-admin.ts`](../../scripts/plane/create-instance-admin.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1259" name="pd-1259"></a> **PD-1259** [`Command.handle`, dòng 20](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/create_instance_admin.py#L20) → `handleCommand` → `scripts/plane/create-instance-admin.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1258).
      <br>**Đã chuyển, có test nhóm** (Có sẵn) · Mã Lancity: [`create-instance-admin.ts`](../../scripts/plane/create-instance-admin.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/create_project_member.py`

- [x] <a id="pd-1260" name="pd-1260"></a> **PD-1260** [`Command.add_arguments`, dòng 22](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/create_project_member.py#L22) → `addArgumentsCommand` → `scripts/plane/create-project-member.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1259).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1261" name="pd-1261"></a> **PD-1261** [`Command.handle`, dòng 28](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/create_project_member.py#L28) → `handleCommand` → `scripts/plane/create-project-member.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1260) · Liên kết gọi [PD-1474](./04-project.md#pd-1474), [PD-1472](./04-project.md#pd-1472).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/fix_duplicate_sequences.py`

- [x] <a id="pd-1262" name="pd-1262"></a> **PD-1262** [`Command.add_arguments`, dòng 18](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/fix_duplicate_sequences.py#L18) → `addArgumentsCommand` → `scripts/plane/fix-duplicate-sequences.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1261).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1263" name="pd-1263"></a> **PD-1263** [`Command.strict_str_to_int`, dòng 22](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/fix_duplicate_sequences.py#L22) → `strictStrToIntCommand` → `scripts/plane/fix-duplicate-sequences.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1262).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1264" name="pd-1264"></a> **PD-1264** [`Command.handle`, dòng 27](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/fix_duplicate_sequences.py#L27) → `handleCommand` → `scripts/plane/fix-duplicate-sequences.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1263) · Liên kết gọi [PD-1263](./15-maintenance.md#pd-1263), [PD-2040](./01-platform.md#pd-2040).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/makemigrations.py`

- [ ] <a id="pd-1265" name="pd-1265"></a> **PD-1265** [`render`, dòng 25](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L25) → `render` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1264).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1266" name="pd-1266"></a> **PD-1266** [`parse`, dòng 31](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L31) → `parse` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1265).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1267" name="pd-1267"></a> **PD-1267** [`mismatches`, dòng 35](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L35) → `mismatches` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1266).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1268" name="pd-1268"></a> **PD-1268** [`plane_leaves`, dòng 43](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L43) → `planeLeaves` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1267).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1269" name="pd-1269"></a> **PD-1269** [`Command.add_arguments`, dòng 57](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L57) → `addArgumentsCommand` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1268).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1270" name="pd-1270"></a> **PD-1270** [`Command.handle`, dòng 65](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L65) → `handleCommand` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1269) · Liên kết gọi [PD-1268](./15-maintenance.md#pd-1268), [PD-1271](./15-maintenance.md#pd-1271), [PD-1265](./15-maintenance.md#pd-1265).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1271" name="pd-1271"></a> **PD-1271** [`Command.check_lockfile`, dòng 73](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/makemigrations.py#L73) → `checkLockfileCommand` → `scripts/plane/makemigrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1270) · Liên kết gọi [PD-1266](./15-maintenance.md#pd-1266), [PD-1267](./15-maintenance.md#pd-1267).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->

## `apps/api/plane/db/management/commands/reactivate_workspace_member.py`

- [x] <a id="pd-1272" name="pd-1272"></a> **PD-1272** [`Command.add_arguments`, dòng 15](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/reactivate_workspace_member.py#L15) → `addArgumentsCommand` → `scripts/plane/reactivate-workspace-member.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1271).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1273" name="pd-1273"></a> **PD-1273** [`Command.handle`, dòng 20](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/reactivate_workspace_member.py#L20) → `handleCommand` → `scripts/plane/reactivate-workspace-member.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1272) · Liên kết gọi [PD-1377](./01-platform.md#pd-1377).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/reset_password.py`

- [x] <a id="pd-1274" name="pd-1274"></a> **PD-1274** [`Command.add_arguments`, dòng 19](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/reset_password.py#L19) → `addArgumentsCommand` → `scripts/plane/reset-password.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1273).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1275" name="pd-1275"></a> **PD-1275** [`Command.handle`, dòng 23](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/reset_password.py#L23) → `handleCommand` → `scripts/plane/reset-password.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1274) · Liên kết gọi [PD-1030](./02-auth.md#pd-1030), [PD-1499](./02-auth.md#pd-1499), [PD-1501](./02-auth.md#pd-1501).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/sync_issue_description_version.py`

- [x] <a id="pd-1276" name="pd-1276"></a> **PD-1276** [`Command.handle`, dòng 17](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/sync_issue_description_version.py#L17) → `handleCommand` → `scripts/plane/sync-issue-description-version.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1275) · Liên kết gọi [PD-1184](./06-issue-background.md#pd-1184).
      <br>**Đã chuyển, có test nhóm** (Thay thế) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/sync_issue_version.py`

- [x] <a id="pd-1277" name="pd-1277"></a> **PD-1277** [`Command.handle`, dòng 15](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/sync_issue_version.py#L15) → `handleCommand` → `scripts/plane/sync-issue-version.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1276) · Liên kết gọi [PD-1197](./06-issue-background.md#pd-1197).
      <br>**Đã chuyển, có test nhóm** (Thay thế) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/test_email.py`

- [x] <a id="pd-1278" name="pd-1278"></a> **PD-1278** [`Command.add_arguments`, dòng 17](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/test_email.py#L17) → `addArgumentsCommand` → `scripts/plane/test-email.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1277).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1279" name="pd-1279"></a> **PD-1279** [`Command.handle`, dòng 21](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/test_email.py#L21) → `handleCommand` → `scripts/plane/test-email.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1278) · Liên kết gọi [PD-1587](./13-instance.md#pd-1587), [PD-1730](./09-notification.md#pd-1730).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/update_bucket.py`

- [ ] <a id="pd-1280" name="pd-1280"></a> **PD-1280** [`Command.get_s3_client`, dòng 18](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_bucket.py#L18) → `getS3ClientCommand` → `scripts/plane/update-bucket.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1279).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1281" name="pd-1281"></a> **PD-1281** [`Command.check_s3_permissions`, dòng 30](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_bucket.py#L30) → `checkS3PermissionsCommand` → `scripts/plane/update-bucket.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1280) · Liên kết gọi [PD-1280](./15-maintenance.md#pd-1280).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1282" name="pd-1282"></a> **PD-1282** [`Command.generate_bucket_policy`, dòng 102](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_bucket.py#L102) → `generateBucketPolicyCommand` → `scripts/plane/update-bucket.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1281) · Liên kết gọi [PD-1280](./15-maintenance.md#pd-1280).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1283" name="pd-1283"></a> **PD-1283** [`Command.make_objects_public`, dòng 123](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_bucket.py#L123) → `makeObjectsPublicCommand` → `scripts/plane/update-bucket.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1282) · Liên kết gọi [PD-1280](./15-maintenance.md#pd-1280), [PD-1282](./15-maintenance.md#pd-1282).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1284" name="pd-1284"></a> **PD-1284** [`Command.handle`, dòng 134](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_bucket.py#L134) → `handleCommand` → `scripts/plane/update-bucket.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1283) · Liên kết gọi [PD-1280](./15-maintenance.md#pd-1280), [PD-1281](./15-maintenance.md#pd-1281), [PD-1283](./15-maintenance.md#pd-1283) và 1 trong [đồ thị](../plane-demo-backend.html#f1283).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->

## `apps/api/plane/db/management/commands/update_deleted_workspace_slug.py`

- [x] <a id="pd-1285" name="pd-1285"></a> **PD-1285** [`Command.add_arguments`, dòng 13](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_deleted_workspace_slug.py#L13) → `addArgumentsCommand` → `scripts/plane/update-deleted-workspace-slug.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1284).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1286" name="pd-1286"></a> **PD-1286** [`Command.handle`, dòng 25](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/update_deleted_workspace_slug.py#L25) → `handleCommand` → `scripts/plane/update-deleted-workspace-slug.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1285) · Liên kết gọi [PD-1377](./01-platform.md#pd-1377).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/db/management/commands/wait_for_db.py`

- [ ] <a id="pd-1287" name="pd-1287"></a> **PD-1287** [`Command.handle`, dòng 14](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/wait_for_db.py#L14) → `handleCommand` → `scripts/plane/wait-for-db.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1286).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->

## `apps/api/plane/db/management/commands/wait_for_migrations.py`

- [ ] <a id="pd-1288" name="pd-1288"></a> **PD-1288** [`Command.handle`, dòng 15](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/wait_for_migrations.py#L15) → `handleCommand` → `scripts/plane/wait-for-migrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1287) · Liên kết gọi [PD-1289](./15-maintenance.md#pd-1289).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->
- [ ] <a id="pd-1289" name="pd-1289"></a> **PD-1289** [`Command._pending_migrations`, dòng 22](../../../cortex-town/plane-demo/apps/api/plane/db/management/commands/wait_for_migrations.py#L22) → `pendingMigrationsCommand` → `scripts/plane/wait-for-migrations.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1288).
      <br>**Ngoài phạm vi** theo [p4-maintenance](./handoff/p4-maintenance.md), giữ ô trống. Ngoài phạm vi <!-- handoff-status -->

## `apps/api/plane/license/management/commands/configure_instance.py`

- [x] <a id="pd-1578" name="pd-1578"></a> **PD-1578** [`Command.handle`, dòng 19](../../../cortex-town/plane-demo/apps/api/plane/license/management/commands/configure_instance.py#L19) → `handleCommand` → `scripts/plane/configure-instance.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1577) · Liên kết gọi [PD-1584](./13-instance.md#pd-1584).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->

## `apps/api/plane/license/management/commands/register_instance.py`

- [x] <a id="pd-1579" name="pd-1579"></a> **PD-1579** [`Command.add_arguments`, dòng 24](../../../cortex-town/plane-demo/apps/api/plane/license/management/commands/register_instance.py#L24) → `addArgumentsCommand` → `scripts/plane/register-instance.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1578).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1580" name="pd-1580"></a> **PD-1580** [`Command.check_for_current_version`, dòng 28](../../../cortex-town/plane-demo/apps/api/plane/license/management/commands/register_instance.py#L28) → `checkForCurrentVersionCommand` → `scripts/plane/register-instance.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1579).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1581" name="pd-1581"></a> **PD-1581** [`Command.check_for_latest_version`, dòng 40](../../../cortex-town/plane-demo/apps/api/plane/license/management/commands/register_instance.py#L40) → `checkForLatestVersionCommand` → `scripts/plane/register-instance.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1580).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
- [x] <a id="pd-1582" name="pd-1582"></a> **PD-1582** [`Command.handle`, dòng 53](../../../cortex-town/plane-demo/apps/api/plane/license/management/commands/register_instance.py#L53) → `handleCommand` → `scripts/plane/register-instance.ts` · **Theo nhu cầu** · CLI / seed · Chưa nối từ endpoint trong đồ thị tĩnh
      <br>Đối chiếu cách chạy độc lập và phạm vi dữ liệu. CLI quản trị chạy với quyền vận hành, seed dùng dữ liệu mẫu. [Đồ thị](../plane-demo-backend.html#f1581) · Liên kết gọi [PD-1580](./15-maintenance.md#pd-1580), [PD-1581](./15-maintenance.md#pd-1581), [PD-1577](./13-instance.md#pd-1577).
      <br>**Đã chuyển, có test nhóm** (Port) · Mã Lancity: [`ops.ts`](../../src/server/maintenance/ops.ts) · Kiểm thử: [`p4-maintenance.test.ts`](../../tests/p4-maintenance.test.ts) · Nguồn: [p4-maintenance](./handoff/p4-maintenance.md). <!-- handoff-status -->
