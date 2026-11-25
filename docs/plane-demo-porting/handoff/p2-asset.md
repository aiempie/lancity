# Handoff p2-asset

Phạm vi: phần không thuộc page của [08-content.md](../08-content.md): asset và upload (R2), asset người dùng, workspace, project, ảnh bìa, logo, asset gắn vào entity, nhân bản asset, asset cho editor, state mô tả (`descriptions`) và các job nền của asset. Chưa chạy typecheck, build, test theo quy ước. ESLint và Prettier sạch trên mọi file bên dưới.

Mã: [asset/](../../../src/server/asset) · [content/description.ts](../../../src/server/content/description.ts) · route [assets.ts](../../../src/server/api/v1/routes/assets.ts) · Zod [p2-asset-schema.ts](../../../src/types/content/p2-asset-schema.ts). Test: [tests/p2-asset.integration.mjs](../../../tests/p2-asset.integration.mjs) (Worker + D1 + R2 local, chưa chạy).

## Quyết định thiết kế

- R2 không có presigned POST nếu không thêm khóa S3 và dependency. Thay bằng upload qua Worker: `POST` tạo bản ghi `file_assets` và trả `upload_data { url, method: 'PUT', headers, max_size }`, client `PUT` byte vào `url`, rồi `PATCH` xác nhận (Worker kiểm tra object có trong R2, ghi kích thước và metadata, rồi gắn logo, cover, avatar). `GET` stream từ R2 thay cho redirect presigned. Tải inline chỉ cho jpeg, jpg, png, gif, webp (`INLINE_SAFE_MIME_TYPES`), còn lại là `attachment` kèm `X-Content-Type-Options: nosniff`.
- Giới hạn kích thước: env `FILE_SIZE_LIMIT`, mặc định 5 MiB như Plane. Byte được đọc vào bộ nhớ (tối đa bằng giới hạn này). Ảnh jpeg/png/gif/webp được kiểm tra magic bytes.
- Ba họ endpoint của Plane (api/v1 ngoài, `/api/assets/v2`, `/api/.../file-assets`) gộp vào một service. Biến thể "server" của `UserServerAssetEndpoint` trùng logic với `UserAssetEndpoint` nên dùng chung route.
- `src/server/asset/service.ts` giữ nguyên chữ ký export cũ. Thêm `export * from './file-assets'` và một tham số tùy chọn trong `findAsset` nội bộ để route tải project cũ đọc được asset `PROJECT_COVER` (trước đây trả 404 với mọi asset có `entity_type`). Route và hàm `uploadProjectAsset`, `downloadProjectAsset`, `deleteProjectAsset` không đổi.
- Không có bảng hoặc cột mới. Không tạo `ext-p2-asset.ts`. Không cần migration.

## (a) PD đã xử lý

| PD | Kết quả | Code |
| --- | --- | --- |
| 0050, 0055 | Gộp vào `createUserAssets` (POST `/assets/user-assets`) | [v2.ts](../../../src/server/asset/v2.ts) |
| 0051, 0056 | Gộp vào `updateUserAssets` (PATCH `/assets/user-assets/:assetId`) | v2.ts |
| 0052, 0057 | Gộp vào `deleteUserAssets` (DELETE) | v2.ts |
| 0048, 0053, 0443 | `assetDeleteUserAssets` | v2.ts |
| 0049, 0054, 0445 | `entityAssetDeleteUserAssets` | v2.ts |
| 0444 | `entityAssetSaveUserAssets` (avatar, cover, xóa asset cũ, ghi `profiles.avatar_asset_id` / `cover_image_asset_id`) | v2.ts |
| 0058, 0059, 0060 | `getGenericAsset`, `createGenericAsset`, `updateGenericAsset`. Route `/:slug/generic-assets` | [generic.ts](../../../src/server/asset/generic.ts) |
| 0434 đến 0437 | `getFileAsset`, `createFileAsset`, `deleteFileAsset`, `restoreFileAsset` (multipart, một request) | [file-assets.ts](../../../src/server/asset/file-assets.ts), re-export ở service.ts |
| 0438, 0439, 0440 | `getUserAssets`, `createUserFileAssets`, `deleteUserFileAssets` (tên `createUserAssets`/`deleteUserAssets` trong checklist trùng với v2, nên đổi tên) | file-assets.ts |
| 0446, 0447, 0448 | `createUserAssets`, `updateUserAssets`, `deleteUserAssets` | v2.ts |
| 0453 đến 0456 | `createWorkspaceFileAsset`, `updateWorkspaceFileAsset`, `deleteWorkspaceFileAsset`, `getWorkspaceFileAsset` | v2.ts |
| 0449, 0459, 0467 | `getEntityIdField` (có tuỳ chọn `draft`) và các biến thể `getEntityIdField*` | [model-rules.ts](../../../src/server/asset/model-rules.ts), v2.ts |
| 0450, 0451, 0452 | `assetDeleteWorkspaceFileAsset`, `entityAssetSaveWorkspaceFileAsset` (logo, cover), `entityAssetDeleteWorkspaceFileAsset` | v2.ts |
| 0457 | `getStaticFileAsset`, route công khai `GET /assets/static/:assetId` | v2.ts |
| 0458 | `createAssetRestore` | v2.ts |
| 0460 đến 0463 | `createProjectAsset`, `updateProjectAsset`, `deleteProjectAsset`, `getProjectAsset` (route `/entity-assets`) | v2.ts |
| 0464, 0465 | `saveProjectCoverProjectBulkAsset`, `createProjectBulkAsset` | v2.ts |
| 0466 | `getAssetCheck` | v2.ts |
| 0468 | `duplicateAsset`, giới hạn 5 lần mỗi phút mỗi asset bằng `assetRateLimit` (PD-1688 của p1) | v2.ts, routes/assets.ts |
| 0469, 0470 | `getWorkspaceAssetDownload`, `getProjectAssetDownload` | v2.ts |
| 0441, 0442 | `canModifyAsset`, `canBindAsset` | [access.ts](../../../src/server/asset/access.ts), re-export ở v2.ts |
| 0570 đến 0576 | Đã port bởi p1-issue-collab trên R2 ([issue/attachment.ts](../../../src/server/issue/attachment.ts)). `src/server/asset/attachment.ts` chỉ re-export theo tên checklist | [attachment.ts](../../../src/server/asset/attachment.ts) |
| 0297, 0298 | `uploadedFileSchema(limit)` (loại MIME, kích thước, file rỗng). Đích checklist là `types/content/schema.ts`, nhưng file đó không thuộc phạm vi nên nằm ở schema p2 | [p2-asset-schema.ts](../../../src/types/content/p2-asset-schema.ts) |
| 1097 đến 1103 | `getEntityIdField`, `extractAssetIds`, `replaceAssetIds`, `updateDescription`, `syncWithExternalService`, `copyAssets`, `copyS3ObjectsOfDescriptionAndAssets`. Job `asset.copy_s3_objects`, helper `enqueueCopyS3Objects` | [jobs/copy-s3-object.ts](../../../src/server/asset/jobs/copy-s3-object.ts) |
| 1135 | `deleteUnuploadedFileAsset`, job `asset.delete_unuploaded` và cron `0 2 * * *` (như Celery beat) | [jobs/file-asset.ts](../../../src/server/asset/jobs/file-asset.ts) |
| 1219 | `getAssetObjectMetadata`, job `asset.storage_metadata`, helper `enqueueAssetMetadata` | [jobs/storage-metadata.ts](../../../src/server/asset/jobs/storage-metadata.ts) |
| 1372 đến 1373, 1375 | `getUploadPath`, `fileSize`, `assetUrl` | model-rules.ts |
| 1374 | `formatFileAsset` (tham chiếu) | [presenters.ts](../../../src/server/asset/presenters.ts) |
| 1376 | `isProjectAccessibleTo` | access.ts |
| 1388, 1389 | `saveDescription`, `saveDescriptionVersion` (cộng `snapshotDescription`). Đích checklist `description/model-rules.ts` đặt ở `content/` theo phạm vi sở hữu | [content/description.ts](../../../src/server/content/description.ts) |
| 1609 đến 1617 (thuộc 01-platform, p1 chuyển cho nhóm content) | `storageUrl`, `requireBucket`, `uploadInstructions` (thay presigned POST), `contentDisposition`, `objectResponse`, `getObjectMetadata`, `copyObject`, `uploadFile`, `deleteFiles` | [storage.ts](../../../src/server/asset/storage.ts) |

PD để trống hoặc không thuộc p2-asset: nhóm page (0275 đến 0280, 0347 đến 0352, 0712 đến 0732, 1210 đến 1215, 1457 đến 1463, 1712 đến 1716, 1844 đến 1847, 1963 đến 1968) do agent page làm.

Khác Plane có chủ đích:
- PATCH xác nhận trả 400 `ASSET_NOT_UPLOADED` khi object chưa có trong R2 (Plane đánh dấu đã upload mà không kiểm tra).
- `entity_asset_save` / `entity_asset_delete` chỉ bỏ liên kết khi asset là logo, cover, avatar hiện tại, và không đánh dấu xóa chính asset đang xác nhận lại (Plane xóa asset cũ ngay cả khi trùng).
- Project endpoint (0460) với `PROJECT_COVER`: Plane truyền `project_id` hai lần (`TypeError`). Ở đây asset luôn thuộc project trong URL và cần project admin.
- Job copy (1102) chỉ copy asset đã upload và chưa xóa, và không map `WORKSPACE_LOGO` sang `workspace_id` (sẽ ghi đè workspace của bản copy).
- `file-assets` người dùng (0439) đặt `is_uploaded = true` và `user_id`, vì Worker đã lưu byte (Plane để `is_uploaded = false`).
- Plane xóa mềm bản ghi chưa upload sau 7 ngày (queryset `.delete()` là soft). Job ở đây cũng xóa mềm (`is_deleted`, `deleted_at`) và xóa object R2 dở dang. Biến `UNUPLOADED_ASSET_DELETE_DAYS` đổi số ngày.
- Không port `invalidate_cache_directly` cho `/api/users/me/`, `/api/workspaces/`, `/api/instances/`: hiện không route nào dùng `cacheResponse`. Khi có, gọi `cacheDeleteMatching` ở các hàm `entityAssetSave*` / `entityAssetDelete*`.
- Plane đặt `user.avatar = ""` khi có avatar asset. `user.image` (Better Auth) được giữ nguyên; `avatarUrl(image, assetUrl)` của identity đã ưu tiên URL asset.

## (b) Route cần đăng ký vào `index.ts`

`assetsRoutes` đã mount ở `linkto.workspaces`, route mới (workspace, project, generic, file-assets) nằm trong cùng router nên chạy ngay. Cần thêm một router mới cho asset người dùng và static:

```ts
import { assetsRoutes, userAssetsRoutes } from '@/server/api/v1/routes/assets'
app.route(linkto.apiAssets, userAssetsRoutes) // '/assets', trong /api/v1
```

Thứ tự không quan trọng. Route `GET /assets/static/:assetId` không yêu cầu session (ảnh đại diện, logo, cover). Các route khác có `authenticate` từng route.

Đường dẫn đầy đủ (tiền tố `/api/v1`, định nghĩa trong `assetPaths`):

| Nhóm | Đường dẫn |
| --- | --- |
| Workspace | `POST /workspaces/:slug/assets`, `GET/PATCH/DELETE /:slug/assets/:assetId`, `PUT .../content`, `POST .../restore`, `GET .../check`, `POST .../duplicate`, `GET .../download` |
| Generic | `POST /workspaces/:slug/generic-assets`, `GET/PATCH /:slug/generic-assets/:assetId` |
| Project | `POST /workspaces/:slug/projects/:projectId/entity-assets`, `GET/PATCH/DELETE .../:assetId`, `PUT .../:assetId/content`, `GET .../:assetId/download`, `POST .../entity-assets/bulk/:entityId` |
| Legacy | `POST /workspaces/:slug/file-assets`, `GET/DELETE /:slug/file-assets/:assetKey`, `POST .../restore` |
| User | `POST /assets/user-assets`, `PATCH/DELETE /assets/user-assets/:assetId`, `PUT .../content`, `GET /assets/static/:assetId`, `POST /assets/user-file-assets`, `GET/DELETE /assets/user-file-assets/:assetKey` |

Route project cũ `/:slug/projects/:projectId/assets[/:assetId]` (multipart ảnh) giữ nguyên.

## (c) Schema ext

Không có. Không cần migration.

## (d) Key linkto cần thêm

- `linkto.apiAssets: '/assets'` (mount `userAssetsRoutes`).
- Tùy chọn, thay các hằng cục bộ `assetPaths` trong routes/assets.ts bằng key `apiV1Routes` tương ứng (workspaceAssets, workspaceAsset, genericAssets, projectEntityAssets, fileAssets, userAssets, staticAsset, userFileAssets...).

## (e) Dependency, binding, env

- Dependency: không thêm.
- Binding: dùng `ASSET_BUCKET` (R2) và `JOBS_QUEUE` đã có. Job mới tự đăng ký qua `src/server/asset/jobs/index.ts` (`register()`).
- Env tùy chọn: `FILE_SIZE_LIMIT` (byte, mặc định 5242880), `UNUPLOADED_ASSET_DELETE_DAYS` (mặc định 7), `LIVE_URL` (job copy gọi `POST {LIVE_URL}/convert-document/` để lấy JSON và binary của mô tả; trống thì chỉ cập nhật HTML). Có thể thêm vào `.dev.vars.example`. Nhóm 14-live có thể thay `syncWithExternalService` bằng lời gọi tới Durable Object.

## (f) Việc còn dang dở và chỗ dễ lỗi typecheck

1. Chạy `pnpm typecheck` rồi `LANCITY_TEST_D1=... node --test tests/p2-asset.integration.mjs` (cần `userAssetsRoutes` đã mount và R2 local). Test tạo dữ liệu trong D1 đã chọn.
2. Dễ lỗi kiểu: spread `bindingValues(...)` (Partial) vào `values` của `insert` và `canModifyAsset` trong v2.ts; `db.select(columns(pages | issues))` trong jobs/copy-s3-object.ts; `onConflictDoUpdate` trên `profiles`; `Buffer.from(base64)` cho cột blob; `import type { fileAssets }` dùng với `typeof` trong model-rules.ts.
3. `service.ts` và `file-assets.ts` import vòng nhau (`validImage`, `export *`). Chỉ dùng ở thời điểm chạy nên an toàn với hàm khai báo; nếu bundler phàn nàn, chuyển `validImage` sang `model-rules.ts` và re-export từ service.ts.
4. Hiển thị URL: `presentCurrentUser`/identity cần gọi `assetUrl` (`/api/v1/assets/static/:id`) cho `avatar_asset`/`cover_image_asset`; presenter workspace cần làm tương tự cho `logo_asset`; `coverImageUrlProject` ([project/model-rules.ts](../../../src/server/project/model-rules.ts)) hiện trỏ `/workspaces/:slug/projects/:id/assets/:assetId` (đã đọc được nhờ chỉnh `findAsset`), nên đổi sang URL static khi tiện.
5. Nhóm page cần gọi `enqueueCopyS3Objects(getEnv(), { entityName: 'PAGE', entityIdentifier, projectId, userId })` khi nhân bản page (PD-0730) và tương tự cho issue; tải ảnh editor dùng `entity_type: PAGE_DESCRIPTION | ISSUE_DESCRIPTION | COMMENT_DESCRIPTION | DRAFT_ISSUE_DESCRIPTION` với endpoint project và gọi `bulk` sau khi entity được tạo.
6. Job dọn asset chưa upload chạy 02:00 UTC với ngưỡng 7 ngày. Gợi ý của p1-issue-collab (24 giờ cho attachment) không được áp dụng; muốn rút ngắn thì đặt `UNUPLOADED_ASSET_DELETE_DAYS=1`.
7. Asset đã xóa mềm (`deleted_at`) vẫn còn trong R2 để restore, như Plane. Chưa có job xóa vĩnh viễn.
8. Chưa kiểm thử: `R2.put` với `source.body` trong `copyObject` trên Worker thật, `Content-Length` của FormData trong test, và `assetRateLimit` khi bảng `rate_limit_hits` chưa migrate (fail-open).
