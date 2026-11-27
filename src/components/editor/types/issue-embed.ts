import type { TMentionSuggestion } from './mention'

export type TEmbedConfig = {
  issue?: TIssueEmbedConfig
}

export type TReadOnlyEmbedConfig = TEmbedConfig

/** Lancity: a work item offered by the embed picker. `entity_identifier` is the work item id. */
export type TWorkItemEmbedSuggestion = TMentionSuggestion & {
  project_identifier?: string
  workspace_identifier?: string
}

export type TWorkItemEmbedSection = {
  key: string
  title?: string
  items: TWorkItemEmbedSuggestion[]
}

export type TIssueEmbedConfig = {
  widgetCallback: ({
    issueId,
    projectId,
    workspaceSlug
  }: {
    issueId: string
    projectId: string | undefined
    workspaceSlug: string | undefined
  }) => React.ReactNode
  /** Lancity: work items for the picker of the "Work item" slash command. Without it the command is hidden. */
  searchCallback?: (query: string) => Promise<TWorkItemEmbedSection[]>
}
