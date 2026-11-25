# Handoff p3-integrations

Nhóm: `docs/plane-demo-porting/11-integrations.md` (48 mục). Chưa chạy test, build, typecheck theo quy ước. ESLint sạch trên mọi file bên dưới (đã chạy Prettier cho các file này).

Test: [`tests/p3-integrations.integration.mjs`](../../../tests/p3-integrations.integration.mjs). Dùng D1 giả trên `node:sqlite` (như `p1-issue-background.integration.mjs`), không cần Worker. Chạy: `pnpm exec tsx --test tests/p3-integrations.integration.mjs`. Test tự tạo bảng `user_security` tối thiểu vì migration của `ext-p1-auth` chưa có.

## (a) PD đã xử lý

Tất cả 48 mục đã xử lý, không có mục để trống. Đường dẫn đích trong checklist khác thực tế ở ba chỗ (ghi rõ bên dưới).

| PD | Kết quả | Code |
| --- | --- | --- |
| 0430, 0431, 0432, 0433 | Port `ApiTokenEndpoint`: `createApiToken`, `getApiToken` (một token) + `listApiTokens` (khi không có pk), `deleteApiToken` (xóa mềm), `updateApiToken` (chỉ `label`, `description`). Token trả về một lần, DB chỉ lưu SHA-256 (khác Plane lưu plaintext). `user_type` = 1 nếu `user_security.is_bot` | [`integration/api.ts`](../../../src/server/integration/api.ts), route [`api-tokens.ts`](../../../src/server/api/v1/routes/api-tokens.ts) |
| 0296 | Port `getIsActiveApiTokenRead` + `toApiTokenResponse` (`isActive` tính theo `expiredAt`, bỏ cờ lưu trong DB, giống Plane) | [`integration/presenters.ts`](../../../src/server/integration/presenters.ts) |
| 0002, 0003, 0004 và 0268, 0269, 0270 | Gộp hai bản giống nhau của `APIKeyAuthentication`. `getApiTokenApiKeyAuthentication` (đọc header `X-API-Key`), `validateApiTokenApiKeyAuthentication` (token tồn tại, `is_active`, chưa hết hạn, chưa xóa, user không bị `user_security.is_active = false`; ghi `last_used` tối đa 1 lần mỗi 60 giây), `authenticateApiKeyAuthentication`, thêm middleware Hono `apiKeyAuthentication` (đặt `actor` và `apiKeyAuthenticated`) và `apiKeyOrSessionAuthentication`. **Đích khác checklist:** `src/server/api-token/authentication.ts` (không phải `api/v1/middleware/api-token.ts`, vì `middleware.ts` của p1-platform đã chiếm tên đó) | [`api-token/authentication.ts`](../../../src/server/api-token/authentication.ts) |
| 1368, 1369 | Port `generateLabelToken` (uuid hex), `generateToken` (`plane_api_` + 64 hex) và thêm `hashApiToken` | [`integration/model-rules.ts`](../../../src/server/integration/model-rules.ts) |
| 1370, 1371 | `formatApiToken` (`str(user.id)`), `formatApiActivityLog` (`token_identifier`) | presenters.ts |
| 1408, 1409, 1410, 1411, 1412 | `formatGithubRepository`, `formatGithubRepositorySync`, `formatGithubIssueSync`, `formatGithubCommentSync`, `formatSlackProjectSync` là hàm thuần nhận dữ liệu đã join. Plane không có endpoint GitHub hay Slack nào, nên không có service cho các bảng này | presenters.ts |
| 0535, 0536, 0537 | Port `LLMProvider.get_config` (`getConfigLlmProvider`), `get_llm_config` (`getLlmConfig(db, env)`), `get_llm_response` (`getLlmResponse`). Gọi REST bằng `fetch` cho OpenAI, Anthropic và Gemini (SDK Python không dùng được trên Workers). Cấu hình đọc từ `instance_configurations` (hàng không mã hóa) rồi tới env | [`integration/llm.ts`](../../../src/server/integration/llm.ts), re-export ở [`integration/service.ts`](../../../src/server/integration/service.ts) |
| 0538, 0539 | Port `createGptIntegration` (admin/member của project, trả thêm `project_detail`, `workspace_detail`) và `createWorkspaceGPTIntegration` (admin/member của workspace). `response_html` được escape HTML trước khi đổi `\n` thành `<br/>` (Plane trả nguyên văn, dễ XSS) | service.ts, route [`integrations.ts`](../../../src/server/api/v1/routes/integrations.ts) |
| 0540 | Port `getUnsplash`. Không có `UNSPLASH_ACCESS_KEY` thì trả `[]`. Sửa lỗi của Plane: URL tìm kiếm có `page=$1`, và tham số không được encode (chèn được `&client_id=`). Khóa gửi qua header `Authorization: Client-ID` thay vì query. `per_page` tối đa 30 | service.ts |
| 0856, 0857, 0858, 0859, 0860, 0861 | Giữ nguyên chữ ký export của `createWebhook`, `getWebhook`, `listWebhooks`, `updateWebhook`, `deleteWebhook`, `rotateWebhookSecret`, `listWebhookLogs`. Thêm tham số cuối tùy chọn (`options`, `query`). `createWebhook`/`updateWebhook` kiểm tra URL bằng PD-0376. `updateWebhook` nhận thêm `isActive: boolean` (kiểu `WebhookPatch`). `listWebhookLogs` trả đủ trường như `WebhookLogSerializer` (header, body, retry) và hỗ trợ `limit`, `before` | [`webhook/service.ts`](../../../src/server/webhook/service.ts) |
| 0376 | `validateWebhookUrl(url, env, { requestHost, resolver })`: scheme, `localhost`, SSRF qua `validateUrl` của p1-platform (`WEBHOOK_ALLOWED_IPS`, `WEBHOOK_ALLOWED_HOSTS`), và `WEBHOOK_DISALLOWED_DOMAINS` + host của request (chống vòng lặp). Host không phân giải được thì cho qua lúc lưu (job gửi kiểm tra lại mỗi lần) | [`webhook/presenters.ts`](../../../src/server/webhook/presenters.ts) |
| 0377 | `toWebhookResponse`: `secretKey` chỉ có khi tạo và xoay vòng | presenters.ts |
| 0378, 0379 | Gộp vào `createWebhook`, `updateWebhook` | service.ts |
| 1507, 1508, 1509 | `generateToken` (giữ secret 64 hex đang phát hành, không dùng `plane_wh_` vì test `worker.integration.mjs` kiểm `^[a-f0-9]{64}$`), `validateSchema`, `validateDomain` | [`webhook/model-rules.ts`](../../../src/server/webhook/model-rules.ts) |
| 1510, 1511 | `formatWebhook`, `formatWebhookLog`, thêm `toWebhookLogResponse` | presenters.ts |
| 1224 | `getIssuePrefetches(db, issueIds)`: nhãn và assignee của issue bằng hai truy vấn (thay `Prefetch`) | [`webhook/jobs/delivery.ts`](../../../src/server/webhook/jobs/delivery.ts) |
| 1225 | `saveWebhookLog` (lỗi ghi log chỉ được ghi nhận, không làm hỏng việc gửi) | delivery.ts |
| 1226 | `getModelData(db, event, id, { many, workspaceId })` cho project, issue (kèm `labels`, `assignees`), cycle, module, cycle_issue, module_issue, issue_comment, intake_issue, user. Trường là snake_case theo tên cột. Có kiểm tra workspace. Chưa dùng đủ serializer của Plane (dữ liệu là hàng thô, không có expand khác) | delivery.ts |
| 1227 | `sendWebhookDeactivationEmail` qua `sendMail` (nạp lười để test chạy trong Node). Lỗi chỉ ghi log, giống Plane. Link `${site}/${slug}/settings/webhooks/${id}` giữ theo Plane, cần đối chiếu với route UI | delivery.ts |
| 1228 | `webhookSendTask` (job `webhook.send`): header `X-Plane-Delivery`, `X-Plane-Event`, `X-Plane-Signature` (HMAC-SHA256 hex), gửi qua `pinnedFetch` của p1-platform (SSRF, không theo redirect), đọc tối đa 10 KB phản hồi, ghi `webhook_logs`. Lỗi mạng: log 500, tạo job `webhook.send` mới với `retryCount + 1` và `delaySeconds` ngẫu nhiên 0 đến 600 (tương đương `retry_backoff=600` + jitter), sau lần thứ 6 thì tắt webhook và gửi email cho người tạo. URL bị từ chối (SSRF): log 400, không retry, không tắt. Trạng thái nằm ở `webhook_logs.retry_count`. **Khác Plane có chủ đích:** chữ ký tính trên đúng chuỗi byte gửi đi (Plane ký `json.dumps` nhưng gửi `json=` với dấu phân cách khác, người nhận không kiểm được); webhook đã tắt hoặc đã xóa trong lúc job chờ thì bỏ qua | delivery.ts |
| 1229 | `webhookActivity` (job `webhook.activity`): lọc webhook đang bật theo cờ sự kiện (`project`, `issue`, `module`, `cycle`, `issue_comment`), tạo một job `webhook.send` cho mỗi webhook. Dữ liệu tính một lần. Quá 90.000 ký tự thì không đính kèm, job gửi tải lại theo `eventRef` (Queue giới hạn 128 KB). Object hoặc actor đã mất thì thoát im lặng | delivery.ts |
| 1230 | `modelActivity` (job `webhook.model_activity`): không có `current_instance` thì `verb: created`; ngược lại mỗi khóa của `requested_data` có trong `current_instance` và khác giá trị (so sánh sâu, không phụ thuộc thứ tự khóa) thành một job `webhook.activity` với `verb: updated`. Thêm `dispatchIssueActivity` cho job `webhook.dispatch` | delivery.ts |

Đăng ký job: [`webhook/jobs.ts`](../../../src/server/webhook/jobs.ts) (`register()`), kiểm payload bằng Zod, payload sai thì bỏ và ghi cảnh báo (không retry). Hằng số: `WEBHOOK_JOB` (`webhook.send`, `webhook.activity`, `webhook.model_activity`, `webhook.dispatch`, `webhook.deactivation_email`). Zod: [`types/integration/p3-integration-schema.ts`](../../../src/types/integration/p3-integration-schema.ts).

Đích khác checklist: `jobs/delivery.ts` đúng đường dẫn checklist, nhưng `webhook/jobs.ts` nằm cạnh thư mục `webhook/jobs/` (không có `index.ts`, nên registry chỉ nạp `jobs.ts`).

### Payload job webhook (thống nhất với các nhóm khác)

- `webhook.model_activity` (project, cycle, module phát ra): `{ model_name, model_id, requested_data, current_instance, actor_id, slug }`. `requested_data` và `current_instance` nhận object hoặc chuỗi JSON. Khớp `emitCycleModelActivity` và `project/events.ts`.
- `webhook.activity` (project xóa, cycle xóa phát ra): `{ event, verb, field, old_value, new_value, actor_id, slug, event_id, old_identifier, new_identifier }`. Khớp `emitProjectEvent` và `emitCycleWebhook`. `actor_id`, `event_id` phải là số.
- `webhook.dispatch` (p1-issue-background, khi `webhook: true`): `{ source, type, issueId, projectId, workspaceId, actorId, activityIds }`. Xử lý `issue.activity.*` thành sự kiện `issue` và `comment.activity.*` thành `issue_comment`. Loại khác (cycle, module, link, ...) bị bỏ vì Plane không có webhook cho chúng.

### Lệch `event` và `type` giữa `emitIssueEvent` và `issueActivityJobSchema`

`emitIssueEvent` ([`issue/events.ts`](../../../src/server/issue/events.ts), p1-issue-core) gửi `event: 'created' | 'updated' | ...`, còn `issueActivityJobSchema` (p1-issue-background) bắt buộc `type` như `issue.activity.created`, và không biết `activityRecorded`. Handler `issue.activity` sẽ log "Invalid payload" và bỏ job, nên thông báo, subscriber và webhook của issue không chạy. Đề xuất, không sửa file của họ từ nhóm này:

1. p1-issue-background (bên nhận) chuẩn hóa payload: thêm `z.preprocess` đổi `event` thành `type` theo bảng `created` → `issue.activity.created`, `updated`, `archived`, `unarchived` → `issue.activity.updated`, `deleted` → `issue.activity.deleted`, và đọc `activityRecorded: true` để bỏ bước ghi `issue_activities` (hàng đã được ghi cùng batch), chỉ làm thông báo, subscriber và webhook.
2. Để webhook issue chạy, một trong hai nguồn (không dùng cả hai, sẽ gửi trùng): p1-issue-core và p1-issue-collab (comment) gửi `webhook.model_activity` với `model_name: 'issue'` hoặc `'issue_comment'` như Plane làm trong view; hoặc `emitIssueEvent` thêm `webhook: true` để job `issue.activity` đẩy `webhook.dispatch` (handler đã có ở đây). Khuyến nghị phương án đầu vì giữ đúng ngữ nghĩa Plane (`current_instance` cho phép diff từng trường).

Hiện tại `p1-issue-collab` chưa nối `model_activity` cho comment, `p2-intake-draft` cũng chưa.

## (b) Route cần đăng ký vào `index.ts`

Ba router, import từ `@/server/api/v1/routes/integrations` và một từ `@/server/api/v1/routes/api-tokens`:

```ts
import { apiTokensRoutes } from '@/server/api/v1/routes/api-tokens'
import { externalToolsRoutes, integrationsRoutes, projectIntegrationsRoutes } from '@/server/api/v1/routes/integrations'

app.route(linkto.users, apiTokensRoutes)            // /api/v1/users/api-tokens và /users/api-tokens/:tokenId
app.route(linkto.apiWorkspace, integrationsRoutes)  // đã có; thêm POST /workspaces/:slug/ai-assistant
app.route(linkto.apiProject, projectIntegrationsRoutes) // POST /workspaces/:slug/projects/:projectId/ai-assistant
app.route('/', externalToolsRoutes)                 // GET /api/v1/unsplash
```

`externalToolsRoutes` gắn `authenticate` theo từng route (không dùng `use('*')`) nên mount ở gốc không ảnh hưởng route khác; thứ tự mount không quan trọng. `integrationsRoutes` vẫn mount như hiện tại. Route `/me/...` không bị ảnh hưởng. Route API key ngoài (nhóm 12 nếu có) dùng: `externalApiView(apiKeyAuthentication)` từ [`api-token/authentication.ts`](../../../src/server/api-token/authentication.ts).

## (c) Schema ext

Không có bảng hay cột mới, nên không có `ext-p3-integrations.ts` và không cần migration. Trạng thái phân phối nằm ở `webhook_logs` (có sẵn), bộ đếm retry ở payload job.

Phụ thuộc: `createApiToken` và middleware xác thực đọc `user_security` (`ext-p1-auth.ts`, cột `is_bot`, `is_active`). Cần migration của p1-auth (`pnpm db:generate` theo ghi chú của họ) trước khi API token chạy thật. Đọc `instance_configurations` (`LLM_*`, `UNSPLASH_ACCESS_KEY`) dùng bảng có sẵn.

## (d) Key linkto cần thêm

Hiện route dùng hằng cục bộ `p3Paths` trong hai file route. Khi thêm vào `apiV1Routes` (rồi thay `p3Paths` bằng key):

- `apiTokens: '/api-tokens'`, `apiToken: '/api-tokens/:tokenId'` (mount ở `linkto.users`)
- `aiAssistant: '/ai-assistant'` (workspace), `projectAiAssistant: '/ai-assistant'` (project; hai key cùng giá trị nhưng mount khác nhau, có thể dùng một key)
- `unsplash: '/unsplash'`

Plane dùng `/webhooks/<pk>/regenerate/`, Lancity giữ `webhookSecret: '/webhooks/:webhookId/secret'` sẵn có.

## (e) Dependency, binding, env

- Dependency: không thêm. Binding: không thêm (`JOBS_QUEUE` có sẵn).
- Env tùy chọn (Secret hoặc biến thường), thêm vào `.dev.vars.example`: `WEBHOOK_ALLOWED_IPS` (CIDR, CSV), `WEBHOOK_ALLOWED_HOSTS` (CSV), `WEBHOOK_DISALLOWED_DOMAINS` (CSV), `LLM_API_KEY` (Secret), `LLM_PROVIDER` (`openai` mặc định, hoặc `anthropic`, `gemini`), `LLM_MODEL`, `UNSPLASH_ACCESS_KEY` (Secret). Các khóa này cũng đọc được từ `instance_configurations` nếu hàng không mã hóa. `BETTER_AUTH_URL` dùng làm `current_site` trong email và làm host bị chặn khi tạo webhook.
- Cần outbound tới `cloudflare-dns.com` (DoH của p1-platform), `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.unsplash.com`.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm exec tsx --test tests/p3-integrations.integration.mjs`, rồi `pnpm typecheck`. Điểm dễ lỗi: `getModelData` ép `getTableColumns(table)` về `Record<string, never>` để dùng `inArray/eq` với bảng tổng quát; `webhooks[flag]` trong `activeWebhooks`; `db.update(...).returning(columns)` trong `integration/api.ts`; `c.json(body as never, status as never)` trong `externalToolsRoutes`; kiểu `z.input` và `z.output` của `webhookSendJobSchema` ở `jobs.ts`.
2. Webhook tạo ra ở trạng thái **tắt** (hành vi có sẵn, test `worker.integration.mjs` kiểm `isActive === false`). UI phải gọi PATCH `{ isActive: true }` để bật; Plane tạo ở trạng thái bật. Nếu muốn giống Plane, đổi `isActive: false` trong `createWebhook` và sửa test đó.
3. `getModelData` trả hàng thô theo cột, chưa tái tạo đủ các serializer của Plane (`IssueExpandSerializer` có thêm trường tính toán). Người nhận webhook cần đối chiếu khi bật tính năng này.
4. Chưa kiểm chứng thực tế: gửi webhook qua `pinnedFetch` trên Worker (DNS qua DoH, rebinding), `delaySeconds` của Queue cho retry, gọi LLM và Unsplash thật, gửi email tắt webhook qua nodemailer.
5. Khóa API: token hiện chỉ so khớp theo băm, nên token đã import từ Plane (plaintext) không dùng được; cần băm lại khi import. Khóa chỉ gắn người dùng, chưa có giới hạn theo workspace (cột `workspace_id` bỏ trống như Plane khi tạo từ app).
6. Chưa có rate limit riêng cho `ai-assistant` (Plane cũng không có). Nên thêm `rateLimit` nếu mở cho người dùng thường.
7. Server Action cho trang cài đặt webhook và API token chưa tạo (ngoài sở hữu của nhóm này); service dùng chung được từ `src/app/<x>/actions.ts`.
8. `src/server/webhook/service.ts` import `getEnv` bằng `import()` động và bỏ qua lỗi khi không chạy trong Worker, nên test đơn vị truyền `options.env` trực tiếp.
