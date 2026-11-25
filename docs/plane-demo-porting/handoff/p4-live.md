# Handoff p4-live

Nhóm 14 (`docs/plane-demo-porting/14-live.md`), phần Live: WebSocket cộng tác, đồng bộ Yjs, lưu tài liệu, đồng bộ tiêu đề, force close, stateless, health, `convert-document`. Không gồm PDF (`pdf-export`, `lib/pdf/*`, `services/pdf-export/*`: thuộc p4-pdf).

Chưa chạy test, build, typecheck theo quy ước. ESLint sạch trên mọi file liệt kê dưới đây.

## Thiết kế

Một Durable Object (SQLite) cho mỗi page thay cho Hocuspocus và Redis.

- Worker `GET /live/collaboration` ([socket.ts](../../../src/server/collaboration/socket.ts)): kiểm tra `Origin`, lấy phiên Better Auth từ cookie của request upgrade, gọi `getPageLiveAccess` (action `view`) cho **mỗi** kết nối, rồi chuyển socket sang DO của page kèm header tin cậy (`x-live-*`, các header do client gửi bị xóa trước). Mọi lỗi xác thực trả về dạng Hocuspocus: socket tạm nhận tin Auth đầu tiên, trả `PermissionDenied` rồi đóng 4403/4401, để provider không rơi vào vòng lặp reconnect.
- DO [collaboration-do.ts](../../../src/server/live/collaboration-do.ts): giao thức Hocuspocus v3 tối thiểu trên `yjs` + `y-protocols` ([hocuspocus.ts](../../../src/server/collaboration/hocuspocus.ts)): Auth, Sync/SyncReply, Awareness, QueryAwareness, Stateless, BroadcastStateless, CLOSE, SyncStatus. Dùng WebSocket Hibernation API. Token đầu tiên `{ id, cookie? }` phải khớp user của phiên (Plane: `AUTH_USER_MISMATCH`).
- Lưu: mỗi update ghi vào SQLite của DO (bảng `yjs_updates`, `yjs_snapshot`), nên sống sót qua eviction. D1 được ghi bằng alarm tối đa 10 giây một lần (Hocuspocus `debounce: 10000`) và khi client cuối ngắt kết nối, qua `updatePagesDescription` của p2-page với actor là người sửa gần nhất (nên quy tắc khóa, lưu trữ, quyền ghi vẫn áp dụng). Khi tải, ưu tiên state còn trong DO, nếu không thì đọc D1 (`getPagesDescription`); page chưa có binary thì dựng từ `description_html` và tên rồi ghi lại (như `fetchDocument` của Plane). Hết client thì lưu, xóa storage của DO và unload, nên lần tải sau thấy thay đổi qua REST.
- Tiêu đề: observer trên field `title`, debounce 5 giây, lưu bằng `updatePage` với credential của kết nối vừa sửa.
- Codec ([codec.ts](../../../src/server/collaboration/codec.ts)): Plane dựng HTML/JSON/binary bằng TipTap schema và DOM. Workers không có DOM nên codec tự ánh xạ tên node/mark của editor (`paragraph`, `heading`, `bulletList`, `taskItem`, `imageComponent`, `mention`, `calloutComponent`, bảng, bold/italic/link/highlight/textStyle...).
- Redis: không cần. Pub/sub, khóa phân tán, kênh admin và `waitForRedisReady` đều thay bằng việc mọi client của một page nối vào cùng một DO.

## (a) PD đã xử lý

Test: [`tests/p4-live.test.ts`](../../../tests/p4-live.test.ts) (đơn vị, `tsx --test`) và [`tests/p4-live.integration.mjs`](../../../tests/p4-live.integration.mjs) (cần Worker có route mount và binding DO, xem mục (b), (e)).

| PD | Kết quả | Code |
| --- | --- | --- |
| 0731 | Đã tick từ trước. `getPageLiveAccess` không đổi chữ ký; thêm `authorizePage` bọc nó cho socket | [access.ts](../../../src/server/collaboration/access.ts) |
| 2043, 2044, 2045 | Port. Tiếp nhận kết nối: Worker xác thực rồi đẩy sang DO; vòng đời socket là các handler Hibernation của DO | [socket.ts](../../../src/server/collaboration/socket.ts), [collaboration-do.ts](../../../src/server/live/collaboration-do.ts), hocuspocus.ts |
| 2046-2049 | Port. `convertDocument`: validate (`validationErrors` đúng định dạng Plane), HTML sang JSON và binary base64. `variant` `rich` và `document` dùng chung codec | [document.ts](../../../src/server/collaboration/document.ts), [codec.ts](../../../src/server/collaboration/codec.ts) |
| 2050 | Gộp vào PD-2041. Vẫn có `GET /live/health` trả `{ status, timestamp, version }` | [routes/live.ts](../../../src/server/api/v1/routes/live.ts), [runtime.ts](../../../src/server/collaboration/runtime.ts) (`healthStatus`) |
| 2060 | Port thành `validateEnv` (đọc binding thay `process.env`; giá trị sai quay về mặc định thay vì dừng Worker) | runtime.ts |
| 2061, 2062, 2063 | Port. `fetchDocument` (kể cả dựng binary từ HTML rồi ghi lại), `storeDocument` (quá 10 MB thì thông báo `content_too_large`, force close, không ném lỗi). Phần "extension Database" là các hàm DO gọi | [persistence.ts](../../../src/server/collaboration/persistence.ts), collaboration-do.ts |
| 2064-2075 | Port. `handleForceCloseCommand` (gửi stateless `force_close`, chờ 50 ms, đóng socket) và `forceCloseDocumentAcrossServers` (gọi handler rồi unload). Không còn "server khác" nên bỏ publish và bước chờ 800 ms. Từ nơi khác: `forceCloseLivePage` | [force-close-handler.ts](../../../src/server/collaboration/force-close-handler.ts), runtime.ts |
| 2076 | Thay thế. `getExtensions` chỉ còn TitleSync; Logger, Redis là hạ tầng khác, Database và ForceClose do DO gọi | [index.ts](../../../src/server/collaboration/index.ts) |
| 2077, 2078 | Port thành `liveLog` (JSON một dòng) | [logger.ts](../../../src/server/collaboration/logger.ts) |
| 2079-2086 | Thay thế bằng DO. `publishAdminCommand` là `forceCloseLivePage`; `onAdminCommand` là endpoint nội bộ `/force-close` của DO; `broadcastToDocument` là `broadcastMessageToPage` (trong DO) và `broadcastToLivePage` (từ ngoài); `onConfigure`, `onDestroy`, `handleAdminMessage` không còn đối tượng | runtime.ts, [broadcast-message.ts](../../../src/server/collaboration/broadcast-message.ts) |
| 2087-2092 | Port. Di trú title cũ vào field `title`, observer, lưu theo kết nối gây ra thay đổi, flush trước khi unload, gỡ observer. Nhánh thông báo page cha của Plane không bao giờ chạy (`parentId` không được gán) nên không port | [title-sync.ts](../../../src/server/collaboration/title-sync.ts) |
| 2093-2112 | Port nguyên `DebounceManager`. `schedule` gộp ba nhánh trùng nhau thành một | [debounce.ts](../../../src/server/collaboration/debounce.ts) |
| 2113-2117 | Port `TitleUpdateManager` | [title-update-manager.ts](../../../src/server/collaboration/title-update-manager.ts) |
| 2118 | Port (`stripTags` của p2-page thay DOMPurify) | [title-utils.ts](../../../src/server/collaboration/title-utils.ts) |
| 2119-2123 | Thay thế. Singleton `HocusPocusServerManager` không còn nghĩa: một DO là một server. Lớp tương ứng là `CollaborationDocument` | hocuspocus.ts, collaboration-do.ts |
| 2124 | Port thành `verifySecretKey` (so sánh hằng thời gian, khóa chưa cấu hình thì từ chối hết) và `requireSecretKey` trong route | access.ts, routes/live.ts |
| 2125, 2126, 2127 | Port. `onAuthenticate` là Worker (phiên + `authorizePage`) cộng `authenticate` của DO (`checkAuthToken`); `handleAuthentication` so id của token với user phiên. Cookie trong token không dùng (phiên lấy từ request upgrade) | access.ts, socket.ts, collaboration-do.ts |
| 2128-2141 | Port `drainCollaborationServer` (đóng client, lưu, unload trước deadline) và `withinShutdownDeadline`. Worker không nhận SIGTERM nên gọi qua `/drain` nội bộ | runtime.ts |
| 2142 | Port `AppError` (+ `AppError.from` thay shortcut trả về của constructor) | [errors.ts](../../../src/server/collaboration/errors.ts) |
| 2216 | Port `onStateless` (map sự kiện server sang client, chặn kết nối chỉ đọc) | [stateless.ts](../../../src/server/collaboration/stateless.ts) |
| 2217-2242 | Ngoài phạm vi vì không còn Redis: `RedisManager`, `waitForRedisReady`, `getRedisClient`, retry, get/set/del/expire | (không có) |
| 2243-2257 | Thay thế: Express, helmet, nén, body parser, 404, `listen`, `destroy` là Worker + Hono; CORS là `allowedOrigins`/`isAllowedOrigin` (kiểm tra `Origin` của socket, vì socket dùng cookie) | runtime.ts, routes/live.ts, socket.ts |
| 2258-2287 | Gộp vào service tài liệu: `APIService`, interceptor, header, HTTP verb không còn vì gọi thẳng service page với actor. `fetchDetails`, `fetchDescriptionBinary`, `updatePageProperties` (bỏ qua nếu đã abort), `updateDescriptionBinary`, `fetchUserMentions` (từ `page_logs` `user_mention`), `resolveImageAssetUrl(s)` (trả đường dẫn `assetUrl`, không có presigned URL), `getPageService` | document.ts |
| 2331-2336 | Port: `currentUser` thành `getLiveUser`; `getPageAccess` thành `authorizePage` (404 sang `AUTH_PAGE_ACCESS_DENIED`) | access.ts |
| 2337-2341 | Thay thế `start.ts`: không có tiến trình, tín hiệu hay xử lý lỗi toàn cục | (không có) |
| 2342-2345 | Port | [admin-commands.ts](../../../src/server/collaboration/admin-commands.ts) |
| 2346, 2347, 2348 | Port. `createRealtimeEvent` của editor cũng có ở đây | [broadcast-error.ts](../../../src/server/collaboration/broadcast-error.ts), broadcast-message.ts |

PD để trống: 2051-2059, 2143-2215, 2288-2330 (PDF, thuộc p4-pdf). PDF dùng lại `PageDocumentService.fetchDescriptionBinary`, `fetchUserMentions`, `resolveImageAssetUrls` (PD-2273, 2280, 2281-2284); p4-pdf cần import từ `@/server/collaboration/document`.

Ngoài ra PD-1101 (08-content, contract `/live/convert-document/` mà tác vụ sao chép asset gọi) đã có converter: `convertDocument` / `convertHtmlDocumentToAllFormats`. Handler `asset.copy_s3_objects` nên gọi hàm này trực tiếp thay vì HTTP.

### Khác Plane có chủ đích

- Tên document là id page (số). Provider phải truyền `pageId` trong `parameters` (Hocuspocus không đưa tên document lên URL, mà Worker cần nó để chọn DO): `parameters: { workspaceSlug, documentType: 'project_page', pageId }`. Đây là thay đổi phía editor.
- `BroadcastStateless` từ client chỉ chạy với kết nối ghi được (Plane cho mọi kết nối).
- Update của client không gửi ngược lại cho chính client đó (Hocuspocus gửi cho mọi kết nối).
- Interval kiểm tra awareness lỗi thời bị tắt để DO ngủ được; trạng thái awareness bị xóa khi socket đóng.
- `description_json` không có thuộc tính mặc định của schema TipTap (Plane lấy từ `toJSON()` của node ProseMirror có schema).
- `resolveImageAssetUrl` trả đường dẫn API của asset (Lancity không có redirect 302 tới presigned URL).
- Quá 200 kết nối trên một page trả 503.

## (b) Route cần đăng ký vào `index.ts`

File `src/server/api/v1/routes/live.ts` export `liveRoutes` (và `default`). Thêm:

```ts
import liveRoutes from '@/server/api/v1/routes/live'
// ...
app.route('/live', liveRoutes) // => /api/v1/live/health, /collaboration, /convert-document, /force-close
```

Route không dùng `authenticate`: socket tự xác thực, hai route server-to-server dùng header `live-server-secret-key`. Đừng bọc chúng bằng middleware bắt buộc phiên.

Khuyến nghị: Hono `privateNoStore` gọi `c.header(...)` sau `next()`, có thể làm mất `webSocket` của response 101. Nếu vậy, chặn đường dẫn socket trước Hono trong `src/worker.ts` (snippet ở mục (e)). Cần thử trên `pnpm dev`.

## (c) Schema ext

Không có bảng mới, nên không tạo `ext-p4-live.ts` và không cần migration Drizzle. State tạm nằm trong SQLite của Durable Object (`yjs_updates`, `yjs_snapshot`, kv `meta`/`editor`), không thuộc D1.

## (d) Key linkto cần thêm

`routes/live.ts` hiện giữ hằng số `livePaths` cục bộ. Đề xuất:

- `linkto.apiLive: '/live'` (điểm mount, hoặc dùng literal như trên)
- `apiV1Routes.liveHealth: '/health'`, `liveCollaboration: '/collaboration'`, `liveConvertDocument: '/convert-document'`, `liveForceClose: '/force-close'` (nằm trong router `/live`, nên không trùng key hiện có)

## (e) Dependency, binding, env

Dependency: đã chạy `pnpm add yjs y-protocols lib0` (`package.json`/`pnpm-lock.yaml` đã đổi): `yjs` 13.6.33, `y-protocols` 1.0.7, `lib0` 0.2.120. Cảnh báo peer `eslint` của pnpm có từ trước.

`src/worker.ts`:

```ts
export { CollaborationDO } from '@/server/live/collaboration-do'
// tùy chọn, nếu Hono làm mất response 101:
import { handleCollaborationConnection } from '@/server/collaboration/socket'
import { linkto } from '@/data/linkto'
// trong fetch(request, env, ctx), trước app.fetch:
//   if (new URL(request.url).pathname === `${linkto.apiV1}/live/collaboration`) return handleCollaborationConnection(request, env as LiveEnv)
```

`cloudflare.config.ts` (`exports` lấy từ `cf/config`, cùng nơi với `bindings`; `storage: 'sqlite'` sinh migration `new_sqlite_classes`, cấu hình tương đương wrangler: `{ "tag": "v1", "new_sqlite_classes": ["CollaborationDO"] }`):

```ts
import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config'
// trong defineWorker({ ... }):
exports: { CollaborationDO: exports.durableObject({ storage: 'sqlite' }) },
// trong env: { ... }
COLLABORATION: bindings.durableObject({ worker: 'lancity', exportName: 'CollaborationDO' }),
// trong khối secret (khi không có CLOUDFLARE_D1_DATABASE_ID):
LIVE_SERVER_SECRET_KEY: bindings.secret(),
```

Chưa kiểm chứng chữ ký `exports`/`worker` với `@cloudflare/config` 1.0.0-rc.1 ngoài file `.d.mts` (đã đối chiếu kiểu `exports.durableObject({ storage: 'sqlite' })` và `bindings.durableObject({ worker, exportName })`).

Env:

| Tên | Loại | Ghi chú |
| --- | --- | --- |
| `LIVE_SERVER_SECRET_KEY` | Secret, tối thiểu 16 ký tự | Bắt buộc cho `convert-document` và `force-close`. Thiếu thì hai route trả 401 |
| `LIVE_CORS_ALLOWED_ORIGINS` | tùy chọn, danh sách phân cách dấu phẩy | Thêm origin được mở socket. Origin của `BETTER_AUTH_URL` luôn được phép |
| `APP_VERSION` | tùy chọn | Hiển thị ở `/live/health` |

Thêm vào `.dev.vars.example`: `LIVE_SERVER_SECRET_KEY=` (kèm ghi chú tạo bằng `openssl rand -hex 32`).

Với `InfraEnv` (`src/server/common/env.ts`): type `LiveEnv` nằm ở `runtime.ts` (mở rộng `InfraEnv`), nên không cần sửa file của p0.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`. Chỗ dễ lỗi: `body.reason as ForceCloseReason` và `body.code as CloseCode` (ép literal/số sang enum) trong `routes/live.ts` và DO; `this.ctx.storage.kv` và `sql.exec<{ data: ArrayBuffer }>` trong DO (phụ thuộc phiên bản `@cloudflare/workers-types`); `Y.YEvent<Y.XmlFragment>[]` trong `title-sync.ts`; `ws.serializeAttachment`/`deserializeAttachment`; `updatePage(..., { name })` kiểu `UpdatePageValues` trong `document.ts`; `descriptionJson` ép sang `PageDescriptionBody['descriptionJson']`.
2. Chạy `pnpm exec tsx --test tests/p4-live.test.ts`. Các phép thử giao thức dùng socket giả; chưa chạy nên một số khẳng định (ví dụ thứ tự khung trả lời SyncStep1, cấu trúc HTML bảng) có thể cần chỉnh.
3. Kiểm chứng trên Worker thật bằng editor Plane: đồng bộ hai tab, con trỏ (awareness), người chỉ đọc không sửa được, force close, page bị khóa hoặc lưu trữ (lưu thất bại thì client nhận thông báo lỗi `store`), DO hibernate rồi nối lại. Chưa kiểm chứng: DO SQLite (`yjs_snapshot` chia hàng 1,5 MB, `Y.mergeUpdates`), alarm, hibernation, và `ws.close` với mã 1011/1001.
4. Codec dựa vào tên node/mark suy ra từ renderer PDF và schema editor. Tài liệu có node lạ được xuất HTML thành `div[data-type]`; `htmlToJson` bỏ qua tag lạ (nội dung vẫn giữ). Cần phép thử với tài liệu thật có ảnh, callout, bảng, task list.
5. Bộ làm sạch HTML của p2-page loại thuộc tính `data-type`, `data-checked`, nên `description_html` của task list/callout mất thuộc tính này. Binary (nguồn dữ liệu của editor) không bị ảnh hưởng.
6. Lưu tiêu đề dùng `setTimeout` (debounce 5 giây). DO bị evict khi đang chờ thì tên page trong D1 chậm đến lần sửa sau; tiêu đề vẫn nằm trong binary.
7. Body `convert-document` có thể tới 10 MB; nếu integrator áp `requestBodySizeLimit` (5 MB) lên route này thì sẽ bị chặn.
8. Gợi ý nối tiếp (không làm vì ngoài phạm vi): p2-page gọi `forceCloseLivePage` khi xóa hoặc đổi quyền page, p2-asset gọi `convertDocument` trực tiếp trong job sao chép asset, editor Lancity (chưa có) truyền `pageId` trong `parameters`.
