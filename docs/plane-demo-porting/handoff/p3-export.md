# Handoff p3-export

Phạm vi: xuất issue (CSV, JSON, XLSX) vào R2, link tải có hạn, job xóa file hết hạn, email báo xong, bảo vệ CSV injection, và nhập issue từ file (CSV, JSON, XLSX, file xuất của Plane). Nguồn Plane: `app/views/exporter/base.py`, `bgtasks/export_task.py`, `bgtasks/exporter_expired_task.py`, `db/models/exporter.py`, `db/models/importer.py`, `utils/csv_utils.py`, `utils/exporters/*`, `utils/porters/*`. Checklist: `docs/plane-demo-porting/10-reporting.md`.

Chưa chạy typecheck, build, test theo quy ước. ESLint sạch trên mọi file bên dưới.

## Thiết kế

- Không thêm dependency. ZIP và XLSX tự viết trên `CompressionStream('deflate-raw')` ([`zip.ts`](../../../src/server/export/zip.ts), [`xlsx.ts`](../../../src/server/export/xlsx.ts)), thay `zipfile` và `openpyxl`.
- Bảng `exporters` đã có trong `src/db/schema/integration.ts`, dùng lại (không thêm cột). Hạn link tính từ `created_at` (7 ngày, như presigned URL của Plane). Job cron xóa file sau 8 ngày.
- R2 không có presigned GET nếu không có khóa S3, nên `exporters.url` là đường dẫn tải có xác thực: `/api/v1/workspaces/:slug/export-issues/:id/download`. Chỉ người khởi tạo tải được, quá 7 ngày trả 410, sau 8 ngày file bị xóa. API danh sách trả `url: null` khi link hết hạn.
- Bảng mới `import_jobs` (Plane `importers` chỉ phục vụ importer GitHub/Jira đã bỏ).
- Import chạy theo chunk 40 dòng mỗi lần chạy job, job tự enqueue chunk kế tiếp (payload `{ importId, offset }`). Mỗi issue nhập có `external_source = import:<jobId>`, `external_id = <số dòng>`. Chunk chạy lại bỏ qua dòng đã tạo, nên idempotent.
- Import gọi `createIssue` của p1-issue-core với actor là người khởi tạo, nên quyền, sequence, activity, webhook giữ nguyên như tạo issue thường.

## (a) PD đã xong

Mã: [`src/server/export/`](../../../src/server/export), [`src/server/import/`](../../../src/server/import), route [`exports.ts`](../../../src/server/api/v1/routes/exports.ts) và [`imports.ts`](../../../src/server/api/v1/routes/imports.ts), Zod [`p3-export-schema.ts`](../../../src/types/reporting/p3-export-schema.ts), schema [`ext-p3-export.ts`](../../../src/db/schema/ext-p3-export.ts). Test: [`tests/p3-export.integration.mjs`](../../../tests/p3-export.integration.mjs) (export 3 định dạng, injection, quyền tải, import, báo lỗi dòng) và [`tests/p3-export.test.ts`](../../../tests/p3-export.test.ts) (đơn vị: formatter, ZIP, XLSX, ánh xạ dòng import).

Khác đường dẫn đích trong checklist: job nằm trong `jobs.ts` (không phải `jobs/export.ts`), `createZipFile` trong `zip.ts`, hàm job trong `tasks.ts`, `exportIssues` trong `service.ts`.

| PD | Kết quả | Code |
| --- | --- | --- |
| 0532 | Port `exportIssues`: quyền admin hoặc member của workspace, `provider` csv/json/xlsx (sai thì 400 `PROVIDER_NOT_FOUND`), không có `project` thì lấy mọi project đang là member và chưa archive, tạo dòng `exporters` (token ngẫu nhiên, `type = issue_exports`), enqueue `export.issues`. Thêm giới hạn 10 lần mỗi giờ mỗi người (p1 `checkRateLimit`) | service.ts |
| 0533, 0534 | Port `listExports`: chỉ export của chính người dùng, bắt buộc `per_page` và `cursor`, `order_by` qua allowlist `created_at`/`updated_at` (`sanitizeOrderBy`), phân trang `OffsetPaginator`. Callback `on_results` là `presentExporter` trong `fetch` | service.ts, presenters.ts |
| 1131 | Port `createZipFile` (thêm `readZip`) | zip.ts |
| 1132 | Thay thế `upload_to_s3` bằng `uploadToBucket`: ghi R2 qua `uploadFile` của p2-asset, key `<workspaceId>/export-<slug>-<token>-<ngày>.zip`, cập nhật `status`, `url`, `key`. Không presign | tasks.ts |
| 1133 | Port `issueExportTask`: bỏ qua export đã xong hoặc đã lỗi (idempotent), lọc issue theo quyền (guest chỉ thấy issue mình tạo khi project tắt `guest_view_all_features`, bỏ project archive, issue draft, archive, state triage, intake chưa duyệt), `multiple` tách file theo project, lỗi ghi `status = failed` và `reason`. Gửi email báo xong qua `sendMail` | tasks.ts, queries.ts |
| 1134 | Port `deleteOldS3Link`: xóa file R2 và đặt `url = null` cho export quá 8 ngày. Cron `30 1 * * *` (Plane liệt kê hai lần, 01:30 và 03:45; một lần là đủ) và job `export.expired` chạy tay được | tasks.ts, jobs.ts |
| 1398 | Port `generateToken` | model-rules.ts |
| 1399 | Port `formatExporterHistory` | presenters.ts |
| 1402 | Port `formatImporter` | import/presenters.ts |
| 1723, 1724 | Đã xong từ trước (đã tick). Mọi formatter đều gọi `sanitizeCsvRow` | csv-utils.ts |
| 1732-1735 | Port `Exporter` (`initExporter` là constructor, `export`, `exportRows` cho nhánh queryset, `getAvailableFormats`, `registerFormatter`) | exporter.ts |
| 1736-1747 | Port formatter theo schema: `CsvSchemaFormatter`, `JsonSchemaFormatter`, `XlsxSchemaFormatter`, `getFieldInfo` | formatters.ts |
| 1748-1762 | Port `ExportField` và các loại field (`stringField`, `dateField`, `dateTimeField`, `numberField`, `booleanField`, `listField`, `jsonField`), `resolveDottedPath`, `formatFieldValue`, `defineExportSchema` (thay metaclass), `ExportSchema.serialize`, `serializeRows` | base.ts |
| 1763-1784 | Port `getIssueAttachmentsDict`, `getIssueLastCyclesDict`, `issueExportSchema` với đủ `prepare_*` và `getContext` | issue.ts |
| 1980-1986 | Port `DataExporter` (serializer là hàm thay cho class DRF; `toFile` trả `File` vì Workers không có đĩa) | exporter.ts |
| 1987-2008 | Port `JsonFormatter`, `CsvFormatter` (flatten `a__b`, prettify, `decode` kèm `unflatten`), `XlsxFormatter` (`encode`, `decode`, `formatValue`) | formatters.ts, xlsx.ts |
| 2009-2019 | Port `IssueExportSerializer` thành `serializeIssueExport` và các `get*IssueExport` | presenters.ts |
| Import (không có PD) | `startImport`, `listImports`, `getImport`, `importIssuesTask`, ánh xạ cột (`name`/`title`, `description`, `priority`, `state`/`state_name`, `labels`, `assignees` theo email, username hoặc tên, `start_date`, `target_date`, `parent` dạng `IMP-4`), ngày ISO, ngày kiểu Plane (`Mon, 02 Feb 2026`) và số serial Excel | import/*.ts |

Khác Plane có chủ đích:
- `json.dumps` của Python mặc định thoát ký tự không ASCII. Ở đây giữ nguyên Unicode để tiếng Việt đọc được trong ô CSV/XLSX.
- `get_assignees` của Plane lọc `is_active` của user. Bảng `user` của Lancity không có cột này, nên mọi assignee đều được xuất.
- `sub_issues_count`, `link_count`, `attachment_count` của `IssueSerializer` là trường read-only cần annotation mà task không thêm, nên DRF bỏ chúng khỏi kết quả. Bản port cũng bỏ.
- Export giới hạn 50.000 issue (`MAX_EXPORT_ISSUES`) để file vừa bộ nhớ Worker. Quá giới hạn thì export `failed` với `reason` rõ ràng.
- Import giới hạn 10 MiB và 5.000 dòng, 10 lần mỗi giờ mỗi người. Nhãn không có sẵn bị bỏ qua kèm cảnh báo, không tự tạo.

## PD để trống hoặc ngoài phạm vi

- PD-0417, PD-1074 đến PD-1084 (`export-analytics`, `analytic_plot_export.py`): thuộc nhóm analytics, không nằm trong danh sách file của p3-export. Họ có thể dùng lại `sanitizeCsvRow`, `writeCsv` (formatters.ts) và `uploadToBucket`-kiểu ghi R2 + `sendMail`.
- Importer GitHub/Jira cũ của Plane (bảng `importers`): chỉ port `__str__` (PD-1402). Plane đã gỡ luồng import này.
- PDF: không thuộc các file Python của nhóm này.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

`exports.ts` giữ export tên `exportsRoutes` (đã mount ở `linkto.apiProject`, đường dẫn `/export`) và thêm export `default` (cũng là `workspaceExportsRoutes`). `imports.ts` export `default` (cũng là `importsRoutes`).

```ts
import workspaceExportsRoutes from '@/server/api/v1/routes/exports' // hoặc { workspaceExportsRoutes }
import importsRoutes from '@/server/api/v1/routes/imports'

app.route(linkto.apiWorkspace, workspaceExportsRoutes) // POST, GET /export-issues; GET /export-issues/:exportId/download
app.route(linkto.apiProject, importsRoutes)           // POST, GET /import-issues; GET /import-issues/:importId
```

Thứ tự mount không quan trọng. Cả hai router tự gắn `authenticate`. Tránh trùng tên import nếu đã import `{ exportsRoutes }` từ cùng file (dùng `{ exportsRoutes, workspaceExportsRoutes }`).

Endpoint:
- `POST /workspaces/:slug/export-issues` body `{ provider, project?: number[], multiple?: boolean }` trả `{ message, id }`.
- `GET /workspaces/:slug/export-issues?per_page=&cursor=&order_by=` trả danh sách phân trang của export của chính người dùng.
- `GET /workspaces/:slug/export-issues/:exportId/download` trả ZIP.
- `POST /workspaces/:slug/projects/:projectId/import-issues` multipart (`file`, `source` = `file` hoặc `plane`) trả 202 và bản ghi import.
- `GET /workspaces/:slug/projects/:projectId/import-issues` (phân trang) và `/import-issues/:importId` (kèm `errors`, mỗi mục `{ row, level, message }`).

## (c) Schema ext cần merge

File [`src/db/schema/ext-p3-export.ts`](../../../src/db/schema/ext-p3-export.ts): bảng `import_jobs` (khóa tổng hợp `(project_id, workspace_id)` tham chiếu `projects`). Thêm `export * from './schema/ext-p3-export'` vào `src/db/schema.ts`. Tên migration gợi ý: `pnpm db:generate --name reporting_import_jobs`. Không đổi bảng `exporters`.

## (d) Key linkto cần thêm

Không bắt buộc. Route dùng hằng số cục bộ (`/export-issues`, `/import-issues`) như `cycles.ts`. Nếu muốn gom: `apiV1Routes.exportIssues: '/export-issues'`, `exportIssueDownload: '/export-issues/:exportId/download'`, `importIssues: '/import-issues'`, `importIssue: '/import-issues/:importId'`. Đường dẫn tải lưu trong `exporters.url` được dựng ở `exportDownloadPath` (model-rules.ts) từ `linkto.apiV1`; đổi cả hai nơi nếu đổi đường dẫn.

## (e) Dependency, binding, env

- Dependency: không thêm.
- Binding: cần `ASSET_BUCKET` (R2, đã có) cho cả export và import. Không có binding thì export `failed` với lý do `Asset storage is not configured`, import trả 503. `JOBS_QUEUE` tùy chọn (không có thì job chạy ngay trong Worker).
- Env: `BETTER_AUTH_URL` dùng dựng link tuyệt đối trong email. `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `MAIL_FROM` như hạ tầng (thiếu thì bỏ qua email, export vẫn xong).
- Job mới tự đăng ký qua `import.meta.glob`: `export.issues`, `export.expired` (cron `30 1 * * *`), `import.issues`.
- Giới hạn Worker: job export giữ cả file trong bộ nhớ. Với export lớn (gần 50.000 issue) cân nhắc Workflows hoặc tăng giới hạn CPU của consumer. Mỗi chunk import khoảng 40 lần `createIssue`, mỗi lần cỡ vài chục lệnh D1; nếu gặp giới hạn subrequest, giảm `IMPORT_CHUNK` trong `import/tasks.ts`.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`. Chỗ dễ lỗi vì chưa chạy:
   - `zip.ts`: `writer.write(data as unknown as BufferSource)` và `CompressionStream` / `DecompressionStream` tùy bản lib (Workers types hay DOM).
   - `queries.ts`: truy vấn có `alias(issues, ...)` nhiều lần và `Promise.all` với 10 truy vấn Drizzle (suy luận kiểu dài); `byAsset` dùng type guard cho `issueId` nullable.
   - `formatters.ts`: `new File([content as BlobPart])` trong `exporter.ts` khi `content` là `Uint8Array<ArrayBufferLike>`.
   - `import/tasks.ts`: gán `errors` (mảng object) vào cột JSON (`JsonValue`); `createIssue` nhận `CreateIssueInput` với `priority` tùy chọn.
   - `base.ts` / `exporter.ts`: kiểu generic `ExportSchemaDefinition<T, D>` truyền vào `Exporter` (tham số `never`).
   - `routes/imports.ts`: hàm `projectId(c)` nhận kiểu cấu trúc tối giản thay cho `Context`.
2. Áp dụng migration `import_jobs` trước khi chạy `tests/p3-export.integration.mjs`. Test dùng `LANCITY_TEST_URL` mặc định `http://localhost:4198` và đường dẫn tạo issue `POST /workspaces/:slug/projects/:projectId/issues` (JSON camelCase). Sửa nếu khác thực tế.
3. Chưa kiểm chứng trên Worker thật: nodemailer gửi email báo xong (lỗi gửi chỉ ghi log cảnh báo), `CompressionStream('deflate-raw')` với tệp lớn, bộ nhớ khi export lớn.
4. Chưa có giao diện (Server Action và trang). Service `exportIssues`, `listExports`, `startImport`, `getImport` dùng trực tiếp được từ Server Action. Server Action tải file nên trỏ trình duyệt tới đường dẫn download.
5. Cần chuẩn bị khi xóa workspace hoặc project: file R2 của export và import (`<workspaceId>/...`, `<workspaceId>/imports/...`) chưa bị dọn ngoài cron 8 ngày của export. File import nên được xóa sau khi import xong, chưa làm (chờ quyết định giữ để đối chiếu hay không).
