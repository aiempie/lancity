# Handoff p1-project (04-project.md, 122 mục)

Chưa chạy test, build, typecheck theo quy ước. ESLint sạch trên mọi file bên dưới. Test: [tests/p1-project.integration.mjs](../../../tests/p1-project.integration.mjs) (hai ca: vòng đời project, lời mời project). Test cũ [tests/project.integration.mjs](../../../tests/project.integration.mjs) và [tests/project.test.mjs](../../../tests/project.test.mjs) vẫn dùng `joinProject`, `leaveProject` giữ nguyên.

## (a) PD đã xong

File chính: [service.ts](../../../src/server/project/service.ts) (CRUD, archive, identifier, favorite, deploy board, summary, project-views), [member.ts](../../../src/server/project/member.ts), [invite.ts](../../../src/server/project/invite.ts), [api.ts](../../../src/server/project/api.ts) (dạng public API: phân trang, lite, `fields`/`expand`), [queries.ts](../../../src/server/project/queries.ts), [permissions.ts](../../../src/server/project/permissions.ts), [model-rules.ts](../../../src/server/project/model-rules.ts), [presenters.ts](../../../src/server/project/presenters.ts), [emails.ts](../../../src/server/project/emails.ts), [events.ts](../../../src/server/project/events.ts), [jobs.ts](../../../src/server/project/jobs.ts), route [projects.ts](../../../src/server/api/v1/routes/projects.ts), Zod [schema.ts](../../../src/types/project/schema.ts), UI [src/app/projects](../../../src/app/projects). Test tích hợp bao phủ luồng chính của từng nhóm PD (tạo, sửa, archive, xóa, favorite, deploy board, thành viên, preference, lời mời, summary). Các nhánh lỗi hiếm chưa có test riêng.

**`apps/api/plane/api/views/member.py`**
- PD-0191, 0192, 0193, 0194, 0195: gộp vào route `members` (GET, POST, PATCH, DELETE). POST nhận `{ memberId, role }`, `{ members: [...] }` hoặc `{ member, role }` của API công khai. Dịch vụ: `listProjectMembers`, `createProjectMember`, `getProjectMember`, `patchProjectMember`, `deleteProjectMember`.
- PD-0188 (`member_fields`): email chỉ trả cho thành viên workspace không phải guest (`showEmail` trong `listProjectMembersLiteApi`, và `listProjectMembers`).
- PD-0190: `getPermissionsProjectMemberListCreateAPI` trong permissions.ts.
- PD-0198, 0199: `GET project-members-lite` → `listProjectMembersLiteApi`.

**`apps/api/plane/api/views/project.py`**
- PD-0223 `hasWorkspaceRole` (permissions.ts) và `visibleToApi` (queries.ts). PD-0224, 0229, 0232: `queryProjectListCreateAPI`, `queryProjectListLiteAPI`, `queryProjectDetailAPI`.
- PD-0225, 0226: `GET /projects?per_page=…` → `listProjectsApi`. PD-0230, 0231: `GET /projects-lite` → `listProjectsLiteApi`. PD-0233: `GET /projects/:id?fields=…|expand=…` → `getProjectApi`.
- PD-0227, 0228: `createProject` (đẩy job `webhook.model_activity`). PD-0234: `updateProject`. PD-0235: `deleteProject`. Cả hai nhận `mode: 'api'` để dùng quyền của `ProjectBasePermission`; route mặc định dùng `'app'`.
- PD-0236, 0237: `createProjectArchiveUnarchive`, `deleteProjectArchiveUnarchive`.
- PD-0238 đến 0248: `getProjectSummary` (route `GET /projects/:id/summary?fields=`). Mỗi lambda là một câu đếm trong bảng `counters`.

**`apps/api/plane/app/views/project/base.py`**
- PD-0734: `queryProject`. PD-0735, 0736: `listDetailProject` (`GET /projects/details`). PD-0737: `listProjects`. PD-0738: `getProject`. PD-0739 và 0356: `createProject`. PD-0740: `updateProject`. PD-0741: `deleteProject`.
- PD-0742, 0743: `createProjectArchiveUnarchive`, `deleteProjectArchiveUnarchive`. PD-0744, 0745: `getProjectIdentifier`, `deleteProjectIdentifier`. PD-0746: `createProjectUserViews`.
- PD-0747, 0748, 0749, 0750, 0751: `listProjectFavorites`, `queryProjectFavorites`, `createProjectFavorites` (gồm bước perform_create), `deleteProjectFavorites`.
- PD-0752 đến 0757 và 0753: `getDeployBoard`, `listDeployBoards`, `createDeployBoard`, `updateDeployBoard`, `deleteDeployBoard`, `queryDeployBoard`. PD-0733 (PUT): cùng handler với PATCH.

**`apps/api/plane/app/views/project/invite.py`**
- PD-0758, 0759, 0760, 0761, 0762: `queryProjectInvitations`, `listProjectInvitations`, `getProjectInvitations`, `deleteProjectInvitations`, `createProjectInvitations`.
- PD-0763, 0764, 0765: `listUserProjectInvitations`, `queryUserProjectInvitations`, `createUserProjectInvitations`.
- PD-0766, 0767: `createProjectJoin`, `getProjectJoin`.

**`apps/api/plane/app/views/project/member.py`**
- PD-0768 `withoutPersonalFields`, 0769 `queryProjectMember`, 0770 `createProjectMember`, 0771 `listProjectMembers`, 0772 `getProjectMember`, 0773 `patchProjectMember`, 0774 `deleteProjectMember`, 0775 `leaveProject` (giữ nguyên), 0776 `getProjectMemberUser`, 0777 `getUserProjectRoles`, 0778 `queryProjectMemberPreference`, 0779 `updateProjectMemberPreference`, 0780 `getProjectMemberPreference`.

**Serializer, permission, model**
- PD-0032, 0033, 0034: `projectMemberApiValidateMember`, `projectMemberApiValidateRole`, `projectMemberApiInputSchema` trong schema.ts. Phần cần đọc D1 (thành viên workspace còn hoạt động, trần vai trò) nằm ở `assertRoleMatchesWorkspace` trong member.ts.
- PD-0040, 0043, 0353, 0354, 0355, 0359, 0360: Zod trong schema.ts (`createProjectSchema`, `updateProjectSchema`, `projectMemberPreferenceValidatePreferences`...) cộng kiểm tra D1 trong service (lead và assignee phải là thành viên workspace, state mặc định và estimate phải thuộc project, intake của deploy board phải thuộc project, trùng tên/identifier trả 409).
- PD-0041, 0042, 0044: gộp vào `createProject`, `updateProject`.
- PD-0281 đến 0286 và 1969 đến 1973: `hasPermissionProject*Permission` trong permissions.ts (nhận `ProjectAccess` từ `loadProjectAccess` hoặc `loadProjectScope`).
- PD-0357, 0358: `getMembersProjectList`, `getNextWorkItemSequenceProjectList` trong presenters.ts. PD-1469, 1473, 1475, 1478, 1479: hàm `format*` cùng file.
- PD-1464 đến 1468, 1470, 1471, 1476, 1477: model-rules.ts. PD-1470 trả danh sách câu UPDATE để chạy cùng batch với đổi timezone.
- PD-1472, 1474: `userPropertyInsert` (hàng `project_user_properties` với `sort_order = min - 10000` trong đúng workspace của project), dùng ở mọi chỗ tạo thành viên.

**PD không port hết, kèm lý do**
- Ghi nhận hoạt động gần đây khi mở project (`recent_visited_task` trong PD-0738): thuộc nhóm workspace (`src/server/workspace/recent-visit.ts`). `getProject` chưa ghi. Integrator gọi hàm ghi của nhóm đó trong route nếu cần.
- Làm sạch `description_html` (PD-1715, nhóm 08): chưa gọi. `descriptionHtml` được lưu nguyên. Cần nối `validateHtmlContent` khi file `src/server/page/content-validator.ts` có.
- Lọc bot (`member__is_bot=False`): bảng `user_security` ở [ext-p1-auth.ts](../../../src/db/schema/ext-p1-auth.ts) chưa gộp vào schema, nên danh sách thành viên chưa loại bot.
- Bảng cũ `ProjectDeployBoard` (đánh dấu DEPRECATED trong Plane): không dùng. Deploy board dùng bảng `deploy_boards`.
- Email Plane dùng template HTML Django. Ở đây dùng `renderEmail`.

**Khác Plane có chủ đích**
- `GET /join/:invitationId` (công khai) yêu cầu thêm `?token=`, vì ID tự tăng đoán được. Liên kết trong email đã có token. Chữ `message` của lời mời không còn lưu nội dung email (tránh lộ email và token).
- Gỡ thành viên chỉ đặt `is_active = false` (như Plane), không còn đặt `deleted_at`. Xóa admin cuối cùng (kể cả API) vẫn bị chặn bằng 409.
- `GET /projects/:id` (dạng web): người không phải thành viên nhận 403 (secret) hoặc 409 (public), project đã archive là 404. Trước đây luôn là 404.
- `patchProjectMember` giữ thêm quy tắc cũ: admin workspace chỉ được là admin project.
- `project-members-lite` bỏ thành viên đã gỡ. `listProjectsApi` tính tổng theo cùng điều kiện hiển thị.
- Quy tắc "không tự sửa vai trò của mình" của Plane chỉ áp dụng khi gửi `role` hoặc `isActive`.

## (b) Route cần đăng ký vào `src/server/api/v1/index.ts`

```ts
import { projectJoinPublicRoutes, projectsRoutes, projectUserRoutes } from '@/server/api/v1/routes/projects'

app.route(linkto.workspaces, projectJoinPublicRoutes) // phải đứng TRƯỚC projectsRoutes, vì projectsRoutes xác thực mọi route
app.route(linkto.workspaces, projectsRoutes)          // đã có
app.route(linkto.users, projectUserRoutes)            // mới: /users/me/workspaces/:slug/project-roles và .../projects/invitations
```

`projectsRoutes` được import tên cũ nên chỉ cần thêm hai dòng mới. Hai route `GET /projects/details` và `GET /projects/:projectId` đã đăng ký đúng thứ tự trong file.

## (c) Schema ext

Không có bảng hay cột mới (dùng `projects`, `project_members`, `project_member_invites`, `project_user_properties`, `deploy_boards`, `user_favorites`, `intakes`). Không cần migration.

## (d) Key linkto cần thêm

Các đường dẫn mới đang khai báo cục bộ trong `projectApiRoutes` ở [routes/projects.ts](../../../src/server/api/v1/routes/projects.ts). Chuyển sang `apiV1Routes` rồi thay import: `projectsDetails`, `projectsLite`, `projectIdentifiers`, `favoriteProjects`, `favoriteProject`, `projectArchive`, `projectSummary`, `projectViews`, `projectDeployBoards`, `projectDeployBoard`, `projectInvitations`, `projectInvitation`, `projectInvitationJoin`, `projectMemberMe`, `projectMembersLite`, `projectMemberPreference`, `userProjectRoles`, `userProjectInvitations`.

Trang web: `linkto.projectInvitations = '/projects/invitations'` (trang [invitations/page.tsx](../../../src/app/projects/invitations/page.tsx)). Hằng `PROJECT_INVITATION_PATH` trong emails.ts đang dùng chuỗi này. Nếu proxy có danh sách đường dẫn công khai, trang này cần đăng nhập nên không thêm vào.

## (e) Dependency, binding, env

- Không thêm package hay binding.
- Env: `BETTER_AUTH_URL` (đã có) dùng làm origin trong email. `GMAIL_*` dùng qua `sendMail`.
- Job mới `project.send_mail`, handler đăng ký trong `src/server/project/jobs.ts` (registry tự nạp).
- Nhóm webhook (11) cần đăng ký hai handler. Payload do project gửi: `webhook.model_activity` với `{ model_name: 'project', model_id, requested_data, current_instance, actor_id, slug }`; `webhook.activity` với `{ event: 'project', verb: 'deleted', field, old_value, new_value, actor_id, slug, event_id, old_identifier, new_identifier }`. Khi chưa có handler, job bị bỏ và ghi log, không làm lỗi request.
- Import chéo sang nhóm khác: `@/server/workspace/pagination` (`pageWindow`, `pageEnvelope`), `@/server/workspace/service` (`getWorkspace`). Đổi tên các hàm này thì phải sửa ở đây.

## (f) Còn dang dở

- Chưa chạy typecheck. Điểm dễ lỗi kiểu: chuỗi `db.batch([...] as unknown as ...)` trong `createProject`, `updateProject`, `createProjectMember`, `createProjectJoin`; `onConflictDoUpdate` với `targetWhere` trong `createDeployBoard`; kiểu trả về của `withoutPersonalFields`.
- Chưa chạy test tích hợp. Chỗ cần xem kỹ nếu test lỗi: câu SQL `insert ... select ... where exists` trong `createProjectJoin`; `db.run(sql...)` trong `db.batch` (`userPropertyInsert`); câu đếm `issues` trong `getProjectSummary` (cột `group` của `states`).
- `joinProject` (tự tham gia) vẫn tạo hàng thành viên với `view_props`, `default_props`, `preferences` mặc định rỗng `{}`, khác các luồng mới (dùng `memberDefaults()`). Không sửa vì test cũ khóa hành vi này.
- UI chỉ thêm nút Favorite, Archive, Leave trên trang `/projects` và trang nhận lời mời. Chưa có UI cho deploy board, thành viên, lời mời gửi đi, preference.
