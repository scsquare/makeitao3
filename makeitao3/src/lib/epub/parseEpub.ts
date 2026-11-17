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

function parseNavTitles(
  navHtml: string,
  opfDir: string,
): Map<string, string> {
  const titles = new Map<string, string>()
  const doc = new DOMParser().parseFromString(navHtml, 'text/html')
  const links = Array.from(doc.querySelectorAll('nav a[href], a[href]'))
  for (const a of links) {
    const href = a.getAttribute('href')
    if (!href) continue
    const [pathPart] = href.split('#')
    const resolved = resolvePath(opfDir, pathPart)
    const title = textContent(a)
    if (title && !titles.has(resolved)) titles.set(resolved, title)
  }
  return titles
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
    const resolved = resolvePath(opfDir, pathPart)
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

export async function parseEpub(file: Blob): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const containerXml = await readZipText(zip, 'META-INF/container.xml')
  if (!containerXml) {
    throw new Error('Not a valid EPUB: missing META-INF/container.xml')
  }

  const container = parseXml(containerXml)
  const rootfile = findByLocalName(container, 'rootfile').find((el) =>
    (getAttr(el, 'media-type') || '').includes('package+xml'),
  ) ?? findByLocalName(container, 'rootfile')[0]

  const opfPath = getAttr(rootfile, 'full-path')
  if (!opfPath) throw new Error('Not a valid EPUB: missing OPF path')

  const opfXml = await readZipText(zip, opfPath)
  if (!opfXml) throw new Error(`Not a valid EPUB: missing OPF at ${opfPath}`)

  const opf = parseXml(opfXml)
  const opfDir = dirname(opfPath)

  // Prefer dc:creator / creator
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

  // Titles from nav or ncx
  let titleMap = new Map<string, string>()
  const navItem = [...manifest.values()].find((i) =>
    i.properties.split(/\s+/).includes('nav'),
  )
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href)
    const navHtml = await readZipText(zip, navPath)
    if (navHtml) titleMap = parseNavTitles(navHtml, dirname(navPath))
  }
  if (titleMap.size === 0) {
    const ncxItem = [...manifest.values()].find(
      (i) =>
        i.mediaType === 'application/x-dtbncx+xml' ||
        i.href.toLowerCase().endsWith('.ncx'),
    )
    if (ncxItem) {
      const ncxPath = resolvePath(opfDir, ncxItem.href)
      const ncxXml = await readZipText(zip, ncxPath)
      if (ncxXml) titleMap = parseNcxTitles(ncxXml, opfDir)
    }
  }

  const chapters: Chapter[] = []
  let chapterNum = 0

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

    const bodyHtml = extractBodyHtml(raw)
    const html = sanitizeChapterHtml(bodyHtml)
    chapterNum += 1

    const fromNav = titleMap.get(href)
    const fromHeading = firstHeadingTitle(html)
    const titleText =
      fromNav || fromHeading || `Chapter ${chapterNum}`

    chapters.push({
      id: idref || `chapter-${chapterNum}`,
      href,
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
