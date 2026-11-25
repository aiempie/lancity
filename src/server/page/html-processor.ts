/** Port of plane/utils/html_processor.py (`MLStripper`, `strip_tags`) on top of a small tokenizer. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  times: '\u00d7',
  euro: '\u20ac'
}

/** Decode numeric references and the common named entities (Python `convert_charrefs=True`). */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([a-zA-Z][a-zA-Z0-9]{1,31});)/g,
    (match, dec, hex, name) => {
      if (name !== undefined) return NAMED_ENTITIES[name] ?? match
      const code = dec !== undefined ? Number(dec) : parseInt(hex, 16)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd'
    }
  )
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/?[a-zA-Z](?:"[^"]*"|'[^']*'|[^'">])*>/g
const CDATA_ELEMENTS = new Set(['script', 'style'])

/** Markup language stripper: collects the text nodes of an HTML fragment. */
export class MLStripper {
  private text = ''

  handleData(data: string): void {
    this.text += data
  }

  getData(): string {
    return this.text
  }

  feed(html: string): void {
    let index = 0
    while (index < html.length) {
      TOKEN.lastIndex = index
      const match = TOKEN.exec(html)
      const stop = match ? match.index : html.length
      let chunk = html.slice(index, stop)
      // An unterminated tag at the end is never flushed by HTMLParser.feed(); its text is dropped.
      const dangling = match ? -1 : chunk.search(/<[a-zA-Z/!?]/)
      if (dangling >= 0) chunk = chunk.slice(0, dangling)
      if (chunk) this.handleData(decodeEntities(chunk))
      if (!match || dangling >= 0) return
      index = match.index + match[0].length
      const element = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(match[0])?.[1].toLowerCase()
      if (element && CDATA_ELEMENTS.has(element) && !match[0].endsWith('/>')) {
        // Script and style bodies are raw text: no decoding, ends at the closing tag.
        const end = html.toLowerCase().indexOf(`</${element}`, index)
        if (end < 0) return
        if (end > index) this.handleData(html.slice(index, end))
        index = end
      }
    }
  }
}

/** Return the text content of `html` without tags (PD-1847). */
export function stripTags(html: string): string {
  const stripper = new MLStripper()
  stripper.feed(html)
  return stripper.getData()
}
