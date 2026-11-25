# Handoff i-wiring

Bước tích hợp: nối các route, schema, job và binding của các agent p0 đến p4. Chỉ chạy `pnpm lint` (sạch, không cảnh báo). Chưa chạy typecheck, build, test. Không git commit.

## 1. Route đã mount (`src/server/api/v1/index.ts`)

Middleware toàn cục, theo thứ tự: `requestLogger`, `readReplicaRouting`, `privateNoStore`, `protectCookieWrites`, `methodNotAllowed`. `app.onError(handleApiError)` và `app.notFound(handleNotFound)`. `anonRateLimit()` (30/phút theo IP) gắn riêng cho `POST /instances/admins/sign-in` và `sign-up`. Các route `/auth/*` và `/public/*` đã có bộ giới hạn riêng, nên không gắn thêm.

Mọi router có `use('*', authenticate)` chặn các route đăng ký sau nó cùng tiền tố (Hono chạy middleware theo thứ tự đăng ký). Vì vậy các route công khai đứng trước.

| # | Mount | Router | Ghi chú |
| --- | --- | --- | --- |
| 1 | `/`, `/health`, `/timezones`, `/workspace-slug-check` | inline | như cũ |
| 2 | `linkto.apiAuthExtra` (`/auth`) | `authExtraRoutes` | công khai, có `enforceAuthThrottle` |
| 3 | `linkto.apiLive` (`/live`) | `liveRoutes` | không `authenticate`; socket tự xác thực, hai route server-to-server dùng header `live-server-secret-key` |
| 4 | `linkto.apiAssets` (`/assets`) | `userAssetsRoutes` | `GET /static/:assetId` công khai |
| 5 | `linkto.workspaces` | `workspaceJoinRoutes`, `projectJoinPublicRoutes` | công khai, phải trước `workspacesRoutes` |
| 6 | `linkto.users` | `usersRoutes`, `apiTokensRoutes`, `notificationPreferencesRoutes`, `userWorkspaceInvitationsRoutes`, `workspaceUserRoutes`, `projectUserRoutes` | `/me/workspaces/invitations` đứng trước `/me/workspaces/:slug/...` |
| 7 | `linkto.workspaces` | `workspacesRoutes`, `workspaceInvitationsRoutes`, `workspacePreferencesRoutes`, `projectsRoutes`, `pagesRoutes`, `assetsRoutes` | |
| 8 | `linkto.apiProject` | `issueCollabRoutes`, `issuesRoutes`, `cyclesRoutes`, `modulesRoutes`, `estimatesRoutes`, `intakesRoutes`, `draftsRoutes`, `projectViewsRoutes`, `projectSearchRoutes`, `analyticsRoutes`, `exportsRoutes`, `importsRoutes`, `pdfRoutes`, `projectIntegrationsRoutes`, `projectPublicationRoutes` | `issueCollabRoutes` trước `issuesRoutes` |
| 9 | `linkto.apiWorkspace` | `issuesWorkspaceRoutes`, `workspaceViewIssuesRoutes`, `stickiesRoutes`, `notificationsRoutes`, `viewsRoutes`, `workspaceSearchRoutes`, `integrationsRoutes`, `workspaceCyclesRoutes`, `workspaceModulesRoutes`, `workspaceEstimatesRoutes`, `draftsWorkspaceRoutes`, `workspaceAnalyticsRoutes`, `workspaceExportsRoutes` | không có path trùng giữa các router này |
| 10 | `/` | `externalToolsRoutes` | `GET /unsplash`, authenticate theo từng route |
| 11 | `linkto.apiPublic` | `publicRoutes` | |
| 12 | `linkto.apiMaintenance` (`/instances/maintenance`) | `maintenanceRoutes` | `authenticate` + `requireInstanceAdmin`; trước `instancesRoutes` |
| 13 | `linkto.apiInstances` | `instancesRoutes` | |

Router không phải mount: `notificationsRoutes`, `stickiesRoutes`, `pagesRoutes` đã có sẵn.

### Trùng route đã giải quyết
- `routes/issues.ts`: xóa `GET/POST .../comments`, `PATCH/DELETE .../comments/:commentId` và `POST .../relations`, vì `issue-collab.ts` định nghĩa lại với schema rộng hơn. Đã bỏ import không còn dùng. Giữ `GET/DELETE relations`, link và subscriber (collab không định nghĩa các route này).
- `issuesWorkspaceRoutes` (`/issues/search`, `/issues/:identifier`) và `workspaceViewIssuesRoutes` (`GET /issues`) khác path nên không đụng nhau.

### Trang web chưa tạo
`/workspace-invitations`, `/projects/invitations` (đã có), `src/app/not-found.tsx` (PD-0521 phần UI). Tôi không thêm `publicPaths` cho `/workspace-invitations` vì trang chưa tồn tại.

## 2. `src/data/linkto.ts`
- `linkto`: thêm `apiMaintenance`, `apiAuthExtra`, `apiLive`, `apiAssets`, `workspaceInvitations`, `projectInvitations`.
- `apiV1Routes`: thêm khoảng 190 key (instance*, apiTokens, aiAssistant, unsplash, collab, issue core, project, workspace, estimate, intake, draft, module, cycle, analytics, asset, public board, view, search, live*, maintenance*, export/import, pdf, `currentUserEmail...`, `apiAuthExtra`). Không có key trùng tên khác giá trị (script kiểm tra trước khi ghi).
- Các hằng cục bộ đã đổi sang tham chiếu `apiV1Routes.<key>` (giữ tên hằng và export): `p3Paths` (instances, integrations, api-tokens), `issueCollabPaths`, `coreRoutes`/`workspaceCoreRoutes` (issues), `projectApiRoutes`, `workspaceApiRoutes`, `estimateRoutes`, `intakeRoutes`, `draftRoutes`, `moduleRoutes`, `paths` (cycles, analytics, maintenance, exports, imports, pdf), `pagePaths`, `assetPaths`, `boardPaths` (public), `p3ViewRoutes`, `p3SearchRoutes`, `livePaths`, và các hằng trong `users.ts`.
- `workspaceInvitationPage` và `PROJECT_INVITATION_PATH` dùng `linkto`.
- Giữ nguyên: đường dẫn viết thẳng trong `auth-extra.ts` (`/config`, `/email-check`...), vì không có tên chung hữu ích. Một vài comment cũ ("kept here until the integrator...") ở `drafts.ts`, `intakes.ts`, `issues.ts` chưa dọn.
- Hai key tên `descriptionVersions`/`descriptionVersion` thuộc issue; của intake đổi tên `intakeDescriptionVersions`/`intakeDescriptionVersion`.

## 3. Schema và migration
- `src/db/schema.ts` export thêm 8 file `ext-*`: p1-auth, p1-platform, p2-cycle, p2-notification, p3-analytics, p3-export, p3-instance, p4-maintenance. Không trùng tên export hoặc tên bảng (kiểm bằng grep).
- Sinh `drizzle/0003_backend_extensions.sql` (+ `meta/0003_snapshot.json`, `_journal.json`) bằng `pnpm db:generate --name backend_extensions`, không hỏi tương tác. SQL chỉ có 10 `CREATE TABLE` và index: `auth_counters`, `user_security`, `cache_entries`, `rate_limit_hits`, `cycle_progress_snapshots`, `notification_email_locks`, `analytic_exports`, `import_jobs`, `instance_job_state`, `maintenance_runs`. Không có DROP hay ALTER.
- Tôi thêm vào cuối file SQL một câu backfill: `INSERT OR IGNORE INTO user_security (user_id) SELECT id FROM user`. Chưa áp migration lên D1 (chưa chạy `pnpm db:migrate:local`).
- Chưa tạo các index gợi ý (issues, intake, view) vì handoff ghi không bắt buộc.

## 4. Worker, Cloudflare, env
- `src/worker.ts`: `export { CollaborationDO }`. Yêu cầu WebSocket tới `/api/v1/live/collaboration` (header `Upgrade: websocket`) đi thẳng vào `handleCollaborationConnection`, không qua Hono, để `privateNoStore` không làm mất response 101. Các request khác đi qua Vinext như cũ. Chưa thử trên `pnpm dev`.
- Job registry (`import.meta.glob`) nạp đủ 17 file jobs: analytics, asset, cycle, export, identity, import, instance, issue, maintenance, notification, page, pdf, platform, project, webhook, workspace. Không cần sửa registry.
- `cloudflare.config.ts` (đối chiếu `@cloudflare/config` 1.0.0-rc.2, `public-*.d.mts`):
  - `exports: { CollaborationDO: exports.durableObject({ storage: 'sqlite' }) }`.
  - `COLLABORATION: bindings.durableObject({ worker: 'lancity', exportName: 'CollaborationDO' })`.
  - `BROWSER: bindings.browser()` (helper có thật).
  - Khi chưa có `CLOUDFLARE_D1_DATABASE_ID` (dev), khai thêm secret `LIVE_SERVER_SECRET_KEY`, `INSTANCE_ENCRYPTION_KEY`, GitHub/GitLab/Gitea, `LLM_API_KEY`, `UNSPLASH_ACCESS_KEY` và danh sách biến tùy chọn (URL, rate limit, retention...) để Vite plugin nạp từ `.dev.vars`. Trên production phải tự đặt trong Variables and Secrets.
- `.dev.vars.example`: thêm các biến mới có chú thích. Biến tùy chọn để dạng comment.
- `package.json`: thêm script `db:import-plane` và `maintenance` (dùng `tsx`; `tsx` có trong `node_modules/.bin` nhưng không khai trong `package.json`, xem mục "Còn lại").

## 5. Lệch liên agent đã sửa
1. **Activity trùng**: `issueActivityJobSchema` (`src/types/issue/p1-issue-background-schema.ts`) nhận `type` hoặc `event`, ánh xạ `event` thành `type` (`created/updated/deleted` thành `issue.activity.*`; `archived/unarchived` thành `issue.activity.updated`, như Plane). Thêm `activityRecorded`. Trong `issueActivity` (`jobs/issue-activities.ts`), khi `activityRecorded` là true, job không ghi activity nữa. Nó đọc lại các hàng service vừa ghi (cùng issue, project, actor, cột `epoch` trong khoảng 5 giây trước đến 1 giây sau epoch của job) rồi chạy notification và webhook. Giới hạn: hai thao tác của cùng người trên cùng issue trong 5 giây có thể làm thông báo của thao tác sau lặp lại hàng của thao tác trước.
2. **Webhook một nguồn**: `emitIssueEvent` gửi thêm `webhook: true`; nguồn webhook của issue chỉ là `webhook.dispatch` do job `issue.activity` đẩy ra. Không có service nào khác đẩy webhook issue.
3. **Seed workspace**: `enqueueWorkspaceSeed` đẩy `maintenance.workspace_seed`. Handler `workspace.seed` giữ lại để tiêu thụ tin nhắn cũ và gọi `workspaceSeed` (idempotent). `seedWorkspace` cũ trong `workspace/seed.ts` còn lại nhưng không dùng nữa.
4. **Crawl link**: `issue/link.ts` đẩy `issue.link.crawl` (`ISSUE_JOB.linkCrawl`) với payload `{ id, url }`, khớp handler và schema. Trước đó tên job (`issue.crawl_work_item_link_title`) và trường (`linkId`) đều lệch.
5. **Tên job và handler**: đã đối chiếu mọi hằng job với `registerJobHandler`. Tất cả khớp: `issue.*`, `notification.issue`, `webhook.{activity,model_activity,dispatch,send,deactivation_email}`, `asset.{copy_s3_objects,storage_metadata,delete_unuploaded}`, `cycle.*`, `page.*`, `project.send_mail`, `identity.send_mail`, `workspace.*`, `export.*`, `import.issues`, `analytics.*`, `pdf.*`, `instance.push_metrics`, `platform.purge_tables`, `maintenance.*`. Không còn job được đẩy mà thiếu handler.
6. **Cron trùng**: `registerScheduled` khử trùng theo (cron, tên). Các lịch trùng giờ (`15 3`, `45 2`, `*/5`) có tên khác nhau nên đều chạy, song song trong cùng lần kích hoạt.

## 6. Còn lại
- Chạy `pnpm db:migrate:local`, rồi typecheck, build, test (bước sau). Nhiều handoff nêu điểm dễ lỗi kiểu (`db.batch` ép tuple, `insert().select(sql)`, `drizzle(env.DB, { schema })`...). Schema job đổi sang `.refine().transform()` có thể ảnh hưởng nơi dùng `z.input<typeof issueActivityJobSchema>`.
- Kiểm tra bằng `pnpm dev`: WebSocket editor (đường intercept ở `worker.ts`), vòng DO, Browser Rendering (cần chạy remote), gửi mail nodemailer, và `export default` object của `worker.ts` với Vinext (p0-infra mục 3).
- Test cũ có thể gãy do route thay đổi: comment/relation (nay do collab xử lý), `tests/worker.integration.mjs`, `planning*.mjs`, `notification-views.integration.mjs`.
- Nối `deleteRecord` với `enqueueSoftDeleteRelated` (p4-maintenance): các service issue vẫn xóa mềm trực tiếp, không dùng `deleteRecord`, nên `maintenance.soft_delete_related` chưa được ai đẩy.
- p1-issue-collab đề xuất `syncIssueMentions` gọi từ `createIssue`/`updateIssue`, và các nơi phát thông báo mention/comment/reaction: chưa nối.
- p1-auth: `createAuth()` đồng bộ nên provider GitHub/GitLab/Gitea chỉ cấu hình trong DB chưa đăng ký; `settings.ts` chưa đọc `*_CLIENT_SECRET` mã hóa của nhóm instance. p3-instance: hook đăng ký chặn khi `ENABLE_SIGNUP=0` cũng chặn đăng ký admin đầu tiên.
- p2-asset: `presentCurrentUser` và presenter workspace/project cần dùng `assetUrl`; page duplicate cần gọi `enqueueCopyS3Objects`.
- p2-cycle/module: thêm `cycle`, `module` vào `recentVisitEntitySchema` rồi bỏ ép kiểu.
- Tạo queue `lancity-jobs` và `lancity-jobs-dlq` trước lần deploy đầu. Đặt secret `LIVE_SERVER_SECRET_KEY` (ít nhất 16 ký tự) và `INSTANCE_ENCRYPTION_KEY` trên production.
- `tsx` chưa khai trong `package.json` (chỉ có qua phụ thuộc gián tiếp). Cần chủ dự án duyệt trước khi thêm dependency.
- Chưa có UI: `not-found.tsx`, trang `/workspace-invitations`, nút tải PDF, Server Action cho các nhóm mới.
