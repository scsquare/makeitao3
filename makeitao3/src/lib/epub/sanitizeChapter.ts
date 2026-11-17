import DOMPurify from 'dompurify'

/**
 * Allowlist aligned with otwarchive Sanitize::Config::ARCHIVE
 * (config/initializers/gem-plugin_config/sanitizer_config.rb)
 */
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'acronym',
  'address',
  'b',
  'big',
  'blockquote',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'details',
  'figcaption',
  'figure',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
]

const ALLOWED_ATTR = [
  'align',
  'title',
  'dir',
  'href',
  'name',
  'cite',
  'span',
  'width',
  'open',
  'alt',
  'border',
  'height',
  'src',
  'start',
  'type',
  'summary',
  'abbr',
  'axis',
  'colspan',
  'rowspan',
  'scope',
  'class',
]

export function sanitizeChapterHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'svg',
      'math',
    ],
  })
}

/** Pull inner body markup from a full XHTML/HTML document string. */
export function extractBodyHtml(docHtml: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(docHtml, 'application/xhtml+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    const htmlDoc = parser.parseFromString(docHtml, 'text/html')
    return htmlDoc.body?.innerHTML ?? docHtml
  }
  const body = doc.querySelector('body')
  if (body) return body.innerHTML
  return doc.documentElement?.innerHTML ?? docHtml
}
