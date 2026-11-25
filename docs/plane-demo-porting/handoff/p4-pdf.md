# Handoff p4-pdf

Phạm vi: xuất page thành PDF (`apps/live`: `pdf-export.controller.ts`, `lib/pdf/*`, `services/pdf-export/*`) trong `docs/plane-demo-porting/14-live.md`. Không đụng phần Live/collab. Chưa chạy typecheck, build, test theo quy ước. ESLint và Prettier sạch trên mọi file bên dưới.

Mã: [`src/server/pdf/`](../../../src/server/pdf) · route [`pdf.ts`](../../../src/server/api/v1/routes/pdf.ts) · Zod [`p4-pdf-schema.ts`](../../../src/types/content/p4-pdf-schema.ts). Test: [`tests/p4-pdf.test.ts`](../../../tests/p4-pdf.test.ts) (đơn vị, `tsx --test`; không cần Worker, giả lập binding `BROWSER`).

## Quyết định runtime: Browser Rendering, không dùng thư viện PDF JS

| | Browser Rendering (`env.BROWSER.quickAction('pdf', { html })`) | `@react-pdf/renderer` (bản gốc) hoặc `pdf-lib`/`pdfmake` |
| --- | --- | --- |
| Tiếng Việt, font | Chromium có font hệ thống, dấu đúng | Phải nhúng font Unicode (file `.ttf` vài trăm KB vào bundle). Font chuẩn của PDF không vẽ được dấu tiếng Việt. Bản gốc chỉ đăng ký Inter `latin` |
| Bố cục | CSS in thật: ngắt trang, bảng, `break-inside`, ảnh co theo trang | Tự tính layout, bảng nhiều trang và ảnh dễ lỗi |
| Chạy trên Workers | Có, gọi qua binding | `@react-pdf` cần `fs`, `sharp`, `createRequire`: không chạy được trên Workers nếu không viết lại |
| Dependency | Không. Gọi `quickAction` của binding, không cần `@cloudflare/puppeteer` và không cần API token | Thêm package lớn |
| Nhược điểm | Cần binding trả phí/giới hạn (số phiên đồng thời, 429), không chạy local nếu thiếu binding. Không đặt được `author`/`subject` trong metadata PDF (chỉ `title` lấy từ `<title>`) | Đặt được metadata |

Chọn Browser Rendering. Bản `quickAction` tránh thêm dependency nên không xung đột `package.json` với p4-live. Nội dung được dựng thành HTML tự đủ (CSS và ảnh `data:` nội tuyến) kèm CSP `default-src 'none'`, nên Chromium không tải được gì từ mạng.

Không có binding thì `POST` trả 503 `PDF_UNAVAILABLE`. `GET .../pdf-export/preview` trả HTML in được (dùng để kiểm tra bố cục hoặc in từ trình duyệt khi chưa có binding).

## Nguồn nội dung khác Plane

Plane đọc Yjs binary rồi dùng `@plane/editor` (`getAllDocumentFormatsFromDocumentEditorBinaryData`) để ra editor JSON. Lancity không có thư viện đó. `fetchPageContent` dùng:

1. `pages.description_json` khi là tài liệu TipTap (`type: 'doc'`, có `content`): dùng bộ render node/mark port từ Plane.
2. Ngược lại dùng `pages.description_html` (đã sanitize khi ghi): qua đường HTML (`html-content.ts`), viết lại `image-component` và `mention-component`.

Trang chỉ có binary mà `description_json` và HTML rỗng trả 404 `PAGE_NOT_FOUND` (message "Page content not found"). Bộ chuyển Yjs sang JSON thuộc p4-live (PD-1101, PD-2048); khi có thì ghi vào `description_json`, PDF tự dùng.

## (a) PD đã xử lý

Đích trong checklist là `src/server/export/pdf/*`; thực tế đặt ở `src/server/pdf/*` theo phạm vi sở hữu. `.tsx` thành `.ts` vì React-PDF bỏ.

| PD | Kết quả | Code |
| --- | --- | --- |
| 2055-2059 | Port. `exportToPdfController` (+ route `POST`). Thay `Effect.gen` bằng async/await. 2056 `callback`, 2057 đến 2059 `effect` gộp vào thân hàm: tách request, gọi service, ghi log lỗi, map lỗi (500 chung, không lộ nội dung) | [pdf-export.controller.ts](../../../src/server/pdf/pdf-export.controller.ts), [routes/pdf.ts](../../../src/server/api/v1/routes/pdf.ts) |
| 2051-2053 | Thay thế. `parseRequest`: cookie do middleware `authenticate` xử lý (Plane chuyển tiếp cookie sang API Django); `slug`, `projectId`, `pageId` lấy từ URL, body kiểm bằng Zod `pdfExportBodySchema` | controller |
| 2054 | Port. `mapPdfErrorToHttp` + lớp lỗi `Pdf*Error` (kế thừa `ServiceError`, giữ mã trạng thái: 400, 404/502, 504, 500, 502) | [errors.ts](../../../src/server/pdf/errors.ts) |
| 2143-2147 | Port. `getTextColorHex`, `getBackgroundColorHex`, `isCssVariable`, `extractColorKeyFromCssVariable`, `resolveColorForPdf` + bảng màu. Thêm `safeCssColor` (chặn chèn CSS từ attr tài liệu) | [colors.ts](../../../src/server/pdf/colors.ts) |
| 2148-2164 | Port. 16 icon SVG thành hàm trả chuỗi SVG, `getFileIcon`. Màu được kiểm bằng `safeCssColor` | [icons.ts](../../../src/server/pdf/icons.ts) |
| 2165-2177 | Port. 11 mark (`bold` đến `customColor`) trả style CSS, `applyMarks` (+ callback `reduce`), `styleToString` | [mark-renderers.ts](../../../src/server/pdf/mark-renderers.ts) |
| 2178, 2181-2184 | Port. `getCalloutIcon`, `renderTextWithMarks` (+ `hasLink`; link chỉ nhận `http(s)`, `mailto`, `tel`, `#`, `/`), `getTextAlignStyle`, `getFlexAlignStyle` | [node-renderers.ts](../../../src/server/pdf/node-renderers.ts) |
| 2185-2207 | Port. Mọi node của `nodeRenderers`: `doc`, `text`, `paragraph`, `heading`, `blockquote`, `codeBlock`, `bulletList`, `orderedList`, `listItem`, `taskList`, `taskItem`, `table`, `tableRow`, `tableHeader`, `tableCell`, `horizontalRule`, `hardBreak`, `image`, `imageComponent`, `calloutComponent`, `mention` (+ `userMention`). Danh sách dùng `ul`/`ol` gốc; `colspan`, `rowspan`, `start` được giữ | node-renderers.ts |
| 2208-2211 | Port. `renderNodeWithContext` (+ 2 callback) và `renderNode`. Không cần truyền `parentType`, `nestingLevel`, `listItemIndex` vì HTML tự lồng danh sách | node-renderers.ts |
| 2179, 2180 | Thay thế. `createKeyGenerator` chỉ tạo `key` cho React; chuỗi HTML không cần | |
| 2212-2215 | Port. `createPdfDocument` (+ `renderedContent`) trả HTML đầy đủ với CSS in (bảng `pdfStyles` của `styles.ts` thành CSS), `renderPlaneDocToPdfBuffer`/`Blob` gọi Browser Rendering (`format`, `landscape`, lề 40px, `printBackground`) | [plane-pdf-exporter.ts](../../../src/server/pdf/plane-pdf-exporter.ts) |
| 2288-2296 | Port bằng Promise thay Effect. `withTimeoutAndRetry` (timeout mỗi lần thử, retry lũy thừa 200 ms, không retry lỗi có `status` dưới 500), `recoverWithDefault`, `tryAsync` | [effect-utils.ts](../../../src/server/pdf/effect-utils.ts) |
| 2297-2298 | Port. `sync` thành các hàm export của service; `getDocumentType` luôn `project_page` | [pdf-export.service.ts](../../../src/server/pdf/pdf-export.service.ts) |
| 2299-2300 | Port. `collectJsonImageRefs` (`extractImageAssetIds` + `traverse`) và bản HTML `collectHtmlImageRefs` | [html-content.ts](../../../src/server/pdf/html-content.ts) |
| 2301-2304 | Thay thế. `fetchPageContent` đọc `description_json` hoặc `description_html` trực tiếp từ D1 (không còn gọi API Django, không còn timeout 7 s và retry vì không có HTTP) | service |
| 2305-2309 | Port. `fetchUserMentions`: tên hiển thị từ bảng `user`, chỉ trả thành viên đang hoạt động của workspace; lỗi thì về danh sách rỗng (`recoverWithDefault`) | service |
| 2310-2324 | Port. `processImages`: tối đa 4 ảnh đồng thời, timeout 8 s, retry 1 lần. Ảnh asset đọc từ R2 (`file_assets` cùng workspace, đã upload, chưa xóa), ảnh `http(s)` qua `pinnedFetchFollowingRedirects` của p1 (chống SSRF). Chỉ nhúng JPEG/PNG/WebP/GIF kiểm bằng magic bytes (không nhúng SVG). Ảnh lỗi chỉ ghi log và hiện placeholder. Khác Plane: không dùng `sharp` (xoay, ép nền trắng, thu về 1200 px JPEG), ảnh nhúng nguyên byte, CSS thu nhỏ khi in. Giới hạn: 5 MiB mỗi ảnh, 24 MiB tổng, 100 ảnh | service |
| 2325-2328 | Port. `renderPdf` với timeout 25 s (Plane 15 s) và không retry | service |
| 2329-2330 | Port. `exportToPdf` (pipeline: nội dung, mention, ảnh, render). `exportPagePdf` kiểm quyền bằng `requirePageAccess` của p2-page (quyền đọc, page private chỉ chủ sở hữu) | service |
| 2281-2282 (`resolveImageAssetUrl`, thuộc nhóm collaboration) | Chỉ phần PDF cần: `resolveImageAsset` đọc byte R2 thay URL presigned. Mục đó vẫn thuộc p4-live | service |

Bổ sung ngoài Plane:

- Chế độ nền cho tài liệu nặng: `POST` với `{ "async": true }` trả 202 `{ token, status: 'queued' }`, job `pdf.export` render và ghi R2 `pdf-exports/<userId>/<token>.pdf`. `GET /pdf-exports/:token` cho `queued|completed|failed`, `GET /pdf-exports/:token/download` tải file. Khóa R2 bắt đầu bằng id người gọi nên chỉ chủ yêu cầu truy cập được. Cron `45 2 * * *` (job `pdf.cleanup`) xóa file quá 24 giờ. Không có bảng mới. Lỗi 5xx khác 500 (browser bận) được ném lại để Queues retry; lỗi còn lại ghi `.error.json`.
- Giới hạn 20 lần mỗi giờ mỗi người (`checkRateLimit` của p1, khóa `pdf-export:<userId>`). Lỗi D1 thì fail-open như p1.

## PD để trống

Không có PD nào trong phạm vi bị bỏ. Ngoài phạm vi (không đụng, thuộc p4-live): PD-2044 đến 2050, 2060 đến 2142, 2216 đến 2287, 2331 đến 2348.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

```ts
import pdfRoutes from '@/server/api/v1/routes/pdf'
app.route(linkto.apiProject, pdfRoutes)
```

Đường dẫn (sau `/api/v1/workspaces/:slug/projects/:projectId`):

- `POST /pages/:pageId/pdf-export` (body: `title`, `author`, `subject`, `pageSize` `A4|A3|A2|LETTER|LEGAL|TABLOID`, `pageOrientation`, `fileName`, `noAssets`, `async`) trả `application/pdf` hoặc 202.
- `GET /pages/:pageId/pdf-export/preview` trả HTML in.
- `GET /pdf-exports/:token`, `GET /pdf-exports/:token/download`.

Route nằm cạnh mount `pagesRoutes` nhưng dưới `apiProject`, như `exportsRoutes`. Plane gọi `POST /live/pdf-export/` kèm `pageId`, `workspaceSlug`, `projectId` trong body; client Lancity gọi URL trên.

## (c) Schema ext

Không có. Không tạo `ext-p4-pdf.ts`, không cần migration.

## (d) Key linkto cần thêm

Không bắt buộc (route dùng đường dẫn tương đối như `exports.ts`). Gợi ý nếu muốn thống nhất: `projectPagePdfExport: '/:slug/projects/:projectId/pages/:pageId/pdf-export'`.

## (e) Dependency, binding, env

- Dependency: không thêm.
- Binding mới: Browser Rendering, tên `BROWSER`, thêm vào `cloudflare.config.ts` (`bindings.browser()` nếu `@cloudflare/config` có, theo ghi chú p0-infra; tôi chưa kiểm được tên hàm). Nếu không có, khai `browser = { binding = "BROWSER" }` trong cấu hình Worker. Tài khoản cần gói Workers có Browser Rendering. Binding chạy trên hạ tầng Cloudflare, local cần `remote` hoặc dùng `preview`.
- `ASSET_BUCKET` (đã có): ảnh và file xuất nền.
- Env: không.
- Job tự đăng ký: [`src/server/pdf/jobs.ts`](../../../src/server/pdf/jobs.ts) (`pdf.export`, `pdf.cleanup`, cron `45 2 * * *`).

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck`. Chỗ dễ lỗi: `env.BROWSER` (kiểu `unknown` từ `InfraEnv`, ép sang `BrowserBinding`); `new Response(pdfBuffer as BodyInit)` với `Uint8Array`; `c.json(..., status as ContentfulStatusCode)`; `typeof pages.$inferSelect` qua `import { type pages }`; `PdfExportBody` từ `z.output` của schema có `.default({})` trong `pdfExportJobSchema.options`; `Blob([bytes as BlobPart])`.
2. Chạy `pnpm exec tsx --test tests/p4-pdf.test.ts`. Test không chạm D1, R2 hay binding thật.
3. Chưa kiểm thử với Browser Rendering thật: chữ ký `quickAction('pdf', { html, gotoOptions, pdfOptions })` theo tài liệu Cloudflare (tên `format` viết thường như `a4`, `letter`). Cần gửi thử một page có bảng, ảnh R2, mention và chữ tiếng Việt, và kiểm tra CSP `default-src 'none'` không làm Chromium bỏ ảnh `data:` (đã cho phép `img-src data:`).
4. PDF chỉ có `title` (từ `<title>`). `author` và `subject` được nhận nhưng không ghi vào metadata PDF vì `quickAction` không có tùy chọn này. Nếu cần, hậu xử lý bằng cách thêm một thư viện như `pdf-lib` (dependency mới) hoặc chuyển sang `@cloudflare/puppeteer`.
5. UI chưa có nút tải PDF (cần form hoặc nút ở `src/app/pages/*`, ngoài phạm vi).
6. Ảnh không qua `sharp`: ảnh lớn (tối đa 5 MiB mỗi ảnh) làm HTML nặng; ngưỡng tổng 24 MiB để vừa giới hạn 50 MB của endpoint.
7. Trang chỉ có Yjs binary (chưa có `description_json`) chưa xuất được cho đến khi p4-live ghi JSON. Cần thống nhất với p4-live: ghi `description_json` cùng lúc ghi binary.
