import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth'
import { auditTimestamps, auditUsers, timestamp } from './columns'

/** Historical Plane dashboard tables, retained for importing pre-0092 data. */
export const widgets = sqliteTable('widgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ...auditTimestamps(),
  key: text('key').notNull(),
  logoProps: text('logo_props', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  filters: text('filters', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({})
})

export const dashboards = sqliteTable('dashboards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ...auditTimestamps(),
  ...auditUsers(),
  name: text('name').notNull(),
  logoProps: text('logo_props', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  deletedAt: timestamp('deleted_at'),
  descriptionHtml: text('description_html').notNull().default('<p></p>'),
  identifier: text('identifier'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  typeIdentifier: text('type_identifier').notNull().default('home'),
  ownedById: integer('owned_by_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
})

export const dashboardWidgets = sqliteTable(
  'dashboard_widgets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ...auditTimestamps(),
    ...auditUsers(),
    dashboardId: integer('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    widgetId: integer('widget_id')
      .notNull()
      .references(() => widgets.id, { onDelete: 'cascade' }),
    deletedAt: timestamp('deleted_at'),
    isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true),
    sortOrder: real('sort_order').notNull().default(65535),
    filters: text('filters', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    properties: text('properties', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({})
  },
  table => [
    uniqueIndex('dashboard_widgets_widget_dashboard_deleted_idx').on(
      table.widgetId,
      table.dashboardId,
      table.deletedAt
    ),
    uniqueIndex('dashboard_widgets_live_idx')
      .on(table.widgetId, table.dashboardId)
      .where(sql`${table.deletedAt} is null`)
  ]
)
