<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project Architecture & Type Conventions

## Schema and Type Organization

- Tất cả các TypeScript type và Zod validation schema phải được quản lý tập trung theo cấu trúc domain trong thư mục `src/types/`.
- Cấu trúc đường dẫn chuẩn: `src/types/<domain>/schema.ts` (Ví dụ: `src/types/auth/schema.ts` chứa `loginSchema` và `LoginFormValues`).
- Tất cả các component/form hoặc API handler cần import schema và type từ `@/types/<domain>/schema`.

## Routing & Navigation Conventions

- **Tập trung quản lý đường dẫn**: Tất cả các đường dẫn URL trong ứng dụng phải được khai báo và quản lý tập trung trong file `@/data/linkto.ts`.
- **Component Link tùy chỉnh**: Khi tạo liên kết chuyển trang (Navigation), bắt buộc phải import và sử dụng custom component `<Link>` từ `@/components/ui/custom/link` (với `href={linkto.<key>}`) thay vì import trực tiếp từ `next/link`.
- **Hook điều hướng Client**: Khi thực hiện điều hướng chuyển trang trong mã Client (Imperative Routing), phải import `useRouter` từ `@/hooks/use-router` thay vì `next/navigation`.

## Database & Primary Key Conventions

- **Chỉ sử dụng ID tự tăng**: Tất cả các bảng cơ sở dữ liệu (Primary Keys) trong ứng dụng phải sử dụng khóa chính ID số tự tăng (`serial('id').primaryKey()`) thay vì UUID hay chuỗi ngẫu nhiên.

## Component & UI Conventions

- **Nút Xóa / Thao tác Xóa**: Tất cả các nút (Button) thực hiện hành động xóa hoặc hủy nguy hiểm bắt buộc phải luôn luôn sử dụng `variant="destructive"`.
- **Nút Nhập, Xuất, Sửa & Quay lại**: Tất cả các nút Nhập dữ liệu (Import), Xuất dữ liệu (Export), Chỉnh sửa (Edit) và Quay lại (Back / Hủy bỏ) bắt buộc phải sử dụng `variant="secondary"`.
- **Bảng dữ liệu & Phân trang (Table & Pagination)**: Tất cả các bảng danh sách dữ liệu có chức năng tìm kiếm hoặc phân trang bắt buộc phải import và sử dụng custom component `<TableLayout>` từ `@/components/ui/custom/table-layout` để đảm bảo tính nhất quán về giao diện, tìm kiếm và phân trang trên toàn hệ thống.
- **Component Select / Dropdown**: Do thư viện UI dùng `@base-ui/react/select`, tất cả các component `<Select>` bắt buộc phải truyền prop `items={...}` chứa danh sách các option (dạng `{ value: string, label: string }`) và giá trị `value` không được truyền `undefined` (nếu không có giá trị phải truyền chuỗi rỗng `''` hoặc `'none'`) để tránh lỗi render và mất đồng bộ hiển thị.
