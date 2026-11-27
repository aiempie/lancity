import { Menu } from '@base-ui/react/menu'
import { Popover } from '@base-ui/react/popover'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AddOutline, CopyOutline } from '@/components/editor/icons'
import { Button } from './components/button'
import { Collapsible } from './components/collapsible'
import { Icon } from './components/icon'
import { IconButton } from './components/icon-button'
import { Input } from './components/input'
import { InputField } from './components/input-field'
import { Tab, Tabs, TabsList, TabsPanel } from './components/tabs'
import { Tooltip } from './components/tooltip'
import { Button as ButtonElement } from './elements/button'
import { IconButton as IconButtonElement } from './elements/icon-button'
import { Input as InputElement } from './elements/input'
import { MenuItem, MenuItemContent, MenuItemTitle, MenuPopup } from './elements/menu'
import { PopoverPopup } from './elements/popover'
import {
  SuggestionMenu,
  SuggestionMenuGroup,
  SuggestionMenuItem,
  SuggestionMenuLabel
} from './elements/suggestion-menu'
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from './elements/toolbar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLElement | undefined

async function render(node: ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // Async act also flushes effects that update state after mount (Base UI ScrollArea measures itself).
  await act(async () => root!.render(node))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
})

describe('restored Propel primitives', () => {
  it('Button renders its label, icon and the Lancity button styles', async () => {
    const el = await render(<Button variant='primary' size='md' label='Create' icon={<Icon icon={AddOutline} />} />)
    const button = el.querySelector('button')!
    expect(button.textContent).toBe('Create')
    expect(button.getAttribute('data-slot')).toBe('button')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.getAttribute('type')).toBe('button')
  })

  it('Button in loading state is busy and disabled', async () => {
    const el = await render(<Button variant='secondary' size='sm' label='Save' loading />)
    const button = el.querySelector('button')!
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('maps Propel variants and sizes to the Lancity button', async () => {
    const el = await render(
      <>
        <ButtonElement variant='danger' size='sm'>
          Delete
        </ButtonElement>
        <IconButtonElement variant='ghost' size='lg' aria-label='More' />
      </>
    )
    const [danger, icon] = el.querySelectorAll('button')
    expect(danger.className).toContain('text-destructive')
    expect(danger.className).toContain('h-7')
    expect(icon.className).toContain('size-9')
  })

  it('IconButton keeps its accessible name', async () => {
    const el = await render(
      <IconButton variant='ghost' size='sm' aria-label='Copy link' icon={<Icon icon={CopyOutline} />} />
    )
    expect(el.querySelector('button')!.getAttribute('aria-label')).toBe('Copy link')
  })

  it('Tooltip renders its trigger', async () => {
    const el = await render(
      <Tooltip label='Hint'>
        <button type='button'>Trigger</button>
      </Tooltip>
    )
    expect(el.querySelector('button')!.textContent).toBe('Trigger')
  })

  it('inputs render native inputs', async () => {
    const el = await render(
      <>
        <Input size='lg' aria-label='Name' />
        <InputElement size='lg' aria-label='Plain' />
        <InputField size='lg' orientation='vertical' label='Email' hint='We never share it' />
      </>
    )
    expect(el.querySelectorAll('input')).toHaveLength(3)
    expect(el.textContent).toContain('Email')
    expect(el.textContent).toContain('We never share it')
  })

  it('Collapsible toggles its panel', async () => {
    const el = await render(
      <Collapsible trigger='Details'>
        <p>Body</p>
      </Collapsible>
    )
    const trigger = el.querySelector('button')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    act(() => trigger.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain('Body')
  })

  it('Tabs switch panels', async () => {
    const el = await render(
      <Tabs variant='underline' defaultValue='a'>
        <TabsList>
          <Tab value='a' label='A' />
          <Tab value='b' label='B' />
        </TabsList>
        <TabsPanel value='a'>Panel A</TabsPanel>
        <TabsPanel value='b'>Panel B</TabsPanel>
      </Tabs>
    )
    const tabs = el.querySelectorAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    act(() => (tabs[1] as HTMLElement).click())
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  })

  it('menu, popover, suggestion menu and toolbar elements render', async () => {
    const el = await render(
      <>
        <MenuPopup elevation='raised'>
          <MenuItem layout='single'>
            <MenuItemContent>
              <MenuItemTitle>Copy</MenuItemTitle>
            </MenuItemContent>
          </MenuItem>
        </MenuPopup>
        <PopoverPopup>Popover</PopoverPopup>
        <SuggestionMenu>
          <SuggestionMenuGroup>
            <SuggestionMenuLabel>Blocks</SuggestionMenuLabel>
            <SuggestionMenuItem>Heading</SuggestionMenuItem>
          </SuggestionMenuGroup>
        </SuggestionMenu>
        <Toolbar size='sm' elevation='raised'>
          <ToolbarGroup>
            <ToolbarButton size='sm' aria-label='Bold'>
              B
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarSeparator />
        </Toolbar>
      </>
    )
    for (const text of ['Copy', 'Popover', 'Blocks', 'Heading']) expect(el.textContent).toContain(text)
    expect(el.querySelector('button[aria-label="Bold"]')).not.toBeNull()
  })

  it('composes with Base UI Menu and Popover roots', async () => {
    const el = await render(
      <>
        <Menu.Root>
          <Menu.Trigger>Open menu</Menu.Trigger>
        </Menu.Root>
        <Popover.Root>
          <Popover.Trigger>Open popover</Popover.Trigger>
        </Popover.Root>
      </>
    )
    expect(el.querySelectorAll('button')).toHaveLength(2)
  })
})
