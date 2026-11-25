# Handoff p3-public

Nhóm 12 (`docs/plane-demo-porting/12-public.md`): board công khai (space). Chưa chạy typecheck, build, test theo quy ước. ESLint và Prettier sạch trên mọi file bên dưới.

Mã: [`src/server/public/`](../../../src/server/public) (`board.ts`, `engagement.ts`, `intake.ts`, `asset.ts`, `issues.ts`, `grouper.ts`, `project.ts`, `model-rules.ts`, `presenters.ts`, cùng `service.ts` và `comments.ts` đã có) · route [`public.ts`](../../../src/server/api/v1/routes/public.ts) · Zod [`p3-public-schema.ts`](../../../src/types/content/p3-public-schema.ts). Test: [`tests/p3-public.integration.mjs`](../../../tests/p3-public.integration.mjs) (Worker + D1 + R2 local, chưa chạy).

Toàn bộ route nằm trong `public.ts` (checklist đề xuất `routes/public/*.ts` nhưng prompt chỉ giao một file route). Mọi thao tác công khai bắt đầu bằng `requireBoard` (`board.ts`): board phải đang công bố, không bị tắt, project không bị xóa hoặc lưu trữ, và `entity_identifier = project_id`.

## Quyết định thiết kế

- Phiên là tùy chọn trên toàn bộ `publicRoutes`: middleware đọc phiên Better Auth nếu có. Ghi (tạo, sửa, xóa) luôn qua `authenticate` (401 khi thiếu phiên). Đọc là công khai, trừ intake (Plane dùng `IsAuthenticated` cho cả `list` và `retrieve`).
- Chống lạm dụng bằng `rateLimit` của p1-platform: request không có phiên bị giới hạn theo IP (`PUBLIC_ANON_RATE_LIMIT`, mặc định `120/minute`; Plane `AnonRateThrottle` là 30/minute nhưng một trang board gọi nhiều danh sách cùng lúc nên nâng mặc định). Người dùng đã đăng nhập bị giới hạn ghi theo user (`PUBLIC_WRITE_RATE_LIMIT`, mặc định `30/minute`, chỉ áp dụng cho phương thức khác GET). Lỗi D1 của bộ giới hạn không chặn request (fail-open, như p1).
- Cờ do chủ board đặt (`is_comments_enabled`, `is_reactions_enabled`, `is_votes_enabled`) quyết định việc ghi. Lỗi 400 `COMMENTS_DISABLED`, `REACTIONS_DISABLED`, `VOTES_DISABLED`. Danh sách reaction và vote trả `[]` khi cờ tắt, như Plane (`queryset.none()`).
- Activity: reaction, vote, comment reaction, intake issue gọi `enqueueIssueActivity` (payload `type`, `requestedData`, `currentInstance`, `issueId`, `actorId`, `projectId`) và handler của p1-issue-background ghi activity. Comment công khai vẫn ghi activity trong batch như trước (code cũ, không đổi).
- Asset công khai: R2 không có presigned POST. `POST` tạo bản ghi `file_assets` và trả `upload_data { url, method: 'PUT', headers, max_size }` trỏ tới `PUT .../assets/v2/anchor/:anchor/:pk/content` (route mới, tương tự `uploadAssetContent` của p2-asset nhưng giới hạn theo board). `PATCH` xác nhận (object phải có trong R2, size lấy từ R2, chỉ nhận `attributes.name` từ client). `GET` stream từ R2, inline chỉ cho ảnh trong danh sách an toàn. Chỉ ảnh raster, chỉ `COMMENT_DESCRIPTION`, kiểm tra magic bytes, chỉ tác giả sửa, xóa, khôi phục.
- Thêm API cho chủ board bật/tắt reaction, vote, comment và chọn intake nhận bài công khai: `PATCH .../publication` nay nhận `{ is_comments_enabled?, is_reactions_enabled?, is_votes_enabled?, intake? }` (strict, ít nhất một khóa, `intake` là id hoặc `null`), qua `setPublicationSettings`. Body cũ `{ is_comments_enabled }` vẫn chạy và phản hồi có thêm trường. `setPublicationComments` giữ nguyên chữ ký.

## (a) PD

Mã chung: [board.ts](../../../src/server/public/board.ts) · [engagement.ts](../../../src/server/public/engagement.ts) · [intake.ts](../../../src/server/public/intake.ts) · [asset.ts](../../../src/server/public/asset.ts) · [issues.ts](../../../src/server/public/issues.ts) · [grouper.ts](../../../src/server/public/grouper.ts) · [project.ts](../../../src/server/public/project.ts). Test: `tests/p3-public.integration.mjs` trừ khi ghi khác (mục đã xong từ trước nằm ở `tests/worker.integration.mjs`).

### asset.py

| PD | Kết quả | Code |
| --- | --- | --- |
| 1627 | Thay thế. GET công khai, ghi cần phiên: `authenticate` theo từng route | public.ts |
| 1628 | Port. `getPublicAsset`: phải thuộc issue hiển thị trên board hoặc comment công khai (hoặc là ảnh comment của chính người xem). Plane chỉ lọc project | asset.ts |
| 1629 | Port. `createPublicAsset` (cần `is_comments_enabled`, chỉ `COMMENT_DESCRIPTION`, kích thước tối đa `FILE_SIZE_LIMIT`). Route `POST .../anchor/:anchor` và `.../:anchor/:pk` (pk bị bỏ qua như Plane) | asset.ts |
| 1630 | Port. `updatePublicAsset` | asset.ts |
| 1631 | Port. `deletePublicAsset` (xóa mềm) | asset.ts |
| 1632 | Port. `restorePublicAsset` | asset.ts |
| 1633 | Port. `bulkBindPublicAssets` | asset.ts |
| 1626 | Port. `isOwnBoardComment` (đặt ở `board.ts`) | board.ts |

`PATCH` và `DELETE .../assets/v2/anchor/:anchor/` không có pk không được đăng ký: ở Plane handler cần `pk` bắt buộc nên các route này luôn lỗi.

### cycle, label, meta, module, state

PD-1646, 1680, 1681, 1682, 1687 đã xong từ trước ([service.ts](../../../src/server/public/service.ts), test `worker.integration.mjs`). Chỉ export thêm `visibleBoard` và `resourceOnBoard` (chữ ký không đổi).

### intake.py

| PD | Kết quả | Code |
| --- | --- | --- |
| 1648 | Port. `listPublicIntakeIssues` (bộ lọc issue chuẩn, snooze trước rồi status). Chỉ trả phần do chính người gọi gửi; Plane trả mọi bài của intake cho bất kỳ user đăng nhập nào | intake.ts |
| 1649 | Port. `createPublicIntakeIssue`: state Triage (tạo nếu thiếu), `source = IN_APP`, priority mặc định `low`, HTML qua `sanitizeHtml` và `assertSafeDescriptionHtml`, sequence, version trong một batch D1; activity `issue.activity.created` qua queue. Intake trong URL phải là intake của board | intake.ts |
| 1650 | Port. `updatePublicIntakeIssue`: chỉ tác giả, chỉ name và mô tả. Khác Plane: chỉ khi status còn `-2` (đã duyệt hoặc từ chối thì 409 `INTAKE_ISSUE_LOCKED`) | intake.ts |
| 1651 | Port. `getPublicIntakeIssue` (404 với bài của người khác) | intake.ts |
| 1652 | Port. `deletePublicIntakeIssue`: xóa mềm cả intake issue lẫn work item (Plane chỉ xóa dòng intake, bỏ lại issue Triage). Chỉ khi status `-2` | intake.ts |
| 1647 | Thay thế. `ownIntakeIssues` (truy vấn có phạm vi board, intake, người tạo). Bộ lọc snooze của Plane không được dùng bởi `list` nên bỏ | intake.ts |

`GET`/`POST` có hai đường dẫn: `/inbox-issues` và `/intake-issues`. Mục `bridgeId` trong phản hồi là id intake issue dùng cho route `intake-issues/:pk`.

### issue.py

| PD | Kết quả | Code |
| --- | --- | --- |
| 1656 | Port. `getPublicProjectIssues`: phân trang, bộ lọc, `order_by`, `group_by`, `sub_group_by` qua `paginateIssues` của p1-issue-core. Có query thì trả envelope phân trang của Plane, không có query thì giữ mảng tóm tắt cũ (test cũ phụ thuộc) | issues.ts |
| 1657, 1658, 1659 | Gộp vào 1656 (callback tính giá trị nhóm và `on_results`: `paginateIssues` và `issueOnResults` của grouper) | issues.ts, grouper.ts |
| 1679 | Port. `getPublicIssueDetail` (id liên quan, `voteItems`, `reactionItems`, `descriptionHtml`, `descriptionJson`; không có `description_binary`). Vẫn trả các trường tóm tắt cũ | issues.ts |
| 1653 | Đã xong từ trước (`visibleIssues`); thêm `issueInBoardScope` ở board.ts | service.ts, board.ts |
| 1654 | Port. `commentInBoardScope`, `commentOnBoard`. Chặt hơn Plane: issue chứa comment cũng phải hiển thị trên board | board.ts |
| 1655 | Port. `publicCommentContent`; route nhận `text` hoặc `comment_html` (+ `comment_json`), HTML qua `sanitizeHtml`, khóa lạ bị từ chối 400 (`.strict()`, như test cũ) | board.ts, public.ts |
| 1660, 1661, 1664, 1665, 1666, 1662, 1663 | Comment công khai đã có từ trước. Mới: `createPublicComment` và `changePublicComment` nhận thêm tham số tùy chọn `content` (HTML đã làm sạch, JSON). 1662 đã tick từ trước. 1663 là `publicCommentsScope` | comments.ts |
| 1667, 1668 | Port. `listPublicIssueReactions` | engagement.ts |
| 1669 | Port. `createPublicIssueReaction` (trùng mã thì 400 `REACTION_EXISTS`; thêm `project_public_members` cho người không phải thành viên) | engagement.ts |
| 1670 | Port. `deletePublicIssueReaction` (theo mã, chỉ của mình, xóa mềm) | engagement.ts |
| 1671, 1672 | Port. `listPublicCommentReactions` (chỉ comment EXTERNAL) | engagement.ts |
| 1673 | Port. `createPublicCommentReaction` | engagement.ts |
| 1674 | Port. `deletePublicCommentReaction` | engagement.ts |
| 1675, 1676 | Port. `listPublicIssueVotes`. Plane lọc workspace theo `anchor` (lỗi), bản này theo board | engagement.ts |
| 1677 | Port. `createPublicIssueVote` (`vote` là 1 hoặc -1, gọi lại thì đổi phiếu) | engagement.ts |
| 1678 | Port. `deletePublicIssueVote` | engagement.ts |

### project.py

| PD | Kết quả | Code |
| --- | --- | --- |
| 1683 | Port. `getPublicBoardSettings` (`DeployBoardSerializer` rút gọn, không lộ id người tạo) | project.ts, presenters.ts |
| 1684 | Port. `listWorkspaceProjectBoards`. Code Plane không chạy được (`values_list` không gọi, tham số `anchor` thay vì `slug`), nên làm theo ý định: các project đã công bố của workspace theo slug, kèm `anchor` | project.ts |
| 1685 | Port. `getWorkspaceProjectAnchor` | project.ts |
| 1686 | Port. `listPublicBoardMembers`, chỉ `id`, `member`, `member__display_name`, `member__avatar` | project.ts |

### Model, serializer, grouper, base

| PD | Kết quả | Code |
| --- | --- | --- |
| 1386 | Port. `getAnchor` (token base64url 16 byte, khớp `publicBoardAnchorSchema`). `publishProject` hiện vẫn sinh anchor UUID hex bằng code cũ, chưa gọi hàm này | model-rules.ts |
| 1387 | Tham chiếu. `formatDeployBoard` | presenters.ts |
| 1618 | Ngoài phạm vi. `space/serializer/issue.py` không được view nào của space dùng (các view import `plane.app.serializers`). Quy tắc URL trùng của link đã nằm ở `issue/link.ts` (p1-issue-collab) | |
| 1619, 1620, 1621, 1622 | Ngoài phạm vi, cùng lý do. Public intake dùng schema Zod riêng `publicIntakeCreateSchema` và batch ở `intake.ts` | |
| 1623 | Gộp. Phân trang dùng chung áp dụng quy tắc board cho nhóm, nhóm con và các ID liên quan. Nhãn và module thuộc project của board, liên kết đã xóa bị loại, assignee cần là thành viên project hoạt động và module lưu trữ được loại khỏi nhóm công khai. | [grouper.ts](../../../src/server/public/grouper.ts), [issues.ts](../../../src/server/public/issues.ts), [filter.ts](../../../src/server/issue/filter.ts), [list.ts](../../../src/server/issue/list.ts) |
| 1624 | Port. `issueOnResults(db, results)`: thêm `voteItems` và `reactionItems` (kèm `actorDetails`, không có email) cho kết quả phẳng, nhóm hoặc nhóm con; bỏ `updatedBy`, `archivedAt`, `isDraft` | grouper.ts |
| 1625 | Port. `issueGroupValues(db, board, field)` ủy quyền `issueGroupValues` của p1-issue-core, cố định project của board | grouper.ts |
| 1634 | Thay thế. Không kích hoạt múi giờ theo user; thời gian trả dạng UTC ISO, client đổi múi giờ (cùng quyết định p1-platform PD-0061) | |
| 1635 | Port. `requireBoard`: anchor chỉ phục vụ project của nó | board.ts |
| 1636 | Thay thế. Mỗi service tự truy vấn có phạm vi board; `requireBoard` là điểm vào chung | board.ts |
| 1637, 1642 | Thay thế. `handleApiError` toàn cục (`ServiceError`, ZodError 400, ràng buộc D1 400) | |
| 1638, 1643 | Thay thế. Hono không cần `dispatch` riêng; lỗi đi qua `app.onError` | |
| 1639, 1640, 1644, 1645 | Thay thế. `c.req.param(...)` qua `parseInput` (`slug` ở `publicWorkspaceSlugSchema`, id ở `contentIdSchema`) | public.ts |
| 1641 | Thay thế. `issueFilters` và `buildFieldFilters` của p1 (dùng bên trong `paginateIssues` và `listPublicIntakeIssues`) | |

### Adapter DRF

PD-1660, 1661, 1667, 1671, 1675 là các mục `list` và `retrieve` ở bảng trên.

## (b) Route cần đăng ký vào `index.ts`

Không có thay đổi. `projectPublicationRoutes` (tại `linkto.apiProject`) và `publicRoutes` (tại `linkto.apiPublic`) đã được mount và vẫn là hai export cùng tên. Đường dẫn mới nằm trong cùng hai router. Có thêm export `publicBoardPaths` (tên đường dẫn tương đối dưới `linkto.apiPublic`).

Đường dẫn đầy đủ (tiền tố `/api/v1/public`):

| Nhóm | Đường dẫn |
| --- | --- |
| Board | `GET /anchor/:anchor/settings`, `/anchor/:anchor/members`, `GET /workspaces/:slug/project-boards`, `GET /workspaces/:slug/projects/:projectId/anchor` |
| Issue | `GET /anchor/:anchor/issues` (có query thì phân trang), `GET /anchor/:anchor/issues/:issueId` (chi tiết mới) |
| Reaction, vote | `GET/POST /anchor/:anchor/issues/:issueId/reactions`, `DELETE .../reactions/:reactionCode`, `GET/POST/DELETE .../issues/:issueId/votes`, `GET/POST /anchor/:anchor/comments/:commentId/reactions`, `DELETE .../reactions/:reactionCode` |
| Intake | `GET/POST /anchor/:anchor/intakes/:intakeId/inbox-issues` và `.../intake-issues`, `GET/PATCH/DELETE .../intake-issues/:pk` |
| Asset | `POST /assets/v2/anchor/:anchor`, `GET/POST/PATCH/DELETE /assets/v2/anchor/:anchor/:pk`, `PUT .../:pk/content`, `POST .../restore/:pk`, `POST .../:entityId/bulk` |
| Chủ board | `PATCH /workspaces/:slug/projects/:projectId/publication` (schema mở rộng) |

## (c) Schema ext

Không có bảng hoặc cột mới, không tạo `ext-p3-public.ts`. Không cần migration riêng của nhóm này. Giới hạn tần suất cần bảng `rate_limit_hits` của `ext-p1-platform.ts` (đã có trong handoff p1-platform). Thiếu bảng thì bộ giới hạn bỏ qua (fail-open), test chặn 429 trong `tests/p3-public.integration.mjs` sẽ không đạt.

Gợi ý index (không bắt buộc): `intake_issues(intake_id, created_by_id)` cho danh sách intake công khai; `issue_reactions(issue_id, actor_id)` đã có unique index nên đủ.

## (d) Key linkto cần thêm

Đang khai báo cục bộ trong `public.ts` (`publicBoardPaths`). Khi thêm vào `apiV1Routes`, chuyển sang đó:

```ts
publicBoardSettings: '/anchor/:anchor/settings',
publicBoardMembers: '/anchor/:anchor/members',
publicWorkspaceBoards: '/workspaces/:slug/project-boards',
publicWorkspaceProjectAnchor: '/workspaces/:slug/projects/:projectId/anchor',
publicIssueReactions: '/anchor/:anchor/issues/:issueId/reactions',
publicIssueReaction: '/anchor/:anchor/issues/:issueId/reactions/:reactionCode',
publicIssueVotes: '/anchor/:anchor/issues/:issueId/votes',
publicCommentReactions: '/anchor/:anchor/comments/:commentId/reactions',
publicCommentReaction: '/anchor/:anchor/comments/:commentId/reactions/:reactionCode',
publicInboxIssues: '/anchor/:anchor/intakes/:intakeId/inbox-issues',
publicIntakeIssues: '/anchor/:anchor/intakes/:intakeId/intake-issues',
publicIntakeIssue: '/anchor/:anchor/intakes/:intakeId/intake-issues/:pk',
publicAssets: '/assets/v2/anchor/:anchor',
publicAsset: '/assets/v2/anchor/:anchor/:pk',
publicAssetContent: '/assets/v2/anchor/:anchor/:pk/content',
publicAssetRestore: '/assets/v2/anchor/:anchor/restore/:pk',
publicAssetBulk: '/assets/v2/anchor/:anchor/:entityId/bulk'
```

## (e) Dependency, binding, env

- Dependency: không thêm.
- Binding: dùng `ASSET_BUCKET` (R2) và `JOBS_QUEUE` đã có. Không có job mới.
- Env tùy chọn (có thể thêm vào `.dev.vars.example`): `PUBLIC_ANON_RATE_LIMIT` (mặc định `120/minute`), `PUBLIC_WRITE_RATE_LIMIT` (mặc định `30/minute`), `FILE_SIZE_LIMIT` (đã có ở p2-asset).

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`, rồi `LANCITY_TEST_D1=... node --test tests/p3-public.integration.mjs` (cần `pnpm db:migrate:local` gồm bảng `rate_limit_hits`, R2 local) và chạy lại `tests/worker.integration.mjs` (phần public).
2. Dễ lỗi kiểu: `db.batch([...] as never)` trong `intake.ts` (`createPublicIntakeIssue`); handler `createAsset(c: Context)` đăng ký trên `Hono<ApiEnv>` (generic `Context`); `insert().select(sql...)` trong `engagement.ts` với `.returning(fields)`; `actor: { userId: 0 }` của `IssueListContext` trong `issues.ts`; `ownIntakeIssues` truyền `issueFilters(query)` (kiểu `FilterParams`) từ `Record<string, string | undefined>`; kiểu `Pick` của `publicCommentContent`.
3. `publishProject` chưa dùng `getAnchor` (tránh đổi định dạng anchor của board có sẵn). Dùng khi muốn đồng bộ với Plane.
4. Reaction công khai trả id người dùng (`actor`) như Plane, không trả tên. `voteItems` và `reactionItems` trong issue có `actorDetails` (tên, username, avatar), không có email. Cân nhắc ẩn nếu không muốn lộ username.
5. Chưa có Server Action cho board công khai (`src/app/**` ngoài phạm vi); service nhận `(db, actor, anchor, ...)` nên gọi trực tiếp được.
6. Intake công khai không gửi thông báo cho admin ngoài `notification: true` của job `issue.activity` (nhóm notification tiêu thụ).
7. Chưa xử lý job dọn asset bình luận chưa gắn sau khi upload dở: job `asset.delete_unuploaded` của p2-asset (cron 02:00 UTC) dọn bản ghi chưa upload sau 7 ngày. Asset đã upload nhưng chưa gắn comment (`comment_id` null) chưa có job dọn.
