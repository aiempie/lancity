import { Menu } from '@base-ui/react/menu'
import { describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Button } from './components/button'
import { MenuItem, MenuItemContent, MenuItemTitle, MenuPopup } from './elements/menu'

function TestMenu({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button variant='secondary' size='md' label='Actions' />} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup render={<MenuPopup elevation='raised' />}>
            {['Copy', 'Edit'].map(label => (
              <Menu.Item key={label} render={<MenuItem layout='single' />} onClick={() => onSelect(label)}>
                <MenuItemContent>
                  <MenuItemTitle>{label}</MenuItemTitle>
                </MenuItemContent>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

describe('Propel menu in a real browser', () => {
  it('opens from the keyboard, moves focus to the items and returns focus to the trigger on Escape', async () => {
    const screen = await render(<TestMenu onSelect={() => undefined} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger.element())

    await userEvent.keyboard('{Enter}')
    const menu = screen.getByRole('menu')
    await expect.element(menu).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(() => document.activeElement?.textContent).toMatch(/Copy|Edit/)

    await userEvent.keyboard('{Escape}')
    await expect.element(menu).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(trigger.element())
  })

  it('selects an item with Enter', async () => {
    const selected: string[] = []
    const screen = await render(<TestMenu onSelect={value => selected.push(value)} />)
    await screen.getByRole('button', { name: 'Actions' }).click()
    await screen.getByRole('menuitem', { name: 'Edit' }).click()
    expect(selected).toEqual(['Edit'])
  })
})
