# Handoff p1-issue-collab

Phạm vi: mục cộng tác của [05-issue.md](../05-issue.md): comment, reaction, vote, link, relation, subscriber, attachment, activity đọc, version đọc, mention. Chưa chạy test, build, typecheck. Chỉ chạy `eslint` và `prettier` trên các file bên dưới (sạch).

Test tích hợp: [tests/p1-issue-collab.integration.mjs](../../../tests/p1-issue-collab.integration.mjs). Chạy theo README (Worker cô lập cổng 4198, `LANCITY_TEST_D1`). Test yêu cầu `issueCollabRoutes` được mount trước `issuesRoutes` (mục b).

## (a) Mục PD đã xong

Code chính: [comment.ts](../../../src/server/issue/comment.ts), [reaction.ts](../../../src/server/issue/reaction.ts), [vote.ts](../../../src/server/issue/vote.ts), [attachment.ts](../../../src/server/issue/attachment.ts), [activity.ts](../../../src/server/issue/activity.ts), [version.ts](../../../src/server/issue/version.ts), [mention.ts](../../../src/server/issue/mention.ts), [relation.ts](../../../src/server/issue/relation.ts), [link.ts](../../../src/server/issue/link.ts), [subscriber.ts](../../../src/server/issue/subscriber.ts), [issue-relation-mapper.ts](../../../src/server/issue/issue-relation-mapper.ts), route [issue-collab.ts](../../../src/server/api/v1/routes/issue-collab.ts). File phụ trợ mới: [collab-access.ts](../../../src/server/issue/collab-access.ts) (thay `issue_in_project`, `issue_hidden_from_guest`, `guest_cannot_view_issue`), [comment-html.ts](../../../src/server/issue/comment-html.ts) (sanitizer thay `nh3`/`validate_html_content`, `strip_tags`). Zod: [collab-schema.ts](../../../src/types/issue/collab-schema.ts).

| PD | Cách xử lý | File |
| --- | --- | --- |
| 0558, 0559 | Port: feed property activity + comment, lọc `created_at__gt`, `activity_type` | activity.ts (`listIssueHistory`) |
| 0607, 0608, 0609, 0610, 0611, 0612 | Port comment list/retrieve/create/update/delete | comment.ts |
| 0613, 0614, 0615, 0616, 0617 | Port reaction của comment, kể cả chặn guest bị hạn chế | comment.ts |
| 0606 | Gộp (adapter `IssueCommentViewSet.update` = PATCH) | issue-collab.ts |
| 0629, 0630, 0631, 0632, 0633 | Đã có, bổ sung enqueue job crawl tiêu đề link | link.ts |
| 0626, 0627, 0628 | Gộp adapter link (đã có ở issues.ts) | issues.ts (core) |
| 0634, 0635, 0636, 0637 | Port issue reaction | reaction.ts |
| 0638 | Port `issueInProject` | relation.ts |
| 0639, 0640, 0641 | Đã có; thêm `implements`/`implemented_by`, thêm field `sort_order`, `label_ids`, `assignee_ids`, `created_at`... vào list | relation.ts |
| 0644, 0646, 0647, 0648, 0649, 0650, 0651, 0652, 0653 | Đã có trong subscriber.ts, không đổi hành vi | subscriber.ts |
| 0645 | Thay thế: quyền kiểm tra trong service (`requireProjectAccess`) | subscriber.ts |
| 0654, 0655, 0656 | Port version list (cursor) và detail | version.ts (`listIssueVersionsPage`, `getIssueVersion`) |
| 0657, 0658, 0659 | Port description version list và detail | version.ts |
| 0160 đến 0171 | Gộp link và comment của API công khai vào cùng service (thêm `external_id`/`external_source`, 409 khi trùng) | link.ts, comment.ts, issue-collab.ts |
| 0172 đến 0176 | Gộp comment API | comment.ts |
| 0177, 0178, 0179 | Port activity list có cursor và detail | activity.ts (`listIssueActivitiesPage`, `getIssueActivity`) |
| 0180 đến 0184 | Port attachment trên R2 (xem ghi chú) | attachment.ts |
| 0186, 0187 | Gộp relation API | relation.ts |
| 0025, 0026, 0027 | Đã có (schema link) | types/issue/schema.ts (core) |
| 0028 | Port (schema relation mở rộng) | collab-schema.ts |
| 0029, 0332 | Port validate comment: `sanitizeHtml` | comment-html.ts |
| 0325 | Port `source_data` từ intake | activity.ts |
| 0327, 0328, 0329, 0330 | Đã có (schema link) | types/issue/schema.ts (core) |
| 0331 | Thay thế: kiểm tra MIME/kích thước ở `createAttachmentSchema` | collab-schema.ts |
| 1431 | Port `IssueComment.save`: strip tags, tạo/cập nhật hàng `descriptions` | comment.ts |
| 1884, 1885 | Port mapper | issue-relation-mapper.ts |

Ghi chú nghiệp vụ:

- Comment mới tạo hàng `descriptions` và gắn `description_id`. Comment cũ (tạo bằng `createComment` của core) không có hàng này, nên sửa chúng không đồng bộ description.
- Comment: `comment_html` được sanitize; `text` vẫn dùng được cho client cũ (loại trừ nhau). Người viết và subscriber được thêm vào danh sách theo dõi, người được mention cũng vậy (port `extract_mentions_as_subscribers`). Thông báo mention thuộc nhóm 09.
- Danh sách comment sắp theo `created_at` tăng dần (như `listComments` cũ), khác `-created_at` của Plane, để client hiện tại không đổi.
- Attachment: R2 không có presigned POST theo cách của S3. Luồng: `POST attachments` tạo bản ghi `file_assets` (`entity_type = ISSUE_ATTACHMENT`) và trả `uploadUrl`; client `PUT` bytes vào `uploadUrl` (Content-Type phải khớp); `PATCH {is_uploaded:true}` xác nhận (kiểm tra object trong R2, ghi activity); `GET` tải trực tiếp từ R2 thay cho redirect presigned. Giới hạn 5 MiB, đổi bằng env `FILE_SIZE_LIMIT`.
- `implements` được lưu thành `implemented_by` với hai phía đảo ngược (Plane lưu không đảo, làm quan hệ ngược nghĩa). Đây là khác biệt cố ý.
- Version list trả timestamp UTC, không chuyển múi giờ người dùng như `user_timezone_converter`.
- `/versions/page` và `/activities/page` là đường dẫn mới vì `GET /versions` và `GET /activities` của issues.ts (core) trả mảng và đang có test dựa vào đó.

PD để trống:

- PD-0134 đến 0139 (helper quyền của api/views/issue.py): thuộc p1-issue-core. Chức năng tương đương đã có ở `collab-access.ts` cho phần cộng tác.
- PD-1423, 1424, 1426, 1429, 1430, 1432, 1434 đến 1438 (`__str__` của model): chỉ để in chuỗi, không cần port. Đề nghị đánh dấu "Tham chiếu, không port".
- PD-1439, 1440 (`log_issue_version`, `log_issue_description_version`): thuộc nhóm lịch sử/phiên bản (p1-issue-core/06). Tôi chỉ đọc bảng.
- Vote: Plane chỉ để vote ở view công khai (nhóm 12). `vote.ts` cung cấp vote cho thành viên project, chưa gắn PD nào trong 05.

## (b) Route cần đăng ký vào index.ts

```ts
import { issueCollabRoutes } from '@/server/api/v1/routes/issue-collab'
// Phải đứng TRƯỚC dòng mount issuesRoutes:
app.route(linkto.apiProject, issueCollabRoutes)
app.route(linkto.apiProject, issuesRoutes)
```

`issueCollabRoutes` định nghĩa lại `GET/POST /issues/:issueId/comments`, `PATCH/DELETE .../comments/:commentId` và `POST /issues/:issueId/relations` với schema rộng hơn (tương thích ngược), nên cần đứng trước `issuesRoutes`. Nếu mount sau, các handler cũ thắng và comment HTML, `implements` không dùng được. Hoặc p1-issue-core bỏ các handler trùng.

## (c) Schema ext

Không có bảng hay cột mới. Dùng sẵn `issue_comments`, `comment_reactions`, `issue_reactions`, `issue_votes`, `issue_mentions`, `descriptions`, `file_assets`, `issue_versions`, `issue_description_versions`. Không cần migration.

## (d) Key linkto cần thêm

Route dùng hằng số cục bộ `issueCollabPaths` (đường dẫn tương đối với `linkto.apiProject`). Nên thêm vào `apiV1Routes` rồi thay thế: `commentReactions`, `commentReaction`, `issueReactions`, `issueReaction`, `issueVotes`, `attachments`, `attachment`, `attachmentContent`, `issueHistory`, `activitiesPage`, `activityEntry`, `versionsPage`, `versionEntry`, `descriptionVersions`, `descriptionVersion`. Các key `comments`, `comment`, `issueRelations` đã có.

## (e) Dependency, binding, env

- Không thêm package.
- Binding `ASSET_BUCKET` (R2) đã khai báo ở hạ tầng. Attachment trả 503 `STORAGE_UNAVAILABLE` nếu thiếu.
- Env tùy chọn `FILE_SIZE_LIMIT` (byte, mặc định 5242880).
- Link: `createIssueLink`/`updateIssueLink` đẩy job `issue.crawl_work_item_link_title` với payload `{ linkId, url }` (hằng số `CRAWL_LINK_TITLE_JOB` trong link.ts). Nhóm 06 (PD-1236) cần đăng ký handler cùng tên trong `src/server/issue/jobs.ts`. Chưa có handler thì job bị bỏ và ghi log.

## (f) Việc còn dang dở

- Chưa chạy typecheck và test nên có thể còn lỗi kiểu ở các `insert().select(sql...)` mới.
- Thông báo (mention, comment, reaction) và webhook `model_activity` chưa nối. `extractMentions`, `diffMentions` trong mention.ts dùng lại được cho PD-1205 đến 1207 của nhóm 09.
- `syncIssueMentions` (bảng `issue_mentions`, PD-1201 cho mô tả issue) đã có nhưng chưa được gọi từ `createIssue`/`updateIssue` vì file thuộc p1-issue-core.
- Bản ghi attachment ở trạng thái chờ (không bao giờ upload) chưa có job dọn. Nên thêm cron xóa `file_assets` `ISSUE_ATTACHMENT` chưa `is_uploaded` sau 24 giờ.
- Sanitizer `comment-html.ts` là bộ lọc allow-list tự viết, không cân bằng thẻ như `nh3`. Cân nhắc dùng thư viện khi có phê duyệt dependency.
- Comment cũ không có `description_id` (xem trên). Cần script vá nếu muốn đồng bộ.
