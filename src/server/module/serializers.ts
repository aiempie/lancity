import type { ModuleListQuery } from '@/types/planning/p2-module-schema'

/** Plane `ModuleViewSet.get_serializer_class` (PD-0665): the write schema for mutations, the read DTO otherwise. */
export type ModuleSchemaKind = 'write' | 'read'
export function selectModuleSchema(
  action: 'create' | 'update' | 'partial_update' | 'list' | 'retrieve' | 'destroy'
): ModuleSchemaKind {
  return action === 'create' || action === 'update' || action === 'partial_update' ? 'write' : 'read'
}

const toCamel = (key: string) => key.replace(/_+([a-z])/g, (_, letter: string) => letter.toUpperCase())

/** `?fields=a_b,c` as the camelCase keys of the response (Plane clients send snake_case names). */
export function requestedFields(query: Pick<ModuleListQuery, 'fields'>): string[] | null {
  const names = (query.fields ?? '').split(',').filter(Boolean)
  return names.length ? names.flatMap(name => [name, toCamel(name)]) : null
}

/** `?expand=lead,members` as a list, or null. */
export function requestedExpand(query: Pick<ModuleListQuery, 'expand'>): string[] | null {
  const names = (query.expand ?? '').split(',').filter(Boolean)
  return names.length ? names : null
}
