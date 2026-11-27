import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

import { scrollAreaContentVariants, type ScrollAreaContentVariantProps } from './variants'

export type { ScrollAreaStacking } from './variants'

export type ScrollAreaContentProps = Omit<useRender.ComponentProps<'div'>, 'className' | 'style'> &
  ScrollAreaContentVariantProps

/**
 * The styled wrapper around the scrollable content, inside the viewport. Base-UI-agnostic — graft
 * in `components` via `<BaseScrollArea.Content render={<ScrollAreaContent/>} />`. Pass the same
 * `orientation` as the root.
 *
 * @param stacking — `isolate` keeps z-indexed children under the rails. @default "auto"
 */
export function ScrollAreaContent({ orientation, stacking, render, ...props }: ScrollAreaContentProps) {
  const defaultProps: useRender.ElementProps<'div'> = {
    className: scrollAreaContentVariants({ orientation, stacking })
  }
  return useRender({ defaultTagName: 'div', render, props: mergeProps(defaultProps, props) })
}
