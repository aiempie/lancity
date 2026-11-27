// Plane `sanitizeHTML` (sanitize-html with `allowedTags: []`): the text of an HTML string, without any tag, trimmed.
// Lancity: the editor runs in the browser only, so the DOM parser does the work. The `sanitize-html` package pulls
// PostCSS into the client bundle, which the dev server cannot load as an ES module.

/** Elements whose content is not text (sanitize-html `nonTextTags`): dropped with their content. */
const NON_TEXT_TAGS = 'script, style, textarea, option, noscript'

/** Like sanitize-html, the returned text is HTML-escaped. */
const escapeText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Removes every HTML tag from the string and trims it. */
export const sanitizeHTML = (htmlString: string) => {
  // `DOMParser` builds an inert document: scripts do not run and resources do not load.
  const doc = new DOMParser().parseFromString(htmlString, 'text/html')
  doc.querySelectorAll(NON_TEXT_TAGS).forEach(element => element.remove())
  return escapeText(doc.body.textContent ?? '').trim()
}
