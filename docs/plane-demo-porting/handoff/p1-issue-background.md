# Handoff p1-issue-background

Nhóm: `docs/plane-demo-porting/06-issue-background.md` (67 mục). Chưa chạy test, build, typecheck theo quy ước. ESLint và Prettier sạch trên các file bên dưới.

Test: [`tests/p1-issue-background.integration.mjs`](../../../tests/p1-issue-background.integration.mjs). Test dùng D1 giả trên `node:sqlite` (cùng cách với `tests/issue.test.mjs`), không cần Worker. Chạy bằng `pnpm exec tsx --test tests/p1-issue-background.integration.mjs`.

## (a) PD đã xong

Tất cả 67 mục đã xử lý, không có mục để trống.

| PD | Code | Ghi chú |
| --- | --- | --- |
| 1137 đến 1177 | [`jobs/issue-activities.ts`](../../../src/server/issue/jobs/issue-activities.ts) | Port từng tracker và `issueActivity`. Job `issue.activity`. |
| 1178 đến 1181 | [`jobs/issue-automation.ts`](../../../src/server/issue/jobs/issue-automation.ts) | Cron `0 1 * * *` (archive và close) và `*/5 * * * *` (unsnooze). |
| 1182, 1183, 1184 | [`jobs/issue-description-version-sync.ts`](../../../src/server/issue/jobs/issue-description-version-sync.ts) | `getOwnerId` re-export từ [`version/snapshot.ts`](../../../src/server/issue/version/snapshot.ts). |
| 1185, 1186, 1187 | [`jobs/issue-description-version.ts`](../../../src/server/issue/jobs/issue-description-version.ts) | Cửa sổ 600 giây, cùng user thì sửa version cuối. |
| 1188, 1189, 1196, 1197 | [`jobs/issue-version-sync.ts`](../../../src/server/issue/jobs/issue-version-sync.ts) | `issueTask` có cửa sổ 600 giây. |
| 1190 đến 1195 | gộp vào [`version/snapshot.ts`](../../../src/server/issue/version/snapshot.ts) | `getRelatedData`, bốn callback `groupby` và `createIssueVersion` được thay bằng một câu `insert ... select` (`json_group_array`, activity mới nhất, owner dự phòng). |
| 1231 đến 1236 | [`jobs/work-item-link.ts`](../../../src/server/issue/jobs/work-item-link.ts) | Crawl title và favicon. |

Đăng ký job: [`jobs/index.ts`](../../../src/server/issue/jobs/index.ts) (`register()`). API cho agent khác: [`activity/index.ts`](../../../src/server/issue/activity/index.ts).

### API cho các nhóm khác (thay `xxx.delay(...)` của Celery)

```ts
import { enqueueIssueActivity, enqueueIssueVersion, enqueueIssueDescriptionVersion, enqueueLinkCrawl, enqueueBulkSubscribers } from '@/server/issue/activity'
await enqueueIssueActivity(env, { type: 'issue.activity.updated', requestedData, currentInstance, issueId, actorId, projectId, epoch, notification: true })
```

Mọi ID là số tự tăng. `requestedData` và `currentInstance` nhận chuỗi JSON hoặc object. Các khóa giữ tên Plane (`name`, `state_id`, `assignee_ids`, `label_ids`, `comment_html`, ...). Kiểu `type` giống Plane (`issue.activity.created`, `comment.activity.updated`, ...). Zod: [`src/types/issue/p1-issue-background-schema.ts`](../../../src/types/issue/p1-issue-background-schema.ts).

### Job và hook

| Job | Việc |
| --- | --- |
| `issue.activity` | `issue_activity`. |
| `issue.version.update`, `issue.description_version.update` | `issue_task`, `issue_description_version_task`. |
| `issue.version.schedule`, `issue.version.sync`, `issue.description_version.schedule`, `issue.description_version.sync` | Backfill theo cửa sổ, tự xếp cửa sổ kế tiếp với `delaySeconds` = `countdown`. Kích hoạt bằng `enqueueIssueVersionBackfill`, `enqueueIssueDescriptionVersionBackfill` (thay management command). |
| `issue.link.crawl` | `crawl_work_item_link_title`. |
| `issue.subscribers.bulk` | Đăng ký nhiều subscriber cho một issue (bulk create ignore conflicts). |
| `issue.automation.archive_and_close`, `issue.automation.unsnooze_intake` | Chạy tay hai việc theo cron. |

Hook gửi đi (do agent khác xử lý):
- `notification.issue` (khi `notification: true`): payload `{ type, issueId, actorId, projectId, subscriber, issueActivitiesCreated, truncated, requestedData, currentInstance }`. `issueActivitiesCreated` là các dòng `issue_activities` vừa lưu. Nếu quá 100 KB (giới hạn Queue 128 KB) thì `oldValue` và `newValue` bị bỏ, `truncated: true`, consumer đọc lại theo `id`.
- `webhook.dispatch` (chỉ khi `webhook: true`, mặc định tắt vì Plane gọi `model_activity` riêng ở view): payload `{ source: 'issue.activity', type, issueId, projectId, workspaceId, actorId, activityIds }`. Agent webhook có thể đổi sang payload khác, chỉ cần sửa `dispatchHooks`.

### Khác Plane có chủ đích

- `track_estimate_points`: Plane ghép `"estimate_" + new_estimate.estimate.type` và lỗi khi gỡ estimate (cả task bị bỏ). Bản này dùng type của estimate cũ.
- `track_closed_to`: thiếu state thì bỏ qua thay vì lỗi cả task.
- `update_issue_activity`: hai khóa cùng tracker (`state_id` và `state`) chỉ chạy một lần.
- Activity quan hệ cross-project: dòng của issue liên quan dùng project của issue đó (khóa ngoại `issue_id, project_id` từ chối project hiện tại).
- Trước khi ghi, bỏ activity có issue hoặc comment không tồn tại (tránh batch lỗi và retry vô ích). Ghi activity trong một `db.batch` nguyên tử, mỗi câu 5 dòng (giới hạn 100 biến của D1).
- `close_old_issues`: khi project chưa có `default_state`, Plane lấy state `cancelled` đầu tiên của mọi project. Bản này lấy của chính project, không có thì bỏ qua project. `bulk_update` không đổi `updated_at`, bản này giữ nguyên `updated_at` khi archive và close.
- `sync_issue_version` và `sync_issue_description_version`: bỏ qua issue đã có version nên chạy lại không nhân đôi. Mặc định cửa sổ 1000 (Plane 5000, tối đa 5000).
- `validate_url_ip`, `safe_get`: Workers không có `getaddrinfo` và không ghim IP. Hostname được phân giải qua DNS over HTTPS của Cloudflare (`cloudflare-dns.com`), mọi bản ghi đều được kiểm tra, redirect kiểm tra từng bước (tối đa 5). Mạng Workers cũng không tới được dải private. BeautifulSoup được thay bằng `HTMLRewriter`.
- `issue_activity` không còn ghi Redis `origin` (Redis chưa dùng). Tham số `origin` và `intake` bị bỏ.
- `issueTask` chỉ so sánh trường vô hướng (name, priority, ngày, state, parent, estimate, type, ...). Plane gọi `getattr(issue, "assignee_ids")` cho trường quan hệ và lỗi; danh sách quan hệ vẫn có trong ảnh chụp đầy đủ khi tạo version mới.

## (b) Route cần đăng ký

Không có route.

## (c) Schema ext

Không có bảng hay cột mới. Chỉ dùng các bảng đã có (`issue_activities`, `issue_versions`, `issue_description_versions`, `issue_subscribers`, `issue_links`, `intake_issues`). Không cần migration.

## (d) Key linkto

Không có.

## (e) Dependency, binding, env

- Không có dependency mới. Cần binding `JOBS_QUEUE` (đã có từ Phase 0) và cron `*/5 * * * *` (đã có). Hai lịch của nhóm này (`0 1 * * *`, `*/5 * * * *`) đều rơi vào mốc 5 phút.
- `HTMLRewriter` và `fetch` ra ngoài có sẵn trong Workers. Cần outbound tới `cloudflare-dns.com`.
- `src/server/issue/jobs/index.ts` do `job-registry.ts` nạp bằng `import.meta.glob`.

## (f) Việc còn dang dở và việc integrator cần làm

1. Các service issue hiện đã ghi activity và version đồng bộ qua `history.ts` (`activityStatement`, `versionStatement`, `commentActivityStatement`). Đổi sang `enqueueIssueActivity` ở service là việc của nhóm issue (05). Nếu cả hai cùng chạy sẽ trùng activity. Tạo issue qua job (`issue.activity.created`) tự tạo dòng "created the issue" và activity assignee.
2. `enqueueLinkCrawl` chưa được route link gọi. Nhóm 05 nối khi tạo hoặc sửa URL.
3. Chạy `pnpm exec tsx --test tests/p1-issue-background.integration.mjs`, rồi `pnpm typecheck`. Các điểm cần soi: `db.batch` với `returning()` và ép kiểu tuple, `db.all` cho `insert ... returning` trên D1 thật, `HTMLRewriter` kiểu `workers-types`.
4. Chưa kiểm chứng thực tế: crawl title và favicon trên Worker thật, `delaySeconds` của Queues với backfill, lịch `0 1 * * *`.
5. Agent notification phải đăng ký handler `notification.issue` và agent webhook handler `webhook.dispatch`. Job chưa có handler chỉ bị bỏ và ghi log (`UnknownJobError`), không retry.
