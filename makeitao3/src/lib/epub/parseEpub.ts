import JSZip from 'jszip'
import type { Chapter, ParsedBook } from '../types'
import { extractBodyHtml, sanitizeChapterHtml } from './sanitizeChapter'

function textContent(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function getAttr(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name) ?? ''
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function resolvePath(baseDir: string, relative: string): string {
  if (!relative) return baseDir
  if (relative.startsWith('/')) return relative.replace(/^\/+/, '')
  const parts = [...baseDir.split('/').filter(Boolean), ...relative.split('/')]
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error('Invalid EPUB XML')
  return doc
}

function qsa(doc: ParentNode, selector: string): Element[] {
  return Array.from(doc.querySelectorAll(selector))
}

function findByLocalName(parent: ParentNode, localName: string): Element[] {
  return Array.from(parent.querySelectorAll('*')).filter(
    (el) => el.localName === localName,
  )
}

function firstByLocalName(
  parent: ParentNode,
  localName: string,
): Element | undefined {
  return findByLocalName(parent, localName)[0]
}

async function readZipText(
  zip: JSZip,
  path: string,
): Promise<string | undefined> {
  const normalized = path.replace(/^\/+/, '')
  const file =
    zip.file(normalized) ??
    zip.file(decodeURIComponent(normalized)) ??
    Object.values(zip.files).find(
      (f) => !f.dir && f.name.replace(/\\/g, '/') === normalized,
    )
  if (!file) return undefined
  return file.async('text')
}

function mergeTitleMaps(
  into: Map<string, string>,
  from: Map<string, string>,
): void {
  for (const [href, title] of from) {
    if (title && !into.has(href)) into.set(href, title)
  }
}

/** Parse link text → resolved href titles from any HTML/XHTML TOC-like page. */
function parseHtmlLinkTitles(
  html: string,
  baseDir: string,
): Map<string, string> {
  const titles = new Map<string, string>()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const links = Array.from(doc.querySelectorAll('a[href]'))
  for (const a of links) {
    const href = a.getAttribute('href')
    if (!href || href.startsWith('#') || /^(https?:|mailto:)/i.test(href)) {
      continue
    }
    const [pathPart] = href.split('#')
    if (!pathPart) continue
    const resolved = resolvePath(baseDir, decodeURIComponent(pathPart))
    const title = textContent(a)
    if (title && !titles.has(resolved)) titles.set(resolved, title)
  }
  return titles
}

function parseNavTitles(navHtml: string, baseDir: string): Map<string, string> {
  return parseHtmlLinkTitles(navHtml, baseDir)
}

function parseNcxTitles(ncxXml: string, opfDir: string): Map<string, string> {
  const titles = new Map<string, string>()
  const doc = parseXml(ncxXml)
  for (const navPoint of findByLocalName(doc, 'navPoint')) {
    const label = firstByLocalName(navPoint, 'navLabel')
    const text = label ? firstByLocalName(label, 'text') : undefined
    const content = firstByLocalName(navPoint, 'content')
    const src = getAttr(content, 'src')
    if (!src) continue
    const [pathPart] = src.split('#')
    const resolved = resolvePath(opfDir, decodeURIComponent(pathPart))
    const title = textContent(text)
    if (title && !titles.has(resolved)) titles.set(resolved, title)
  }
  return titles
}

function firstHeadingTitle(html: string): string | undefined {
  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    'text/html',
  )
  const heading = doc.querySelector('h1, h2, h3, h4')
  const t = textContent(heading)
  return t || undefined
}

function filenameStem(path: string): string {
  const name = basename(path).replace(/\.[^.]+$/, '')
  return name || path
}

function looksLikeTocPage(rawHtml: string): boolean {
  if (
    /epub:type\s*=\s*["'][^"']*\btoc\b/i.test(rawHtml) ||
    /\btype\s*=\s*["'][^"']*\btoc\b/i.test(rawHtml)
  ) {
    return true
  }

  const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
  const heading = textContent(doc.querySelector('h1, h2, h3'))
  if (/table of contents/i.test(heading)) return true

  const internal = Array.from(doc.querySelectorAll('a[href]')).filter((a) => {
    const href = a.getAttribute('href') ?? ''
    return (
      /\.x?html?(?:#|$)/i.test(href) &&
      !/^(https?:|mailto:)/i.test(href) &&
      textContent(a).length > 0
    )
  })
  return internal.length >= 8
}

function lookupTitle(
  titleMap: Map<string, string>,
  href: string,
): string | undefined {
  if (titleMap.has(href)) return titleMap.get(href)
  const base = basename(href)
  for (const [key, title] of titleMap) {
    if (basename(key) === base) return title
  }
  return undefined
}

export async function parseEpub(file: Blob): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const containerXml = await readZipText(zip, 'META-INF/container.xml')
  if (!containerXml) {
    throw new Error('Not a valid EPUB: missing META-INF/container.xml')
  }

  const container = parseXml(containerXml)
  const rootfile =
    findByLocalName(container, 'rootfile').find((el) =>
      (getAttr(el, 'media-type') || '').includes('package+xml'),
    ) ?? findByLocalName(container, 'rootfile')[0]

  const opfPath = getAttr(rootfile, 'full-path')
  if (!opfPath) throw new Error('Not a valid EPUB: missing OPF path')

  const opfXml = await readZipText(zip, opfPath)
  if (!opfXml) throw new Error(`Not a valid EPUB: missing OPF at ${opfPath}`)

  const opf = parseXml(opfXml)
  const opfDir = dirname(opfPath)

  const authorEl =
    firstByLocalName(opf, 'creator') ??
    qsa(opf, '[property="dcterms:creator"]').at(0)
  const author = textContent(authorEl) || undefined

  const manifestItems = findByLocalName(opf, 'item')
  const manifest = new Map<
    string,
    { href: string; mediaType: string; properties: string }
  >()
  for (const item of manifestItems) {
    const id = getAttr(item, 'id')
    if (!id) continue
    manifest.set(id, {
      href: getAttr(item, 'href'),
      mediaType: getAttr(item, 'media-type'),
      properties: getAttr(item, 'properties'),
    })
  }

  const spine = findByLocalName(opf, 'itemref')
  if (spine.length === 0) throw new Error('Not a valid EPUB: empty spine')

  const titleMap = new Map<string, string>()

  const navItem = [...manifest.values()].find((i) =>
    i.properties.split(/\s+/).includes('nav'),
  )
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href)
    const navHtml = await readZipText(zip, navPath)
    if (navHtml) {
      mergeTitleMaps(titleMap, parseNavTitles(navHtml, dirname(navPath)))
    }
  }

  const ncxItem = [...manifest.values()].find(
    (i) =>
      i.mediaType === 'application/x-dtbncx+xml' ||
      i.href.toLowerCase().endsWith('.ncx'),
  )
  if (ncxItem) {
    const ncxPath = resolvePath(opfDir, ncxItem.href)
    const ncxXml = await readZipText(zip, ncxPath)
    if (ncxXml) {
      mergeTitleMaps(titleMap, parseNcxTitles(ncxXml, dirname(ncxPath)))
    }
  }

  // Collect spine HTML paths first so we can scan for content TOC pages
  type SpineHtml = { idref: string; href: string; raw: string }
  const spineHtml: SpineHtml[] = []

  for (const itemref of spine) {
    const idref = getAttr(itemref, 'idref')
    const linear = getAttr(itemref, 'linear')
    if (linear === 'no') continue
    const item = manifest.get(idref)
    if (!item) continue
    if (
      item.mediaType &&
      !item.mediaType.includes('html') &&
      !item.href.match(/\.x?html?$/i)
    ) {
      continue
    }

    const href = resolvePath(opfDir, item.href)
    const raw = await readZipText(zip, href)
    if (raw == null) continue
    spineHtml.push({ idref, href, raw })
  }

  for (const entry of spineHtml) {
    if (!looksLikeTocPage(entry.raw)) continue
    mergeTitleMaps(
      titleMap,
      parseHtmlLinkTitles(entry.raw, dirname(entry.href)),
    )
  }

  const chapters: Chapter[] = []

  for (const entry of spineHtml) {
    const bodyHtml = extractBodyHtml(entry.raw)
    const html = sanitizeChapterHtml(bodyHtml)
    const fromToc = lookupTitle(titleMap, entry.href)
    const fromHeading = firstHeadingTitle(html)
    const titleText = fromToc || fromHeading || filenameStem(entry.href)

    chapters.push({
      id: entry.idref || `item-${chapters.length + 1}`,
      href: entry.href,
      title: titleText,
      html,
    })
  }

  if (chapters.length === 0) {
    throw new Error('No readable chapters found in this EPUB')
  }

  const displayTitle =
    textContent(firstByLocalName(opf, 'title')) ||
    (file instanceof File ? file.name.replace(/\.epub$/i, '') : 'Untitled')

  return {
    title: displayTitle,
    author,
    chapters,
  }
}
