import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import { scrollAreaViewportVariants, type ScrollAreaViewportVariantProps } from './variants'

export type { ScrollAreaOverscroll } from './variants'

export type ScrollAreaViewportProps = Omit<useRender.ComponentProps<'div'>, 'className' | 'style'> &
  ScrollAreaViewportVariantProps

/**
 * The styled scrollable viewport. Base-UI-agnostic — graft in `components` via
 * `<BaseScrollArea.Viewport render={<ScrollAreaViewport/>} />`. Pass the same `orientation` as the
 * root and its rendered scrollbars: with `overscroll="contain"` it decides which axes are
 * contained. The `inset` lane is reserved by the root (`ScrollArea`), not here, and so is the
 * keyboard focus ring, which the root finds through this part's `data-slot="scroll-area-viewport"`
 * (a stable hook: apps may select the scrolling element by it too).
 *
 * @param overscroll — What a scroll does at the area's edge. @default "contain"
 */
export function ScrollAreaViewport({ orientation, overscroll, render, ...props }: ScrollAreaViewportProps) {
  const defaultProps: useRender.ElementProps<'div'> & { 'data-slot': string } = {
    'data-slot': 'scroll-area-viewport',
    className: scrollAreaViewportVariants({ orientation, overscroll })
  }
  return useRender({ defaultTagName: 'div', render, props: mergeProps(defaultProps, props) })
}
