# Handoff p2-intake-draft

Nhóm: phần intake (container, work item trong intake, API công khai) và draft ở cấp workspace của `docs/plane-demo-porting/07-planning.md`. Chưa chạy test, build, typecheck theo quy ước. ESLint và Prettier sạch trên các file bên dưới.

Test: [`tests/p2-intake-draft.integration.mjs`](../../../tests/p2-intake-draft.integration.mjs) (Worker + D1, cần mount route ở mục (b)). Chạy bằng `LANCITY_TEST_D1=... node --test tests/p2-intake-draft.integration.mjs` theo README.

Không có email intake trong nguồn: `source_email` chỉ là cột lưu, Plane không nhận thư vào. Mục này không có việc phải làm.

## (a) PD đã xong

Code: [`src/server/intake/`](../../../src/server/intake) (`service.ts`, `issue.ts`, `queries.ts`, `presenters.ts`, `model-rules.ts`), [`src/server/draft/`](../../../src/server/draft) (`service.ts`, `workspace.ts`, `queries.ts`, `presenters.ts`, `model-rules.ts`), route [`intakes.ts`](../../../src/server/api/v1/routes/intakes.ts) và [`drafts.ts`](../../../src/server/api/v1/routes/drafts.ts), Zod [`p2-intake-schema.ts`](../../../src/types/planning/p2-intake-schema.ts) và [`p2-draft-schema.ts`](../../../src/types/planning/p2-draft-schema.ts). Mọi mục dưới đây được test bởi `p2-intake-draft.integration.mjs` trừ khi ghi khác.

### Intake

| PD | Kết quả | Code |
| --- | --- | --- |
| 0118, 0122, 0544, 0548 | Port. `queryIntake` (đếm pending), `queryIntakeIssue` (join issue, bỏ hàng đã xóa mềm), `findIntakeIssue`, `labelIdsByIssue`. PD-0548 (queryset theo Issue, app không dùng) gộp vào `queryIntakeIssue` | `intake/queries.ts` |
| 0119, 0120 | Gộp. `GET /intake-issues`: cần `projects.intake_view`, ẩn snooze đã quá hạn, guest bị giới hạn chỉ thấy phần mình tạo, phân trang, `fields=` | `listIntakeIssuesApi`, route |
| 0121 | Gộp. `POST /intake-issues` trả 201, kèm `issueDetail` | `createIntakeIssueApi` |
| 0123, 0124, 0125 | Gộp. `GET/PATCH/DELETE /intake-issues/:issueId` | `getIntakeIssueApi`, `updateIntakeIssueApi`, `deleteIntakeIssueApi` |
| 0014, 0015, 0315, 0316 | Port. Hình dạng input ở Zod (`updateIntakeIssueInputSchema`, `updateIntakeIssueApiInputSchema`). Phần cần D1 nằm trong service: `duplicate_to` phải thuộc cùng project (400), nhận (status 1) cần có default state khi issue đang ở triage (400), `snoozed_till` ngày trần hoặc datetime được đưa về 00:00 của ngày đó theo múi giờ project. Plane đặt các mục này ở `schema.ts`; không sửa `schema.ts` nên để ở file `p2-*` | `p2-intake-schema.ts`, `intake/issue.ts` (`applyIntakeUpdate`) |
| 0016, 0317 | Gộp. Cập nhật intake + chuyển state triage sang default, ghi activity `intake` (verb là status), ghi version, cùng một batch D1 | `applyIntakeUpdate` |
| 0318, 0319 | Port. `toIntakeIssueResponse`, `toIntakeIssueDetailResponse`; thêm `toIntakeIssueApiResponse` cho API công khai | `intake/presenters.ts` |
| 0541, 0542, 0543 | Gộp. `POST/PATCH/GET /inboxes[/:intakeId]` dùng lại `createIntake`, `updateIntake`, `getIntake` | route |
| 0545 | Port. `GET /inboxes` trả intake đầu tiên (theo tên) kèm `pendingIssueCount`, `null` nếu chưa có. `GET /intakes` cũ vẫn trả mảng, nay mỗi phần tử có thêm `pendingIssueCount` | `getProjectIntake`, `listIntakes` |
| 0546 | Gộp. `persistIntake` là bí danh của `createIntake` | `intake/service.ts` |
| 0547 | Port. `deleteIntake` có sẵn (400 khi là intake mặc định) | `intake/service.ts` |
| 0549, 0550 | Port. `GET /inbox-issues`: mặc định `status=-2`, `status` nhận CSV (bỏ `null`), bộ lọc issue (`issueFilters`), `order_by` theo allow-list (`-issue__created_at` mặc định), guest chỉ thấy phần mình tạo. 0550 là callback của 0549, đã gộp | `listIntakeIssues` |
| 0551 | Port. `POST /inbox-issues` (mọi role kể cả guest), tạo issue ở state triage (tự tạo state `Triage` nếu thiếu), intake issue, sequence, activity, version trong một batch. Không dùng được `createIssue` vì nó từ chối state triage | `createIntakeIssue`, `insertIntakeIssue` |
| 0552 | Port. `PATCH /inbox-issues/:issueId`: admin hoặc người tạo; chỉ admin (project hoặc workspace) đổi được thuộc tính intake; phần `issue` sửa qua `updateIssue` của p1-issue-core (guest chỉ sửa name và mô tả) | `updateIntakeIssue` |
| 0553 | Port. `GET /inbox-issues/:issueId`: guest bị hạn chế nhận 403 với phần của người khác | `getIntakeIssue` |
| 0554 | Port. `DELETE /inbox-issues/:issueId`: xóa luôn issue khi status -2, -1, 0, 2 (qua `deleteIssue` của p1-issue-core, giữ reservation sequence), giữ issue khi đã accepted | `deleteIntakeIssue` |
| 0556 | Port. `GET /intake-work-items/:workItemId/description-versions[/:versionId]` dùng `listDescriptionVersionsPage`, `getDescriptionVersion` của p1-issue-collab (đã có quy tắc guest 403). Chưa có test riêng | `intake/service.ts`, route |
| 0555, 0557 | Thay thế. `user_timezone_converter` không còn: `version.ts` trả mốc thời gian UTC, client đổi sang múi giờ. Phân trang theo cursor id của p1-issue-collab, không phải paginator page của Plane | |
| 1403, 1404 | Tham chiếu. `formatIntake`, `formatIntakeIssue` | `intake/presenters.ts` |
| 1405 | Port. `resolveSnoozedTill`; dùng ở mọi chỗ ghi `snoozed_till` | `intake/model-rules.ts` |

### Draft

| PD | Kết quả | Code |
| --- | --- | --- |
| 0883 | Port. `queryWorkspaceDraftIssue` (SQL một câu, kèm `cycle_id`, `module_ids`, `label_ids`, `assignee_ids`), `draftFilters`, `findDraftRow`, `findDraft`. Bộ lọc là phần của `issue_filters` áp dụng được cho draft: `priority`, `state`, `state_group`, `labels`, `assignees`, `parent`, `created_by`, `name`, `start_date`, `target_date`. Khóa chỉ có ở issue (cycle, module) bị bỏ qua, Plane báo lỗi field | `draft/queries.ts` |
| 0884, 0885 | Port. `GET /draft-issues`: chỉ draft của người gọi, mới nhất trước, phân trang | `listWorkspaceDraftIssues` |
| 0886, 0308 | Port. `POST /draft-issues` (201): kiểm tra `can_write_project` khi có `project_id`, lọc assignee (role >= member, active) và label theo project, state/parent/estimate phải thuộc project, cycle và module phải thuộc project; mọi hàng liên kết trong một batch | `createWorkspaceDraftIssue` |
| 0887, 0309 | Port. `PATCH /draft-issues/:draftId` (204): thay trọn bộ assignee/label/module khi truyền, `cycle_id` kể cả `null` thay cycle, project của draft không đổi; kiểm tra quyền ghi cho project của draft và project trong body | `updateWorkspaceDraftIssue` |
| 0888 | Port. `GET /draft-issues/:draftId`, chỉ người tạo | `getWorkspaceDraftIssue` |
| 0889 | Port. `DELETE /draft-issues/:draftId` (204): người tạo hoặc admin workspace; xóa mềm cả hàng liên kết | `deleteWorkspaceDraftIssue` |
| 0890 | Port. `POST /draft-to-issue/:draftId` (201): issue dựng từ body như Plane (không lấy từ draft), tạo qua `createIssue` của p1-issue-core, rồi một batch: cycle issue, module issues, chuyển file asset sang issue (`ISSUE_DESCRIPTION`), xóa mềm draft và liên kết. Activity `cycle.activity.created`, `module.activity.created` gửi qua `enqueueIssueActivity` | `createDraftToIssue` |
| 0882 | Port. `canWriteProject` | `draft/workspace.ts` |
| 0305 | Port. `toDraftIssueResponse` (camelCase). Plane lấy `assignee_ids`/`label_ids` từ body gốc, bản này trả id thật đã lọc | `draft/presenters.ts` |
| 0306 | Port. Hình dạng input ở Zod (`createWorkspaceDraftInputSchema`: ngày bắt đầu không sau ngày đích), phần cần D1 ở `validateRelations`. HTML mô tả dùng `assertSafeDescriptionHtml` của p1-issue-core (bộ làm sạch đầy đủ là PD-1715) | `p2-draft-schema.ts`, `draft/workspace.ts` |
| 0307 | Port. `checkCycleAndModules` nằm trong `draft/workspace.ts` thay vì `presenters.ts` (hàm này đọc D1, không phải presenter) | `draft/workspace.ts` |
| 1390 | Port. `saveDraftIssue` (state mặc định, `completed_at` theo group, `description_stripped`) và `draftSortOrderSql` (+10000 sau `sort_order` lớn nhất cùng project và state) | `draft/model-rules.ts` |
| 1391 đến 1395 | Tham chiếu. `formatDraftIssue`, `formatDraftIssueAssignee`, `formatDraftIssueLabel`, `formatDraftIssueModule`, `formatDraftIssueCycle` | `draft/presenters.ts` |

Route draft theo project cũ (`/drafts`, `listDrafts`, `createDraft`, ...) giữ nguyên, chữ ký không đổi.

### Khác Plane có chủ đích

- Request body giữ snake_case như Plane và như phần planning hiện có (`description_html`, `duplicate_to`, `label_ids`). Response là camelCase (`duplicateTo`, `snoozedTill`, `labelIds`), cùng quy ước với p1-issue-core. Khung phân trang giữ khóa snake_case của `paginate`.
- Retrieve và update draft: Plane khai báo `creator=True, model=Issue` (sai model, draft id không bao giờ khớp issue) nên member/guest tạo draft cũng bị 403. Bản này coi người tạo là đủ quyền (truy vấn đã lọc theo `created_by`). Delete dùng đúng model draft, admin workspace xóa được draft của người khác như Plane.
- Create draft cho mọi role workspace kể cả guest (như Plane) nhưng guest chỉ tạo được draft không gắn project hoặc gắn project mà họ ghi được.
- Cập nhật intake issue không còn gọi `description_json = {}` khi guest sửa mà không gửi JSON (Plane ghi đè thành `{}`); bản này bỏ qua trường vắng mặt.
- `skip_activity` được nhận nhưng không có tác dụng (nó chỉ tắt activity khi migrate mô tả; `updateIssue` không có tham số này).
- Update intake: bước sửa issue (`updateIssue`) và bước đổi status chạy hai lần ghi liên tiếp, không cùng một giao dịch. Bước đổi status, chuyển state, version, activity thì cùng một batch.
- `POST /inbox-issues` trả 200 như Plane, `POST /intake-issues` trả 201.
- API công khai: `issueDetail` gồm hàng issue, `labels` và `assignees` là mảng id; chưa mở rộng `expand=` (cycle, module, state, user).
- Intake: Plane tạo intake issue nên API công khai báo 400 khi project chưa có intake, bất kể `intake_view`, còn đọc thì cần `intake_view`. Giữ đúng điều kiện của mã nguồn.

### Phát hiện ở nhóm khác

`emitIssueEvent` của p1-issue-core (`src/server/issue/events.ts`) đẩy payload có `event` nhưng không có `type`, trong khi `issueActivityJobSchema` của p1-issue-background bắt buộc `type` (và bỏ qua `activityRecorded`). Handler sẽ ghi log "Invalid payload" và bỏ job. Intake issue mới và update đi qua `emitIssueEvent` nên chịu cùng lỗi, thông báo và webhook của nhóm này chưa chạy cho tới khi hai bên thống nhất payload. Draft sang issue dùng `enqueueIssueActivity` với `type` hợp lệ.

## (b) Route cần đăng ký vào `index.ts`

`intakesRoutes` đã được mount ở `linkto.apiProject`, nên các route mới của intake (`/inboxes`, `/inbox-issues`, `/intake-issues`, `/intake-work-items/...`) có hiệu lực ngay. `draftsRoutes` (theo project) cũng đã mount. Cần thêm router draft cấp workspace:

```ts
import { draftsRoutes, draftsWorkspaceRoutes } from '@/server/api/v1/routes/drafts'
app.route(linkto.apiWorkspace, draftsWorkspaceRoutes) // MỚI: /draft-issues, /draft-to-issue/:draftId
```

Thứ tự mount không quan trọng (đường dẫn không trùng router nào hiện có). `drafts.ts` và `intakes.ts` còn `export default` (workspace router và `intakesRoutes`).

## (c) Schema ext

Không có bảng hoặc cột mới, không tạo `ext-p2-intake-draft.ts`. Mọi truy vấn dùng bảng có sẵn trong `drizzle/0001` (`intakes`, `intake_issues`, `draft_issues`, `draft_issue_*`, `file_assets`).

Gợi ý index cho migration của integrator (không bắt buộc): `intake_issues(intake_id, status)` cho danh sách theo status; `draft_issues(workspace_id, created_by_id)` cho danh sách draft của người dùng. Tên đề xuất: `0004_intake_draft_indexes`.

## (d) Key linkto cần thêm

Đang khai báo cục bộ trong `routes/intakes.ts` (`intakeRoutes`) và `routes/drafts.ts` (`draftRoutes`). Khi thêm vào `apiV1Routes`, chuyển sang đó:

```ts
// theo project (apiProject)
inboxes: '/inboxes',
inbox: '/inboxes/:intakeId',
inboxIssues: '/inbox-issues',
inboxIssue: '/inbox-issues/:issueId',
intakeIssues: '/intake-issues',
intakeIssue: '/intake-issues/:issueId',
intakeDescriptionVersions: '/intake-work-items/:workItemId/description-versions',
intakeDescriptionVersion: '/intake-work-items/:workItemId/description-versions/:versionId',
// theo workspace (apiWorkspace)
draftIssues: '/draft-issues',
draftIssue: '/draft-issues/:draftId',
draftToIssue: '/draft-to-issue/:draftId'
```

## (e) Dependency, binding, env

Không cần dependency, binding hay biến môi trường mới. Việc mở khóa `unsnooze` đã có ở p1-issue-background (cron `*/5 * * * *`); nhóm này không đăng ký job riêng.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`. Điểm dễ lỗi kiểu vì chưa chạy: `db.insert(...).select(sql...)` và `values({ issueId: sql })` trong `intake/issue.ts` (theo mẫu của `createIssue`); generic của `paginate`/`OffsetPaginator` (`emptyPage` dùng `never`); `db.all<DraftListRow>` và `linkStatements` ép `draftId` (SQL) sang `number` trong `draft/workspace.ts`; ép `edit as UpdateIssueInput` khi gọi `updateIssue`.
2. Chạy `tests/p2-intake-draft.integration.mjs` sau khi mount `draftsWorkspaceRoutes`; chạy lại `tests/planning.integration.mjs` (đổi nhẹ: `/intakes` trả thêm `pendingIssueCount`).
3. Chưa có Server Action (`src/app/**/actions.ts` nằm ngoài phạm vi). Service nhận `(db, actor, slug, ...)` nên Server Action gọi trực tiếp được.
4. Chưa có test riêng cho description version của intake (PD-0556) và cho `fields=` của API công khai.
5. Giới hạn D1: bộ lọc `labels`, `assignees`, `state` của draft chỉ lấy tối đa 80 id; mỗi lần chèn liên kết tối đa 10 hàng. Danh sách intake chia nhỏ 80 issue khi nạp label.
6. `ensureTriageState` chèn state `Triage` với `onConflictDoNothing`. Project tạo qua `createProject` đã có sẵn state này, nhánh này chỉ cứu project cũ.
7. Bộ làm sạch HTML đầy đủ (PD-1715) thay `assertSafeDescriptionHtml` khi nhóm content xong; hàm tập trung ở `src/server/issue/sequence.ts`, cả hai nhóm của tôi gọi qua đó.
