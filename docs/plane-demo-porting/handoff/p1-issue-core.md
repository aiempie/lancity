# Handoff p1-issue-core

Phần lõi của nhóm 05-issue: danh sách, chi tiết, tạo, sửa, xóa issue, state, label, sequence, bộ lọc, nhóm, sắp xếp, phân trang, lưu trữ (archive), thao tác hàng loạt, thuộc tính hiển thị theo người dùng, sub-issue và tìm kiếm.

Chưa chạy test, build, typecheck (theo quy ước). ESLint sạch trên mọi file của nhóm. Test tích hợp: [`tests/p1-issue-core.integration.mjs`](../../../tests/p1-issue-core.integration.mjs). Test đơn vị cũ `tests/issue.test.mjs` vẫn dùng API của `service.ts` (chữ ký không đổi), cần chạy lại sau khi gộp.

## (a) PD đã xong

File chính nằm dưới `src/server/issue/` trừ khi ghi khác. Test tích hợp trên bao phủ các mục, trừ khi ghi "chưa có test".

| Nhóm PD | Code |
| --- | --- |
| PD-0142, 0140, 0605, 0604 | `list.ts` (`getIssueByIdentifier`, `strictStrToInt`), route `issuesWorkspaceRoutes` (`/issues/:identifier`, `/work-items/:identifier`) |
| PD-0144, 0145, 0143, 0577, 0582, 0583-0585, 0596, 0597, 0594, 0595 | `list.ts` (`paginateIssues`, `listIssuesPaginated`, `getIssueList`, `pageEnvelope`, `parsePagination`), route `GET /issues`, `/issues/list`, `/v2/issues` |
| PD-0146, 0586, 0322, 0323, 0022, 0021, 0333, 0320, 0321, 0024 | `service.ts` (`createIssue`), `sequence.ts`, `issue-presenters.ts` (`toIssueCreateResponse`), schema `createIssueInputSchema`, `issueApiInputSchema`, `issueInputSchema` |
| PD-0148, 0147, 0587, 0599, 0600, 0598, 0603 | `list.ts` (`getIssueById`, `retrieveIssueDetail`, `getIssueDetail`, `getIssueMeta`) |
| PD-0149, 0150, 0578, 0588, 0324, 0023 | `service.ts` (`updateIssue`, `upsertIssueByExternalId`), routes `PUT /issues` (upsert theo external id), `PUT` và `PATCH /issues/:issueId` |
| PD-0151, 0589 | `service.ts` (`deleteIssue`: admin dự án hoặc workspace, hoặc người tạo; xóa mềm, giữ reservation sequence) |
| PD-0154-0159, 0156, 0153, 0152, 0618-0620, 0621-0625, 0326, 1443, 1444, 0911 | `label.ts`, schema (`createLabelInputSchema`, `updateLabelInputSchema`, `labelValidateName`, `bulkCreateLabelsInputSchema`), route `/labels`, `/issue-labels`, `/bulk-create-labels`, workspace `/labels` |
| PD-0251-0258, 0249, 0250, 0253-0255, 0045, 0046, 0361, 0800-0809, 0931, 1486-1489, 1420, 1421 | `state.ts`, route `/states`, `/states/:stateId`, `/states/:stateId/mark-default`, `/intake-state`, workspace `/states` |
| PD-0562-0569, 0560, 0561, 0563-0565 | `archive.ts`, route `/archived-issues`, `/issues/:issueId/archive` (GET, POST, DELETE), `/bulk-archive-issues` |
| PD-0590, 0591, 1413-1416 | `properties.ts`, route `/user-properties` |
| PD-0592, 0593, 0601, 0602 | `archive.ts` (`bulkDeleteIssues`, `bulkUpdateIssueDates`, `validateDatesIssueBulkUpdateDate`), `list.ts` (`deletedIssuesList`), route `/bulk-delete-issues`, `/deleted-issues`, `/issue-dates` |
| PD-0642, 0643 | `sub-issue.ts`, route `/issues/:issueId/sub-issues` |
| PD-0185, 1886 | `list.ts` (`searchWorkspaceIssues`), `filter.ts` (`searchIssues`), route workspace `/issues/search` |
| PD-0134-0139 | `access.ts` (`userHasIssuePermission`, `isActiveProjectMember`, `isProjectOrWorkspaceAdmin`, `isRestrictedGuest`, `guestCannotViewIssue`, `visibleIssueSql`). Chưa có test riêng, dùng gián tiếp qua ownOnly và search |
| PD-1417 | `list.ts` (`LIVE_ISSUES`) |
| PD-1418 | `service.ts` (`createIssue`, `updateIssue`) và `sequence.ts`: sequence (counter trong batch D1), sort order +10000, `description_stripped`, state mặc định, `completed_at`. Khóa advisory của Postgres được thay bằng câu lệnh counter trong cùng batch |
| PD-1839-1841 | `filter.ts` (`groupSpec`, `ISSUE_ANNOTATIONS`, `issueOnResults`, `issueGroupValues`) |
| PD-1855-1883 | `filter.ts`. PD-1882 (`filter_logged_by`) nhận tham số nhưng bỏ qua vì Lancity không có cột `logged_by` |
| PD-1915, 1916 | `filter.ts` (`sanitizeOrderBy`, `orderIssueQueryset`) |
| PD-0020, 0030, 0031, 0334-0338, 1419, 1425, 1433, 1488 | `issue-presenters.ts` |
| PD-0579 | Thay thế: schema đọc và ghi tách theo thao tác (Zod ở `src/types/issue/schema.ts`) |
| PD-0145, 0156, 0162, 0166, 0171, 0178, 0253 | Gộp vào route tương ứng (callback `on_results` của adapter) |

Khác biệt so với Plane (đã ghi ở comment đầu `filter.ts`):
- Id là số nguyên, không phải UUID.
- Token "None" đi cùng id trong bộ lọc là OR (Django AND hai điều kiện và luôn rỗng).
- `order_by=priority` xếp "none" trước, `-priority` xếp "urgent" trước (hướng paginator của Plane thực sự dùng). `state__group` tăng dần là backlog trước, giảm dần là cancelled trước.
- Danh sách có tham số truy vấn trả khung phân trang của Plane (`grouped_by`, `next_cursor`, `results`...), phần tử viết camelCase. Gọi không tham số vẫn trả mảng như trước để không phá client cũ.
- `GET /issues/:issueId` nay trả DTO chi tiết (thêm `labelIds`, `assigneeIds`, `moduleIds`, `cycleId`, bộ đếm, `isSubscribed`, `isIntake`) và gồm cả issue đã archive, như `Issue.objects`.
- Xóa issue yêu cầu admin hoặc người tạo (trước đây member đều xóa được). Sửa issue cho phép cả người tạo dù là guest, đúng `allow_permission(creator=True)`.
- Mô tả HTML chỉ bị chặn khi chứa script, iframe, sự kiện `on*`, `javascript:` (`assertSafeDescriptionHtml`). Bộ làm sạch đầy đủ là PD-1715/1712 của nhóm content, cần thay khi có.

## PD để trống hoặc thuộc nhóm khác

Thuộc nhóm khác theo phân chia:
- p1-issue-collab: PD-0025-0029, 0161-0176, 0180-0184, 0186-0187, 0327-0332, 0606-0617, 0626-0641, 0644-0653, 1422-1424, 1426-1429, 1431, 1432, 1434-1437, 1884, 1885.
- p1-issue-background: PD-0177-0179, 0325, 0558, 0559, 0654-0659, 1430, 1438-1440.

Của nhóm này nhưng chưa làm trọn:
- `fields` và `expand` (query `fields=`, `expand=`) mới có helper (`initIssueListDetail`, `toIssueListDetailResponse`, `getLabelsIssueExpandApi`, `getAssigneesIssueExpandApi`, `toIssueResponseApi`), chưa nối vào route. Ảnh hưởng PD-0020, 0030, 0031, 0334, 0338. Chưa có test.
- PD-0587: reactions và links nhúng trong chi tiết issue không được trả; dùng endpoint của collab.
- Xóa dây chuyền khi xóa issue (`soft_delete_related_objects`, PD-1104 của nhóm 15) chưa chạy. `deleteIssue` chỉ xóa mềm issue, giữ hành vi cũ. `bulkDeleteIssues` có xóa mềm `cycle_issues`, `module_issues`.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

```ts
import { issuesRoutes, issuesWorkspaceRoutes } from '@/server/api/v1/routes/issues'
app.route(linkto.apiProject, issuesRoutes) // đã có
app.route(linkto.apiWorkspace, issuesWorkspaceRoutes) // MỚI: states, labels, issues/search, issues/:identifier, work-items/:identifier
```

Lưu ý khi gộp:
- `issuesWorkspaceRoutes` dùng `/issues/search` và `/issues/:identifier` ở mức workspace. Kiểm tra xung đột với router khác gắn ở `linkto.apiWorkspace` (search, views, stickies...). `/issues/search` đã đăng ký trước `/issues/:identifier` trong file.
- `routes/issues.ts` vẫn còn route cũ của comment, link, relation, subscriber (service có sẵn nên giữ để không gãy). `routes/issue-collab.ts` của collab sẽ trùng đường dẫn; khi mount cả hai nên xóa phần trùng ở `issues.ts`.
- Trong `issues.ts`, `/issues/list` được đăng ký trước `/issues/:issueId`. Giữ thứ tự này.

## (c) Schema ext và migration

Không cần bảng hoặc cột mới. Mọi truy vấn dùng bảng có sẵn trong `drizzle/0001`. Không có file `ext-p1-issue-core.ts`.

Gợi ý index cho migration của integrator (không bắt buộc): `issues(project_id, updated_at)` cho `/v2/issues` và `updated_at__gt`; `issue_labels(issue_id, label_id)` và `issue_assignees(issue_id, assignee_id)` nếu lọc theo label hoặc assignee chậm. Tên đề xuất: `0003_issue_core_indexes`.

## (d) Key linkto cần thêm

Đường dẫn tương đối theo project, đang khai báo cục bộ trong `routes/issues.ts` (`coreRoutes`) vì không được sửa `linkto.ts`. Khi thêm vào `apiV1Routes`, chuyển sang đó:

```ts
issuesList: '/issues/list',
issuesDetail: '/issues-detail',
issuesPaginated: '/v2/issues',
issueMeta: '/issues/:issueId/meta',
issueArchive: '/issues/:issueId/archive',
archivedIssues: '/archived-issues',
bulkArchive: '/bulk-archive-issues',
bulkDelete: '/bulk-delete-issues',
deletedIssues: '/deleted-issues',
issueDates: '/issue-dates',
userProperties: '/user-properties',
subIssues: '/issues/:issueId/sub-issues',
state: '/states/:stateId',
stateDefault: '/states/:stateId/mark-default',
intakeState: '/intake-state',
label: '/labels/:labelId',
issueLabelsList: '/issue-labels',
issueLabelItem: '/issue-labels/:labelId',
bulkCreateLabels: '/bulk-create-labels'
```

Mức workspace (`workspaceCoreRoutes`): `/states`, `/labels`, `/issues/search`, `/issues/:identifier`, `/work-items/:identifier`.

## (e) Dependency, binding, env

Không cần dependency, binding hay biến môi trường mới.

Job đẩy đi: `enqueueJob` với loại `issue.activity` (hằng `ISSUE_ACTIVITY_JOB` trong `events.ts`) sau mỗi create, update, delete, archive, unarchive và đổi parent. Payload: `event` (`created`, `updated`, `deleted`, `archived`, `unarchived`), `issueId`, `projectId`, `actorId`, `requestedData`, `currentInstance`, `epoch`, `notification: true`, `activityRecorded: true`. Hàng activity và version đã được ghi sẵn trong cùng batch D1 (cờ `activityRecorded`). Handler của p1-issue-background chỉ nên làm thông báo, subscriber và webhook, không chèn thêm hàng activity. Nếu chưa có handler, job bị bỏ (Queue) hoặc ghi cảnh báo (chạy cục bộ). Việc gửi không làm lỗi request và bị bỏ qua ngoài Worker (test đơn vị).

`jobs/history.ts` của background (`activityStatement`, `versionStatement`) được dùng nguyên chữ ký. Đổi chữ ký sẽ làm gãy `service.ts`, `archive.ts`, `sub-issue.ts`.

## (f) Việc còn dang dở

1. Chạy `tests/issue.test.mjs` để xác nhận các test đơn vị cũ vẫn xanh, và `tests/p1-issue-core.integration.mjs` sau khi mount `issuesWorkspaceRoutes`. Chưa có lần chạy nào.
2. Nối `fields` và `expand` vào route danh sách và chi tiết (helper có sẵn trong `issue-presenters.ts`).
3. Thay `assertSafeDescriptionHtml` bằng bộ làm sạch HTML của nhóm content khi có.
4. `estimate_point` lọc theo id điểm ước lượng. Nếu giao diện gửi giá trị `point` cần thêm ánh xạ.
5. Các thao tác hàng loạt dùng body `issueIds`, `subIssueIds`, `updates[].startDate` (camelCase theo quy ước hiện có của Lancity), không phải `issue_ids`, `sub_issue_ids`. Client mobile cần theo định dạng này.
6. Giới hạn D1: một câu lệnh tối đa 100 tham số bind. Bộ lọc nhận vài chục id vẫn ổn, danh sách hàng trăm id trong `?labels=` sẽ lỗi. Cần chia nhỏ nếu giao diện gửi danh sách lớn.
7. Server Action mới trong `src/app/issues/actions.ts` (`updateIssueAction`, `deleteIssueAction`, `archiveIssueAction`, `unarchiveIssueAction`) chưa có giao diện gọi. Không thêm UI trong phạm vi lần này.
