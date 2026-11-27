import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Logo } from './logo'
import { LUCIDE_ICONS_LIST } from './lucide-icons'
import { getRandomIconName } from './random-icon'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

async function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(node))
  return container
}

describe('Lucide-named callout icons drawn with Phosphor', () => {
  it('keep the 157 names Plane stores in callouts, each with a component', () => {
    expect(LUCIDE_ICONS_LIST).toHaveLength(157)
    expect(new Set(LUCIDE_ICONS_LIST.map(icon => icon.name)).size).toBe(157)
    for (const icon of LUCIDE_ICONS_LIST) expect(icon.element, icon.name).toBeTruthy()
    for (const name of ['AlertCircle', 'Code', 'Epic', 'Formula', 'Map', 'UsersRound'])
      expect(
        LUCIDE_ICONS_LIST.some(icon => icon.name === name),
        name
      ).toBe(true)
  })

  it('picks a random name from the list', () => {
    expect(LUCIDE_ICONS_LIST.map(icon => icon.name)).toContain(getRandomIconName())
  })

  it('Logo renders a stored icon name in its color and an emoji from its code points', async () => {
    const el = await render(
      <>
        <Logo logo={{ in_use: 'icon', icon: { name: 'AlertCircle', color: 'rgb(1, 2, 3)' } }} size={18} />
        <Logo logo={{ in_use: 'emoji', emoji: { value: '128512' } }} size={18} />
        <Logo logo={{ in_use: 'icon', icon: { name: 'NotAnIcon' } }} />
      </>
    )
    const svg = el.querySelector('svg')!
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('style')).toContain('rgb(1, 2, 3)')
    expect(el.textContent).toContain('😀')
    expect(el.querySelectorAll('svg')).toHaveLength(1)
  })
})
