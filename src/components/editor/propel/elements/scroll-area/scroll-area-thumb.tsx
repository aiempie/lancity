import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import { scrollAreaThumbVariants } from './variants'

export type ScrollAreaThumbProps = Omit<useRender.ComponentProps<'div'>, 'className' | 'style'>

/**
 * The styled draggable scrollbar thumb. Base-UI-agnostic — graft in `components` via
 * `<BaseScrollArea.Thumb render={<ScrollAreaThumb/>} />`, inside a `ScrollAreaScrollbar`: the rail
 * decides when its thumb can be pressed.
 */
export function ScrollAreaThumb({ render, ...props }: ScrollAreaThumbProps) {
  const defaultProps: useRender.ElementProps<'div'> & { 'data-slot': string } = {
    'data-slot': 'scroll-area-thumb',
    className: scrollAreaThumbVariants()
  }
  return useRender({ defaultTagName: 'div', render, props: mergeProps(defaultProps, props) })
}
