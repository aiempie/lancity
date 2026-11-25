import {
  createQuickLinkSchema,
  updateQuickLinkSchema,
  updateWorkspaceHomePreferenceSchema,
  updateWorkspacePreferencesSchema,
  recentVisitQuerySchema
} from '@/types/workspace/schema'

// Replaces the get_serializer_class hooks of the Plane viewsets: the schema of each operation is chosen explicitly.
export const selectQuickLinkSchema = (operation: 'create' | 'update') =>
  operation === 'create' ? createQuickLinkSchema : updateQuickLinkSchema
export const selectWorkspaceHomePreferenceSchema = () => updateWorkspaceHomePreferenceSchema
export const selectWorkspaceUserPreferenceSchema = () => updateWorkspacePreferencesSchema
export const selectUserRecentVisitSchema = () => recentVisitQuerySchema
