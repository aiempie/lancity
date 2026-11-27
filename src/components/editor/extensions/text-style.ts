import { TextStyle } from '@tiptap/extension-text-style'

// Preserve v2 parsing while retaining the existing textStyle mark and attributes.
export const CustomTextStyle = TextStyle.extend({
  parseHTML() {
    return (this.parent?.() ?? []).map(({ consuming: _consuming, ...rule }) => rule)
  }
}).configure({ mergeNestedSpanStyles: false })
