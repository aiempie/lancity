# Handoff p1-workspace

Checklist: `docs/plane-demo-porting/03-workspace.md` (132 mục, 9 adapter kế thừa). Chưa chạy test, build, typecheck. ESLint và Prettier sạch trên các file bên dưới.

Kiểm thử tích hợp: [tests/p1-workspace.integration.mjs](../../../tests/p1-workspace.integration.mjs) (cần mount router như mục b). Các test cũ `tests/worker.integration.mjs`, `workspace-invitations.integration.mjs`, `workspace-preferences.integration.mjs` được giữ tương thích (chỉ thêm trường, không đổi trường hiện có).

## (a) PD đã xong

Mọi PD đều được xử lý. File đích thực tế khác đề xuất ở một số mục, ghi chú ở cột cuối.

| PD | Nội dung | Code | Ghi chú |
| --- | --- | --- | --- |
| 0865, 0866, 0867, 0869, 0870, 0868 | create/list/update/delete workspace, `UserWorkSpacesEndpoint`, xóa `last_workspace_id` | [service.ts](../../../src/server/workspace/service.ts), [seed.ts](../../../src/server/workspace/seed.ts) | Create trả thêm `totalMembers`, `role`. Seed chỉ khi `seed: true`. List nhận `search`, `owner`. `GET /users/me/workspaces` trả DTO phẳng, hỗ trợ `fields`. |
| 0871 | slug check | đã `[x]` từ đợt 1 | không đổi |
| 0864, 0877, 0913, 0127, 0128, 0902, 0908 | query Drizzle | [queries.ts](../../../src/server/workspace/queries.ts) | |
| 0873-0876, 0878 | theme CRUD | [service.ts](../../../src/server/workspace/service.ts), route `workspaces.ts` | min role 15 (Plane `WorkSpaceAdminPermission` = admin + member). Trùng tên trả 409. |
| 0872, 0879, 0880, 0939-0953 | dashboard, export CSV, profile, stats, issues, activity, graph, properties, last visited | [user.ts](../../../src/server/workspace/user.ts) | Đặt trong `user.ts` thay vì `service.ts` để tránh import vòng. 0943-0945 (callback `on_results`) gộp vào `enrichIssues` và phần group trong `getWorkspaceUserProfileIssues`. 0941 là các subquery trong cùng câu SELECT. |
| 0914-0921, 0912, 0189, 0196, 0197 | members, leave, `me`, views, project-members, members-lite | [member.ts](../../../src/server/workspace/member.ts) | `isSoleAdminOfAnyProject` dùng định nghĩa chặt hơn Plane ("không còn admin khác" thay vì "chỉ có 1 thành viên"), giữ nguyên logic đã có và đã test. Chủ workspace không được rời (400 `OWNER_CANNOT_LEAVE`), Plane không có quy tắc này. |
| 0129-0133, 0126, 0900, 0901 | adapter invitations | [workspace-invitations.ts](../../../src/server/api/v1/routes/workspace-invitations.ts) | `PUT` và `PATCH` cùng handler. Xóa invite đã phản hồi trả 409 (Plane public API trả 400). |
| 0903-0905 | invite (đơn và hàng loạt), sửa role, xóa | [invite.ts](../../../src/server/workspace/invite.ts), [jobs.ts](../../../src/server/workspace/jobs.ts) | `POST /:slug/invitations` nhận `{ email, role }` hoặc `{ emails: [{ email, role }] }`. Hàng loạt: role cao hơn người mời trả 403, đã là member trả 400 kèm `workspace_users`, email đã được mời bị bỏ qua. Gửi mail qua job `workspace.send_invitation`. |
| 0906, 0907 | join bằng token | [invite.ts](../../../src/server/workspace/invite.ts) | GET công khai nhưng bắt buộc `?token=` (ID tự tăng đoán được, Plane dùng UUID). Không bao giờ trả `token`. POST cần phiên, email đã xác minh và khớp lời mời, token đúng. Accept cập nhật `profiles.last_workspace_id`. |
| 0909, 0910 | lời mời của chính user | [invite.ts](../../../src/server/workspace/invite.ts) | Cần email đã xác minh (như luồng cũ). |
| 0892-0896 | favorite | [favorite.ts](../../../src/server/workspace/favorite.ts) | Thêm `entityData`, hỗ trợ `page`, `sequence` theo `UserFavorite.save`, list ẩn favorite page không thuộc project. |
| 0898, 0899 | home widget | [home.ts](../../../src/server/workspace/home.ts) | Tạo `quick_links`, `recents`, `my_stickies` khi chưa có. |
| 0924-0928, 0385, 0386, 0383, 0384 | quick link | [quick-link.ts](../../../src/server/workspace/quick-link.ts), [schema.ts](../../../src/types/workspace/schema.ts) | Thêm kiểm tra trùng URL (400 `QUICK_LINK_EXISTS`), tự thêm `http://` khi thiếu scheme. |
| 0930, 1218 | recent visits + job ghi lượt | [recent-visit.ts](../../../src/server/workspace/recent-visit.ts), [jobs.ts](../../../src/server/workspace/jobs.ts) | 1218 nằm cùng file với 0930 (đích đề xuất `recent-visits.ts`). Job `workspace.record_recent_visit`, giới hạn 20. Thêm `POST /:slug/recent-visits` (Plane ghi từ view khác). Các nhóm khác có thể gọi `enqueueRecentVisit`. |
| 0955, 0956 | sidebar preferences | [user-preference.ts](../../../src/server/workspace/user-preference.ts) | Đã có, không đổi |
| 0897, 0923, 0929, 0954 | `get_serializer_class` | [serializers.ts](../../../src/server/workspace/serializers.ts) | Thay bằng chọn Zod schema theo thao tác |
| 0287-0293, 1974-1979 | permission classes | [permissions.ts](../../../src/server/workspace/permissions.ts) | Hàm kiểm tra `(db, actor, slug, method?)`. Service hiện dùng `getWorkspace(minRole)`, chưa gọi các hàm này |
| 0311-0314, 0382, 0387-0393 | DTO, entity data | [presenters.ts](../../../src/server/workspace/presenters.ts) | `getFavoriteEntities` dùng chung cho favorite và recent visit |
| 1400, 1401, 1480, 1512-1528 | model rules, nhãn `__str__` | [model-rules.ts](../../../src/server/workspace/model-rules.ts), [presenters.ts](../../../src/server/workspace/presenters.ts) | 1520: slug đổi thành `<slug>__<epoch>` khi xóa mềm. 1521 (`saveWorkspaceBaseModel`) có sẵn nhưng service dùng `requireProjectAccess` để kiểm tra project thuộc workspace. |
| 0017-0019, 0380, 0381 | validation | [schema.ts](../../../src/types/workspace/schema.ts) | `workspaceInviteApi*`, `createWorkspaceInputSchema` |
| 0862, 0863 | `retrieve`, `update` | [workspaces.ts](../../../src/server/api/v1/routes/workspaces.ts) | `PUT` và `PATCH` cùng handler |

PD để trống hoặc ngoài phạm vi:

- PD-0394 (`stickyInputSchema`): đã có ở `src/types/reporting/schema.ts` (nhóm sticky). Không nhân đôi. Integrator tick theo schema đó.
- PD-0903/0906/0907 liên kết tới PD-1237 (`workspace_invitation`, nhóm 09): nghiệp vụ gửi mail đã làm ở `sendWorkspaceInvitation` trong `jobs.ts` theo yêu cầu. Nhóm 09 không cần làm trùng, nếu làm thì không enqueue hai lần.
- Cache invalidation (`invalidate_cache`) của Plane: không có Redis cache ở Lancity nên bỏ.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

Router sẵn có không đổi tên. Thêm các router mới. `workspaceJoinRoutes` PHẢI mount trước `workspacesRoutes` vì các router `/workspaces` đều có `use('*', authenticate)`, nếu không `GET .../invitations/:id/join` sẽ bị chặn 401.

```ts
import { userWorkspaceInvitationsRoutes, workspaceInvitationsRoutes, workspaceJoinRoutes } from '@/server/api/v1/routes/workspace-invitations'
import { workspacesRoutes, workspaceUserRoutes } from '@/server/api/v1/routes/workspaces'

app.route(linkto.workspaces, workspaceJoinRoutes) // trước workspacesRoutes
app.route(linkto.workspaces, workspacesRoutes) // đã có
app.route(linkto.users, workspaceUserRoutes) // /users/me/workspaces..., /users/last-visited-workspace
app.route(linkto.users, userWorkspaceInvitationsRoutes) // /users/me/workspaces/invitations
```

`workspaceInvitationsRoutes` và `workspacePreferencesRoutes` đã được mount, giữ nguyên.

## (c) Schema ext

Không có. Dùng bảng sẵn có (`workspace_themes`, `workspace_home_preferences`, `user_recent_visits`, ...). Không cần migration.

## (d) Key linkto cần thêm

Hiện các đường dẫn nằm ở [src/server/workspace/routes.ts](../../../src/server/workspace/routes.ts) (`workspaceApiRoutes`). Nên chuyển vào `apiV1Routes` rồi đổi import:

`workspaceMembersLite`, `workspaceMemberLeave`, `workspaceMemberMe`, `workspaceMemberViews`, `workspaceProjectMembers`, `workspaceThemes`, `workspaceTheme`, `workspaceUserProperties`, `workspaceUserProfile`, `workspaceUserIssues`, `workspaceUserActivity`, `workspaceUserActivityExport`, `workspaceUserStats`, `workspaceHomePreferences`, `workspaceHomePreference`, `workspaceRecentVisits`, `workspaceInvitationJoin`, `userWorkspaces`, `userWorkspaceInvitations`, `userWorkspaceDashboard`, `userActivityGraph`, `userIssuesCompletedGraph`, `lastVisitedWorkspace`.

Ngoài ra `linkto.workspaceInvitations: '/workspace-invitations'` (trang web của link trong email, hằng `workspaceInvitationPage` trong `routes.ts`). Thêm `publicPaths` cho trang này nếu trang cho phép khách xem lời mời.

## (e) Dependency, binding, env

- Không thêm dependency hay binding. Dùng `JOBS_QUEUE`, `sendMail` có sẵn.
- `BETTER_AUTH_URL` được dùng làm gốc URL trong email mời. Cần là URL công khai của Worker.
- Job mới đăng ký qua `register()` ở `src/server/workspace/jobs.ts`: `workspace.send_invitation`, `workspace.seed`, `workspace.record_recent_visit`.

## (f) Việc còn dang dở

- Trang web `/workspace-invitations` (đọc `invitation_id`, `slug`, `token`, gọi `GET`/`POST .../join`) chưa có. Link trong email trỏ tới trang này.
- Seed chỉ tạo project mẫu cùng state mặc định và bật cycle/module/view. Issue, label, page, cycle, module, view của seed Plane thuộc nhóm 15 (PD-1238 đến PD-1247). Nhóm đó có thể đăng ký lại handler `workspace.seed` (đăng ký lại cùng type sẽ thay thế).
- `GET .../user-issues/:userId`: `group_by` chỉ nhóm trong trang hiện tại (state_id, state__group, priority, project_id, cycle_id), chưa có `sub_group_by` và phân trang theo từng nhóm như `GroupedOffsetPaginator`. Bộ lọc là tập con của `issue_filters` (priority, state, state_group, project, labels, assignees, created_by, start_date, target_date). Nhóm 05 (PD-1883, PD-1840) có thể thay bằng bộ lọc chung.
- Phân trang tự viết ở `src/server/workspace/pagination.ts` (cursor `perPage:page:isPrev`). Nếu muốn dùng chung `src/server/common/pagination.ts` thì đổi sau.
- Các hàm trong `permissions.ts` chưa được service gọi trực tiếp.
- Chưa chạy typecheck. Điểm dễ lỗi kiểu: `db.batch` trong `leaveWorkspaceMember` và `respondInvitations` (dùng `db.$client.batch` như code cũ), kiểu của `.on(['PATCH', 'PUT'], ...)` trong Hono.
