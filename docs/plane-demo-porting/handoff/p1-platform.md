# Handoff p1-platform

Nhóm 01 (`docs/plane-demo-porting/01-platform.md`): nền tảng API, phân quyền, phân trang, filter, rate limit, cache, tiện ích dùng chung. Chưa chạy typecheck, build, test theo quy ước. ESLint sạch trên mọi file bên dưới.

Đường dẫn đích trong checklist khác với file thực tế ở vài chỗ (ghi rõ trong bảng). Lý do: prompt chỉ định tên file `permissions/pagination/filters/serializers/rate-limit.ts`, nên các PD cùng nhóm được gộp vào đó.

## (a) PD đã xử lý

Mã file: [`common/`](../../../src/server/common) · [`api/v1/`](../../../src/server/api/v1). Test: [`tests/p1-platform.test.ts`](../../../tests/p1-platform.test.ts) (đơn vị, chạy bằng `tsx --test`) và [`tests/p1-platform.integration.mjs`](../../../tests/p1-platform.integration.mjs) (Worker + D1).

| PD | Kết quả | Code |
| --- | --- | --- |
| 0005, 0006 | Port. `ApiKeyRateThrottle.get_cache_key` là `key` của `apiKeyRateLimit`, `allow_request` là `checkRateLimit` + header `X-RateLimit-*` | [rate-limit.ts](../../../src/server/common/rate-limit.ts) |
| 1688 | Port. `assetRateLimit` (5/phút theo `:assetId`) | rate-limit.ts |
| 0007-0009, 0299-0303 | Port (đích `presenters.ts` gộp vào `serializers.ts`). `pickFields`, `DynamicSerializer` (`filterFields`, `readableFields`, `toRepresentation`), `expandRelations`, `getExpansionMapper`/`registerExpansion` | [serializers.ts](../../../src/server/common/serializers.ts) |
| 2020 | Port `writableData(data, readOnlyFields)` | serializers.ts |
| 0061, 0471 | Thay thế. `getRequestTimezone(c)` đọc `profiles.user_timezone`, nạp một lần mỗi request, sai múi giờ thì dùng UTC | [middleware.ts](../../../src/server/api/v1/middleware.ts) |
| 0062, 0072, 0475 | Thay thế. `baseApiView()` (session) và `externalApiView(authenticator)` (API key); kiểm tra body JSON phải là object/array bằng `requireContainerBody` | middleware.ts, [validation.ts](../../../src/server/api/v1/validation.ts) |
| 0063, 0482 | Thay thế. `buildSearchCondition` (DRF `SearchFilter`), `buildFieldFilters`, `ComplexFilterBackend`, `buildOrderBy` | [filters.ts](../../../src/server/common/filters.ts) |
| 0064 | Thay thế. `externalApiView` gắn `apiKeyRateLimit` | middleware.ts |
| 0065, 0074, 0476, 0483 | Thay thế. `handleApiError`: ServiceError, HTTPException, ZodError (400), lỗi ràng buộc D1 (400 `INTEGRITY_ERROR`), còn lại 500 chung và ghi log | [errors.ts](../../../src/server/api/v1/errors.ts) |
| 0066, 0075, 0477, 0484 | Thay thế. `app.onError(handleApiError)` + `requestLogger`. Không port đếm query khi DEBUG | errors.ts, middleware.ts |
| 0067 | Thay thế. `setRateLimitHeaders` | rate-limit.ts |
| 0068, 0076, 0478, 0485 | Thay thế. `getWorkspaceSlug(c)` | middleware.ts |
| 0069, 0077, 0479, 0486 | Thay thế. `getProjectId(c, fallbackParam?)` | middleware.ts |
| 0070, 0078, 0480, 0487 | Thay thế. `fieldsFromQuery` | serializers.ts |
| 0071, 0079, 0481, 0488 | Thay thế. `expandFromQuery` | serializers.ts |
| 0073, 0472 | Thay thế. Mỗi service tự truy vấn bảng của mình; helper `notDeleted(table)` / `activeRows(table)` | filters.ts, [mutations.ts](../../../src/server/common/mutations.ts) |
| 0473, 0474 | Không áp dụng. DRF tự sinh action từ mixin và cần chặn action chưa có phân quyền. Hono chỉ có route khai báo tường minh, route không khai báo trả 404/405 | |
| 0271-0274, 1960-1962 | Port (đích `src/server/authz/permissions.ts` đặt tại `common/permissions.ts`). `ROLE`, `resolvePermission`/`hasPermission`/`requirePermission`, `requireWorkspaceRole`, `requireProjectRole`, middleware `allowPermission`, `issueHiddenFromGuest` | [permissions.ts](../../../src/server/common/permissions.ts) |
| 0521 | Một phần. API: `handleNotFound` (JSON 404). UI: `src/app/not-found.tsx` chưa tồn tại và nằm ngoài phạm vi p1, cần tạo ở bước tích hợp | errors.ts |
| 0810, 0811 | Đã có sẵn trong `timezones.ts` (sắp xếp theo offset rồi label), route `GET /timezones` đã mount. Kiểm thử ở `tests/platform.test.ts` và `p1-platform.integration.mjs` | [timezones.ts](../../../src/server/api/v1/timezones.ts) |
| 2041, 2042 | Đã xong từ trước (đã tick) | |
| 1248-1250, 1607 | p0-infra (`getMetricsPushIntervalMinutes`, `logJson`, `retentionDays` trong `env.ts`) | env.ts |
| 0001 | Thay thế. `ApiConfig.ready` chỉ import extension OpenAPI cho drf-spectacular; `openapi.ts` không cần đăng ký | |
| 1357-1359 | Thay thế (đích `database/mutations.ts` đặt tại `common/mutations.ts`). `activeRows`, `deleteRows`, `deleteRecord` (hook `onSoftDeleted` để enqueue xóa mềm liên quan, PD-1104 của nhóm 15) | mutations.ts |
| 1360-1366 | Port. `ChangeTracker` (`track`, `hasChanged`, `changedFields`, `oldValues`, `commit`) | mutations.ts |
| 1377, 1378, 1406, 1407 | Thay thế. Cột audit đã có trong `columns.ts`; `auditFields(actor, 'insert' \| 'update')` đặt cột người tạo/sửa. `__str__` không cần | mutations.ts |
| 1588-1593 | Port một phần. `readReplicaRouting`, `useReadReplica` và cờ theo request (`AsyncLocalStorage`). Chưa nối với D1 Sessions API vì `src/db/client.ts` thuộc hạ tầng | [request-scope.ts](../../../src/server/common/request-scope.ts) |
| 1717-1719 | Thay thế. `routeDatabase('read' \| 'write')`; migration D1 luôn chạy trên primary | request-scope.ts |
| 1720-1722 | Port `setUseReadReplica`, `shouldUseReadReplica`, `clearReadReplicaContext` | request-scope.ts |
| 1594-1596 | Thay thế. `requestLogger` (JSON một dòng, bỏ qua `GET /api/v1` và `/health`), `shouldLogRoute` | middleware.ts |
| 1597-1601 | Thay thế. `apiTokenLog` ghi `api_activity_logs` trong `waitUntil`; `tokenIdentifier` là HMAC-SHA256 bằng `BETTER_AUTH_SECRET`; `safeDecodeBody`, `redactedHeaders` | middleware.ts, [request-security.ts](../../../src/server/api/v1/request-security.ts) |
| 1602, 1603 | Thay thế. `requestBodySizeLimit` (413 `BODY_TOO_LARGE`, 5 MiB) | validation.ts |
| 1604 | Port. `corsSettings`, `createCorsMiddleware(env)` | request-security.ts |
| 1606 | Port. `cookiesSecure` | request-security.ts |
| 1605, 1608 | Ngoài phạm vi. Không dùng Redis; cache dùng D1 (`cache.ts`) | |
| 1609-1617 | Ngoài phạm vi p1. `src/server/asset/storage.ts` thuộc nhóm content, dùng R2 binding `ASSET_BUCKET` (put với `httpMetadata.contentDisposition`, `head` cho metadata, `delete([...])`, copy bằng get + put; presigned POST/URL cần aws4fetch hoặc upload qua Worker) | |
| 1703-1710 | Port trên D1 (đích `cache.ts`). `generateCacheKey`, `cacheResponse`, `invalidateCache`, `invalidateCacheDirectly`, `cacheGet/Set/Delete/DeleteMatching` | [cache.ts](../../../src/server/common/cache.ts) |
| 1711 | Port `getRandomColor` | [color.ts](../../../src/server/common/color.ts) |
| 1726-1728 | Port. `getAnalyticsDateRange`, `getChartPeriodRange`, `getAnalyticsFilters` (trả mô tả phạm vi thay cho khóa lookup Django) | [date-utils.ts](../../../src/server/common/date-utils.ts) |
| 1731 | Port `logException` | [exception-logger.ts](../../../src/server/common/exception-logger.ts) |
| 1785-1802 | Port `LegacyToRichFiltersConverter` | filters.ts |
| 1803-1815 | Port `ComplexFilterBackend` (đích `filter-backend.ts`). Mã lỗi Plane viết hoa, ví dụ `invalid_filter_field` thành `INVALID_FILTER_FIELD` | filters.ts |
| 1816-1818 | Port `migrateSingleModelFilters`, `migrateModelsFiltersToRichFilters`, `clearModelsRichFilters` (batch 40 câu/lần) | filters.ts |
| 1819-1834 | Port `BaseFilterSet` và `createIssueFilterSet()` (`issueFilterSet`). Quan hệ gán/cycle/module/label/mention/subscriber dùng subquery `deleted_at is null` nên không cần DISTINCT | filters.ts |
| 1835-1838 | Port `PaginateCursor`, `paginateGlobal` | [pagination.ts](../../../src/server/common/pagination.ts) |
| 1920-1954 | Port `Cursor`, `CursorResult`, `OffsetPaginator`, `GroupedOffsetPaginator`, `SubGroupedOffsetPaginator`, `getPerPage`, `effectiveMaxPerPage`, `paginate` | pagination.ts |
| 1842, 1843 | Port `baseHost(env, opts)`, `userIp` | [host.ts](../../../src/server/common/host.ts) |
| 1848 | Thay thế. `import_submodules` thành `import.meta.glob` trong `job-registry.ts` (p0) | |
| 1849-1853 | Port. `parseIp`, `embeddedIpv4`, `isBlockedIp`, `isAllowedIp`, `resolveAndValidate`, `validateUrl` (DNS qua DoH `cloudflare-dns.com`, không có `getaddrinfo`) | [ip-address.ts](../../../src/server/common/ip-address.ts) |
| 1854 | Port `getClientIp`: `CF-Connecting-IP` trước, rồi phần tử đầu `X-Forwarded-For` | ip-address.ts |
| 1887, 1888 | Thay thế. Không ghi file log xoay vòng trên Workers; log JSON ra stdout (Workers Logs) | |
| 1889-1914 | Thay thế bằng helper OpenAPI: `apiKeySecurityScheme`, `mergeSchemaOptions`, 20 hàm `*Docs`, `getSampleForSchema`/`registerSchemaExample`, `createPaginatedResponse`, `preprocessFilterApiV1Paths`, `generateOperationSummary`, `buildOpenApiDocument` | [openapi.ts](../../../src/server/api/v1/openapi.ts) |
| 1917-1919 | Port `grpcEndpointFromUrl`, `getOtlpGrpcEndpoint(env)`, `getOtlpHttpMetricsUrl(env)` | [otlp-endpoints.ts](../../../src/server/common/otlp-endpoints.ts) |
| 1955-1959 | Port `sanitizeFilename`, `containsSuspiciousPatterns`, `getAllowedHosts(env)`, `validateNextPath`, `getSafeRedirectUrl(env, ...)`, kèm `urlHasAllowedHostAndScheme` (Django) | [path-validator.ts](../../../src/server/common/path-validator.ts) |
| 2021-2025 | Port bằng `Intl` thay pytz: `userTimezoneConverter`, `convertToUtc(db, ...)` + phần thuần `convertDateToUtc`, `projectDayStart`, `snoozeDayStart`, `convertUtcToProjectTimezone` | [timezone-converter.ts](../../../src/server/common/timezone-converter.ts) |
| 2026-2029 | Port `containsUrl`, `isValidUrl`, `getUrlComponents`, `normalizeUrlPath` (kèm `urlparse`, `urlunparse`, `unquote`, `urlencode`) | [url.ts](../../../src/server/common/url.ts) |
| 2030, 2031, 2034 | Thay thế. Adapter ghim IP không tồn tại trên Workers (không kết nối tới IP literal mà giữ Host/SNI) | |
| 2032, 2033, 2035-2038 | Port: `splitTarget`, `fetchValidatedHop` (thay `_request_to_ip` + `_fetch_validated_hop`), `pinnedFetch`, `pinnedFetchFollowingRedirects`, `readCappedBody`. Giới hạn: resolve + kiểm tra một lần rồi `fetch` resolve lại; Cloudflare chặn subrequest tới IP nội bộ nên rủi ro DNS rebinding thấp hơn bản Python | [url-security.ts](../../../src/server/common/url-security.ts) |
| 2039, 2040 | Port `isValidUuid` (v4), `convertUuidToInteger` (async, SHA-256). Thêm `isEntityId` (id số tự tăng), `isUuidLike` | [uuid.ts](../../../src/server/common/uuid.ts) |

Khác Plane có chủ đích:
- Filter nhận ID số (`isEntityId`); converter vẫn chấp nhận chuỗi UUID cũ trong JSON import.
- Toán tử logic `OR/AND/NOT` không phân biệt hoa thường cả lúc kiểm tra lẫn lúc đánh giá (Plane kiểm tra không phân biệt nhưng đánh giá phân biệt).
- Filter dạng `in` nhận cả danh sách lẫn chuỗi CSV (Plane chỉ lấy giá trị cuối khi lặp khóa). Tối đa 80 phần tử mỗi danh sách vì D1 giới hạn 100 tham số mỗi câu.
- `created_at`/`updated_at` lọc theo ngày trong múi giờ `ctx.timezone` (mặc định UTC); gọi `issueFilterSet.buildCombinedQ(data, { timezone: await getRequestTimezone(c) })`.
- Paginator nhóm dùng SQL window function qua `db.all`; truy vấn gốc phải trả `id`, `created_at`, cột sắp xếp và cột nhóm với tên alias trong `ISSUE_GROUP_BY_ALLOWLIST` (`state_id`, `state_group`, `priority`, `label_id`, `assignee_id`, `module_id`, `cycle_id`, `project_id`, `created_by_id`, `target_date`, `start_date`).
- Rate limit và cache fail-open: lỗi D1 chỉ ghi log, request vẫn chạy.

## (b) Route cần đăng ký vào `index.ts`

Không có file route mới. Đề nghị sửa `src/server/api/v1/index.ts` (không bắt buộc, route hiện có vẫn chạy):

```ts
import { handleApiError, handleNotFound } from '@/server/api/v1/errors'
import { privateNoStore, protectCookieWrites, requestLogger } from '@/server/api/v1/middleware'
import { readReplicaRouting } from '@/server/common/request-scope'
import { anonRateLimit } from '@/server/common/rate-limit'

app.use('*', requestLogger, readReplicaRouting, privateNoStore, protectCookieWrites)
app.notFound(handleNotFound)
// Public endpoints without a session (Plane AnonRateThrottle 30/min), for example:
// app.use(`${linkto.apiPublic}/*`, anonRateLimit())
```

Với route mới của các nhóm khác: `routes.use('*', ...baseApiView())`, phân quyền từng route bằng `allowPermission([ROLE.ADMIN, ROLE.MEMBER], { pkParam: 'issueId', creator: true, model })`. CORS chỉ cần khi trình duyệt ở origin khác gọi API: `app.use('*', createCorsMiddleware(getEnv()))`.

## (c) Schema ext cần merge

File: [`src/db/schema/ext-p1-platform.ts`](../../../src/db/schema/ext-p1-platform.ts) với hai bảng `rate_limit_hits` (key, hit_at; chỉ mục theo key + hit_at) và `cache_entries` (key duy nhất, value JSON, expires_at, created_at). Thêm `export * from './schema/ext-p1-platform'` vào `src/db/schema.ts`. Gợi ý tên migration: `pnpm db:generate --name platform_rate_limit_cache`. Các câu SQL trong `rate-limit.ts` và `cache.ts` chỉ chạy sau khi migration này được áp dụng (code vẫn fail-open nếu chưa có bảng).

## (d) Key linkto cần thêm

Không có.

## (e) Dependency, binding, env

- Dependency: không thêm (`hono/cors` nằm trong `hono`).
- Binding: không thêm. `AsyncLocalStorage` (`node:async_hooks`) cần `nodejs_compat`, đã bật.
- Env tùy chọn: `API_KEY_RATE_LIMIT` (mặc định `60/minute`), `CORS_ALLOWED_ORIGINS` (CSV), `WEB_URL`, `APP_BASE_URL`, `ADMIN_BASE_URL`, `SPACE_BASE_URL`, `ADMIN_BASE_PATH`, `SPACE_BASE_PATH`, `OTLP_ENDPOINT`. `apiTokenLog` cần `BETTER_AUTH_SECRET` (đã có) để tạo `tokenIdentifier`. Có thể thêm các biến này vào `.dev.vars.example` nếu dùng.
- Job mới tự đăng ký qua `import.meta.glob`: [`src/server/platform/jobs.ts`](../../../src/server/platform/jobs.ts) (job `platform.purge_tables`, cron `15 * * * *`, xóa cache hết hạn và hit rate limit quá 1 ngày).

## (f) Việc còn dang dở

1. Chạy `pnpm typecheck`. Các điểm dễ lỗi kiểu vì chưa chạy: tham số `SQLiteTable` tổng quát trong `permissions.ts`, `filters.ts`, `mutations.ts`; overload `userTimezoneConverter`; `db.all<Row>` và `db.batch` trong `pagination.ts`/`filters.ts`; kết quả `db.run(...).meta.changes` trong `rate-limit.ts`.
2. Chạy `pnpm exec tsx --test tests/p1-platform.test.ts` và `LANCITY_TEST_D1=... node --test tests/p1-platform.integration.mjs` (hai ca D1 tự bỏ qua nếu chưa có bảng).
3. Chưa có `src/app/not-found.tsx` (PD-0521 phần UI).
4. Nối D1 Sessions API (read replica) vào `src/db/client.ts` bằng `shouldUseReadReplica()` nếu bật read replication.
5. Các nhóm khác cần: đăng ký lite serializer qua `registerExpansion` (user, workspace, project, state, ...), truyền `ctx.timezone` khi lọc theo ngày, dùng `externalApiView` với authenticator API key của nhóm integration (đặt `c.set('apiKeyAuthenticated', true)` để `apiTokenLog` ghi nhận).
6. Chưa kiểm thử DoH (`resolveHostname`) và `pinnedFetch` trên Worker thật.
