// import CodeBlock, { CodeBlockOptions } from "@tiptap/extension-code-block";

import type { CodeBlockOptions } from './code-block'
import { CodeBlock } from './code-block'
import { LowlightPlugin } from './lowlight-plugin'

type CodeBlockLowlightOptions = CodeBlockOptions & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plane typing of lowlight / ProseMirror internals kept
  lowlight: any
  defaultLanguage: string | null | undefined
}

export const CodeBlockLowlight = CodeBlock.extend<CodeBlockLowlightOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {
        languageClassPrefix: 'language-',
        exitOnTripleEnter: true,
        exitOnArrowDown: true,
        HTMLAttributes: {}
      }),
      lowlight: {},
      defaultLanguage: null
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      LowlightPlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage
      })
    ]
  }
})
