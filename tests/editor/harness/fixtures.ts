// Test data for the editor harness: fake users, members and work items (document data, not UI strings).

/** Two people editing the same page, one per document frame. */
export const HARNESS_USERS = [
  { id: '1', name: 'An', color: '#5e6ad2' },
  { id: '2', name: 'Bình', color: '#e57a00' }
] as const

/** Workspace members offered by `@` mentions. */
export const HARNESS_MEMBERS = [
  { id: '1', display_name: 'An', full_name: 'Nguyễn Văn An' },
  { id: '2', display_name: 'Bình', full_name: 'Trần Thị Bình' },
  { id: '3', display_name: 'Chi', full_name: 'Lê Minh Chi' },
  { id: '4', display_name: 'Hiro', full_name: 'Sato Hiroshi' }
] as const

export const HARNESS_WORKSPACE = 'harness'

/** Work items offered by the "Work item" slash command. */
export const HARNESS_WORK_ITEMS = [
  { id: '101', projectId: '7', key: 'LAN-12', name: 'Thiết kế trang đăng nhập', state: 'In progress' },
  { id: '102', projectId: '7', key: 'LAN-13', name: 'Đồng bộ trang qua Durable Object', state: 'Todo' },
  { id: '103', projectId: '7', key: 'LAN-14', name: 'ログイン画面の翻訳', state: 'Done' }
] as const
