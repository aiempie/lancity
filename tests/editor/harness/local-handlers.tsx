import { CheckSquareOffsetIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import type { TEmbedConfig, TMentionHandler } from '@/components/editor'
import { HARNESS_MEMBERS, HARNESS_WORK_ITEMS, HARNESS_WORKSPACE } from './fixtures'

// Test harness: stand-ins for the handlers that the editor gets from the app, on fake data. Images: local-files.ts.
// Section titles are fixed English test strings.

const matches = (query: string, ...values: string[]) =>
  values.some(value => value.toLowerCase().includes(query.trim().toLowerCase()))

const member = (id: string) => HARNESS_MEMBERS.find(item => item.id === id)

function Initial({ name }: { name: string }) {
  return (
    <span className='grid size-4 place-items-center rounded-full bg-accent-primary text-[9px] font-semibold text-on-color'>
      {name.slice(0, 1)}
    </span>
  )
}

function MentionChip({ id }: { id: string }) {
  return (
    <span className='rounded-sm bg-accent-primary/10 px-1 font-medium text-accent-primary'>
      @{member(id)?.display_name ?? id}
    </span>
  )
}

function WorkItemCard({ issueId }: { issueId: string }) {
  const item = HARNESS_WORK_ITEMS.find(workItem => workItem.id === issueId)
  return (
    <div
      data-testid='work-item-card'
      className='issue-embed my-2 flex items-center gap-2 rounded-md border border-subtle bg-layer-1 px-3 py-2 text-sm'
    >
      <CheckSquareOffsetIcon className='size-4 shrink-0 text-tertiary' />
      {item ? (
        <>
          <span className='shrink-0 font-medium text-tertiary'>{item.key}</span>
          <span className='truncate'>{item.name}</span>
          <span className='ml-auto shrink-0 rounded-sm bg-layer-3 px-1.5 text-xs'>{item.state}</span>
        </>
      ) : (
        <span className='text-tertiary'>Work item {issueId} not found</span>
      )}
    </div>
  )
}

/** Mentions of the fake members and embeds of the fake work items. */
export function useHarnessHandlers() {
  return useMemo(() => {
    const mentionHandler: TMentionHandler = {
      renderComponent: ({ entity_identifier }) => <MentionChip id={entity_identifier} />,
      getMentionedEntityDetails: id => {
        const found = member(id)
        return found ? { display_name: found.display_name } : undefined
      },
      searchCallback: async query => [
        {
          key: 'members',
          title: 'Members',
          items: HARNESS_MEMBERS.filter(item => matches(query, item.display_name, item.full_name)).map(item => ({
            id: item.id,
            entity_identifier: item.id,
            entity_name: 'user_mention',
            title: item.display_name,
            subTitle: item.full_name,
            icon: <Initial name={item.display_name} />
          }))
        }
      ]
    }
    const embedHandler: TEmbedConfig = {
      issue: {
        widgetCallback: ({ issueId }) => <WorkItemCard issueId={issueId} />,
        searchCallback: async query => [
          {
            key: 'work-items',
            title: 'Work items',
            items: HARNESS_WORK_ITEMS.filter(item => matches(query, item.key, item.name)).map(item => ({
              id: item.id,
              entity_identifier: item.id,
              entity_name: 'issue',
              project_identifier: item.projectId,
              workspace_identifier: HARNESS_WORKSPACE,
              title: item.name,
              subTitle: item.key,
              icon: <CheckSquareOffsetIcon className='size-4' />
            }))
          }
        ]
      }
    }
    return { mentionHandler, extendedEditorProps: { embedHandler } }
  }, [])
}

/** Stored mentions render with a placeholder name when the page is shown without the harness handlers. */
export const harnessMentionHandler: TMentionHandler = {
  renderComponent: ({ entity_identifier }) => <MentionChip id={entity_identifier} />
}

/** Mentioned users and images for the Markdown copy (`getEditorMetaData`). */
export const getHarnessEditorMetaData = () => ({
  file_assets: [],
  user_mentions: HARNESS_MEMBERS.map(item => ({
    id: item.id,
    display_name: item.display_name,
    url: `/users/${item.id}`
  }))
})
