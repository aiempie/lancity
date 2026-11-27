import { cva, type VariantProps } from 'class-variance-authority'

import { type StrictVariantProps } from '../../internal/variant-props'

const scrollAreaDefaultVariants = {
  variant: 'overlay',
  size: 'md',
  orientation: 'vertical'
} as const

// The inset lane is padding on the ROOT, not the viewport: padding on a scroll container scrolls
// with its content, so with `both` a viewport lane would only appear at the far scroll edge. The
// root is the rails' containing block (they pin to its padding box), so root padding narrows the
// viewport itself and the rails sit in a lane that never moves.
//
// Keyboard focus lands on the viewport while it is the area's Tab stop, but the ring is drawn here,
// on the root's `::after`: an inset ring on the viewport itself would sit under opaque rows and
// under the rails. Drawn here it is above the rails and above any content with no `z-index` of its
// own; with `stacking="isolate"` on the content it is above all of it. The `::after` box is always
// there and only gets its ring width while the viewport has keyboard focus: the selector matches
// only the viewport's own focus, never focus inside the content, and only while the viewport is in
// the Tab order (`tabindex="0"`), since a viewport that is out of it can still be focused by a press
// on empty space, and a key pressed after that must not ring the whole list. `rounded-[inherit]`
// lets the ring follow a rounded parent the area fills. Forced colors strips box-shadows, so the
// same box also gets an outline: transparent normally, `CanvasText` in that mode.
export const scrollAreaVariants = cva(
  [
    'relative flex h-full min-h-0 w-full flex-1 flex-col rounded-[inherit]',
    'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-accent-strong after:-outline-offset-2 after:outline-transparent after:ring-inset forced-colors:after:outline-[CanvasText]',
    "has-[>[data-slot=scroll-area-viewport][tabindex='0']:focus-visible]:after:ring-2 has-[>[data-slot=scroll-area-viewport][tabindex='0']:focus-visible]:after:outline-2"
  ],
  {
    variants: {
      /**
       * `overlay` — the scrollbar floats over the content. `inset` — the root always reserves the
       * track on each rendered axis (like `scrollbar-gutter: stable`), so the thumb never covers
       * content and content never reflows when it starts or stops overflowing.
       */
      variant: { overlay: '', inset: '' },
      /** Track the inset lane matches; mirrors the scrollbar `size`. */
      size: { sm: '', md: '', lg: '' },
      /** Which axes render a scrollbar, and so which edges an inset lane reserves. */
      orientation: { vertical: '', horizontal: '', both: '' }
    },
    compoundVariants: [
      {
        variant: 'inset',
        orientation: ['vertical', 'both'],
        size: 'sm',
        class: 'pe-(--scrollbar-track-sm)'
      },
      {
        variant: 'inset',
        orientation: ['vertical', 'both'],
        size: 'md',
        class: 'pe-(--scrollbar-track-md)'
      },
      {
        variant: 'inset',
        orientation: ['vertical', 'both'],
        size: 'lg',
        class: 'pe-(--scrollbar-track-lg)'
      },
      {
        variant: 'inset',
        orientation: ['horizontal', 'both'],
        size: 'sm',
        class: 'pb-(--scrollbar-track-sm)'
      },
      {
        variant: 'inset',
        orientation: ['horizontal', 'both'],
        size: 'md',
        class: 'pb-(--scrollbar-track-md)'
      },
      {
        variant: 'inset',
        orientation: ['horizontal', 'both'],
        size: 'lg',
        class: 'pb-(--scrollbar-track-lg)'
      }
    ],
    defaultVariants: scrollAreaDefaultVariants
  }
)

type ScrollAreaVariantConfig = VariantProps<typeof scrollAreaVariants>

export type ScrollAreaVariant = NonNullable<ScrollAreaVariantConfig['variant']>

export type ScrollAreaSize = NonNullable<ScrollAreaVariantConfig['size']>

export type ScrollAreaOrientation = NonNullable<ScrollAreaVariantConfig['orientation']>

export type ScrollAreaVariantProps = StrictVariantProps<
  typeof scrollAreaVariants,
  keyof typeof scrollAreaDefaultVariants
>

const scrollAreaViewportDefaultVariants = {
  orientation: 'vertical',
  overscroll: 'contain'
} as const

// The viewport lays its one child, the content, out as a flex column, so the content can grow to the
// viewport's height (see `scrollAreaContentVariants`). It carries no focus style of its own: the
// root draws the ring (see `scrollAreaVariants`).
export const scrollAreaViewportVariants = cva('flex min-h-0 flex-1 flex-col outline-none', {
  variants: {
    /** Which axes scroll, and so which axes `overscroll="contain"` contains. */
    orientation: { vertical: '', horizontal: '', both: '' },
    /**
     * What a scroll does at the area's edge. `contain` — it stops here, so a popup or a panel never
     * scrolls the page behind it; it is contained only on the scrolling axes, so wheel scrolling on
     * the other axis still chains. `auto` — it continues into the nearest scrollable ancestor, for
     * a list that sits inline in a scrolling page.
     */
    overscroll: { contain: '', auto: '' }
  },
  compoundVariants: [
    { orientation: 'vertical', overscroll: 'contain', class: 'overscroll-y-contain' },
    { orientation: 'horizontal', overscroll: 'contain', class: 'overscroll-x-contain' },
    { orientation: 'both', overscroll: 'contain', class: 'overscroll-contain' }
  ],
  defaultVariants: scrollAreaViewportDefaultVariants
})

type ScrollAreaViewportVariantConfig = VariantProps<typeof scrollAreaViewportVariants>

/**
 * What a scroll does when it reaches the area's edge.
 *
 * @default "contain"
 */
export type ScrollAreaOverscroll = NonNullable<ScrollAreaViewportVariantConfig['overscroll']>

export type ScrollAreaViewportVariantProps = StrictVariantProps<
  typeof scrollAreaViewportVariants,
  keyof typeof scrollAreaViewportDefaultVariants
>
export const scrollAreaCornerVariants = cva('pointer-events-none bg-transparent')

const scrollAreaContentDefaultVariants = { orientation: 'vertical', stacking: 'auto' } as const

// On a scrolling axis the content grows to at least the viewport's size and never shrinks below
// its own, so it is what overflows. A grown flex item has a definite height, so children sized
// `h-full` or `min-h-full` still fill the area as they did directly in the viewport.
export const scrollAreaContentVariants = cva('', {
  variants: {
    /**
     * Which axes scroll. Base UI sets `min-width: fit-content` inline so wide content overflows
     * sideways; an area that scrolls only vertically keeps its content at the viewport's width
     * instead, so long rows still truncate. An area that scrolls only horizontally keeps its
     * content at the viewport's height, so `h-full` children (board columns with their own vertical
     * scroll) stay bounded by it.
     *
     * The axis that does not scroll is clipped. Base UI's viewport scrolls on both axes whatever
     * rails it renders, so a stray overflow there would pan the content with nothing to show it and
     * make the viewport a Tab stop. `clip` (not `hidden`) on this non-scrolling box keeps that
     * overflow out of the viewport's scrollable range without making a second scroll container, so
     * `position: sticky` children still stick to the viewport.
     */
    orientation: {
      vertical: 'min-w-0! shrink-0 grow overflow-x-clip',
      horizontal: 'min-h-0 flex-1 overflow-y-clip',
      both: 'shrink-0 grow'
    },
    /**
     * How the content's z-indexed children stack against the rails, which carry no z-index.
     *
     * - `auto` — they compete with the rest of the page, so a sticky header with a `z-index` paints
     *   over the thumb where they meet.
     * - `isolate` — the content is its own stacking context: every child stays under the rails. The
     *   cost is that an overlay rendered inside the area without a portal (a `position: fixed`
     *   dialog or backdrop) is ordered as part of the area too, under page chrome with a
     *   `z-index`.
     */
    stacking: { auto: '', isolate: 'isolate' }
  },
  defaultVariants: scrollAreaContentDefaultVariants
})

type ScrollAreaContentVariantConfig = VariantProps<typeof scrollAreaContentVariants>

/**
 * How the content's z-indexed children stack against the scrollbar.
 *
 * @default "auto"
 */
export type ScrollAreaStacking = NonNullable<ScrollAreaContentVariantConfig['stacking']>

export type ScrollAreaContentVariantProps = StrictVariantProps<
  typeof scrollAreaContentVariants,
  keyof typeof scrollAreaContentDefaultVariants
>

const scrollAreaScrollbarDefaultVariants = {
  variant: 'overlay',
  visibility: 'auto',
  size: 'md'
} as const

/**
 * Scrollbar track variants.
 *
 * - `visibility`: `auto` hides the scrollbar at rest (`opacity-0` + `pointer-events-none`) and
 *   reveals it on hover/scroll (`data-hovering` / `data-scrolling`); `always` keeps it permanently
 *   visible.
 * - `size`: propel scrollbar scale — `sm` 8 px track / 2 px pad → 4 px thumb, `md` 10 / 2 → 6, `lg`
 *   12 / 2 → 8. Matches native `scrollbar-*` utilities. Gutter width stays stable across states (no
 *   rest→hover morph); Figma's end-hugged Default is intentionally not mirrored.
 * - `variant`: who takes the pointer. An `overlay` rail floats over the content's edge, so its track
 *   never takes the pointer: a press beside the thumb reaches the row, cell or button under it, and
 *   only the thumb is interactive. An `inset` rail sits in its own lane with nothing under it, so
 *   the whole track stays pressable (press to jump).
 * - Either way the rail tells its thumb when it may take the pointer, through
 *   `--scroll-area-thumb-pointer-events`: exactly while the rail is shown, so an invisible thumb at
 *   rest never steals a press from the content under it.
 *
 * Track stays transparent (specs + in-product example). Contrast changes live on the thumb tokens.
 */
export const scrollAreaScrollbarVariants = cva(
  [
    // Hover fades in over 150ms; scroll reveal snaps (Base UI sample: data-scrolling duration 0).
    'flex touch-none transition-opacity duration-150 ease-out select-none data-scrolling:duration-0',
    'data-[orientation=horizontal]:flex-col data-[orientation=vertical]:flex-row'
  ],
  {
    variants: {
      /** `overlay` — click-through track, thumb only. `inset` — the whole track is pressable. */
      variant: { overlay: 'pointer-events-none', inset: '' },
      /**
       * `auto` — hidden at rest, visible on hover or while scrolling. `always` — permanently
       * visible.
       */
      visibility: {
        auto: [
          'opacity-0 data-hovering:opacity-100 data-scrolling:opacity-100',
          '[--scroll-area-thumb-pointer-events:none] data-hovering:[--scroll-area-thumb-pointer-events:auto] data-scrolling:[--scroll-area-thumb-pointer-events:auto]'
        ],
        always: 'opacity-100 [--scroll-area-thumb-pointer-events:auto]'
      },
      /**
       * Stable track gutter + cross-axis pad, both riding the `--scrollbar-track-*` /
       * `--scrollbar-pad` ladder tokens (`styles/variables.css`, mirrored by
       * `internal/scrollbar-scale.ts`) rather than a raw Tailwind step: `sm` — 8 → 4, `md` — 10 →
       * 6, `lg` — 12 → 8. Long-axis keeps a 2 px breath (`py-0.5` / `px-0.5`).
       */
      size: {
        sm: [
          'data-[orientation=vertical]:w-(--scrollbar-track-sm) data-[orientation=vertical]:px-(--scrollbar-pad) data-[orientation=vertical]:py-0.5',
          'data-[orientation=horizontal]:h-(--scrollbar-track-sm) data-[orientation=horizontal]:px-0.5 data-[orientation=horizontal]:py-(--scrollbar-pad)'
        ],
        md: [
          'data-[orientation=vertical]:w-(--scrollbar-track-md) data-[orientation=vertical]:px-(--scrollbar-pad) data-[orientation=vertical]:py-0.5',
          'data-[orientation=horizontal]:h-(--scrollbar-track-md) data-[orientation=horizontal]:px-0.5 data-[orientation=horizontal]:py-(--scrollbar-pad)'
        ],
        lg: [
          'data-[orientation=vertical]:w-(--scrollbar-track-lg) data-[orientation=vertical]:px-(--scrollbar-pad) data-[orientation=vertical]:py-0.5',
          'data-[orientation=horizontal]:h-(--scrollbar-track-lg) data-[orientation=horizontal]:px-0.5 data-[orientation=horizontal]:py-(--scrollbar-pad)'
        ]
      }
    },
    compoundVariants: [
      // Match Base UI hover-reveal: an invisible rail must not steal edge hits.
      {
        variant: 'inset',
        visibility: 'auto',
        class: 'pointer-events-none data-hovering:pointer-events-auto data-scrolling:pointer-events-auto'
      }
    ],
    defaultVariants: scrollAreaScrollbarDefaultVariants
  }
)

type ScrollAreaScrollbarVariantConfig = VariantProps<typeof scrollAreaScrollbarVariants>

/**
 * Controls when the scrollbar track is visible.
 *
 * @default "auto"
 */
export type ScrollAreaScrollbarVisibility = NonNullable<ScrollAreaScrollbarVariantConfig['visibility']>

/**
 * Scrollbar gutter size (propel scrollbar scale). Stable full gutter; cross-axis pad matches native
 * `scrollbar-*`: `sm` — 8 px / 2 → 4 px thumb; `md` — 10 / 2 → 6; `lg` — 12 / 2 → 8. The long axis
 * keeps its own fixed 2 px breath regardless of size.
 *
 * @default "md"
 */
export type ScrollAreaScrollbarSize = NonNullable<ScrollAreaScrollbarVariantConfig['size']>

export type ScrollAreaScrollbarVariantProps = StrictVariantProps<
  typeof scrollAreaScrollbarVariants,
  keyof typeof scrollAreaScrollbarDefaultVariants
>

/**
 * Scrollbar thumb: pill on `--scrollbar-thumb*`, darker on hover / while dragging.
 *
 * It sets its own `pointer-events`, because an `overlay` track takes none: the value comes from the
 * rail (`--scroll-area-thumb-pointer-events`, see `scrollAreaScrollbarVariants`), and falls back to
 * `auto` for a thumb composed outside a propel rail.
 *
 * The `::before` widens what can be pressed to the rail's full width (the thumb plus the
 * `--scrollbar-pad` on each side) without widening the pill, so a press that lands a pixel or two
 * beside a 4px thumb still grabs it instead of the row underneath.
 */
export const scrollAreaThumbVariants = cva(
  '[pointer-events:var(--scroll-area-thumb-pointer-events,auto)] relative flex-1 rounded-full bg-scrollbar-thumb transition-colors before:absolute before:-inset-(--scrollbar-pad) hover:bg-scrollbar-thumb-hover active:bg-scrollbar-thumb-active'
)
