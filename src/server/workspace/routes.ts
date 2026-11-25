import { apiV1Routes, linkto } from '@/data/linkto'
// Paths of the workspace API, relative to the mount point. The literals live in src/data/linkto.ts (apiV1Routes).
export const workspaceApiRoutes = {
  // Mounted at linkto.workspaces
  workspaceMembersLite: apiV1Routes.workspaceMembersLite,
  workspaceMemberLeave: apiV1Routes.workspaceMemberLeave,
  workspaceMemberMe: apiV1Routes.workspaceMemberMe,
  workspaceMemberViews: apiV1Routes.workspaceMemberViews,
  workspaceProjectMembers: apiV1Routes.workspaceProjectMembers,
  workspaceThemes: apiV1Routes.workspaceThemes,
  workspaceTheme: apiV1Routes.workspaceTheme,
  workspaceUserProperties: apiV1Routes.workspaceUserProperties,
  workspaceUserProfile: apiV1Routes.workspaceUserProfile,
  workspaceUserIssues: apiV1Routes.workspaceUserIssues,
  workspaceUserActivity: apiV1Routes.workspaceUserActivity,
  workspaceUserActivityExport: apiV1Routes.workspaceUserActivityExport,
  workspaceUserStats: apiV1Routes.workspaceUserStats,
  workspaceHomePreferences: apiV1Routes.workspaceHomePreferences,
  workspaceHomePreference: apiV1Routes.workspaceHomePreference,
  workspaceRecentVisits: apiV1Routes.workspaceRecentVisits,
  workspaceInvitationJoin: apiV1Routes.workspaceInvitationJoin,
  // Mounted at linkto.users
  userWorkspaces: apiV1Routes.userWorkspaces,
  userWorkspaceInvitations: apiV1Routes.userWorkspaceInvitations,
  userWorkspaceDashboard: apiV1Routes.userWorkspaceDashboard,
  userActivityGraph: apiV1Routes.userActivityGraph,
  userIssuesCompletedGraph: apiV1Routes.userIssuesCompletedGraph,
  lastVisitedWorkspace: apiV1Routes.lastVisitedWorkspace
} as const

/** Front-end page that finishes an invitation (the e-mail link). */
export const workspaceInvitationPage = linkto.workspaceInvitations
