import JSZip from "jszip";
import type { Chapter, ParsedBook } from "../types";
import { extractBodyHtml, sanitizeChapterHtml } from "./sanitizeChapter";
import {
  basename,
  dirname,
  findByLocalName,
  firstMatchLocalName,
  getAttr,
  parseXml,
  readZipText,
  resolvePath,
  getCleanTextContent,
} from "./helperFunctions";

/** Represents an asset listed in the EPUB manifest */
export interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string;
}

type SpineHtml = { idref: string; href: string; raw: string };

function mergeTitleMaps(
  into: Map<string, string>,
  from: Map<string, string>,
): void {
  for (const [href, title] of from) {
    if (title && !into.has(href)) into.set(href, title);
  }
}

/**
 * Gets titles from the properties="nav" item (epub3)
 * @param manifest
 * @param opfDir
 * @param zip
 * @returns
 */
async function getTitlesFromNavFile(
  manifest: Map<string, ManifestItem>,
  opfDir: string,
  zip: JSZip,
): Promise<Map<string, string>> {
  const navItem = [...manifest.values()].find((i) =>
    i.properties.split(/\s+/).includes("nav"),
  );
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href);
    const navHtml = await readZipText(zip, navPath);
    if (navHtml) {
      return parseNavTitles(navHtml, dirname(navPath));
    }
  }
  return new Map<string, string>();
}

/**
 * Gets titles from .ncx file (epub2)
 * @param manifest
 * @param opfDir
 * @param zip
 * @returns
 */
async function getTitlesFromNcxFile(
  manifest: Map<string, ManifestItem>,
  opfDir: string,
  zip: JSZip,
): Promise<Map<string, string>> {
  const ncxItem = [...manifest.values()].find(
    (i) =>
      i.mediaType === "application/x-dtbncx+xml" ||
      i.href.toLowerCase().endsWith(".ncx"),
  );
  if (ncxItem) {
    const ncxPath = resolvePath(opfDir, ncxItem.href);
    const ncxXml = await readZipText(zip, ncxPath);
    if (ncxXml) {
      return parseNcxTitles(ncxXml, dirname(ncxPath));
    }
  }
  return new Map<string, string>();
}

/** Parse link text → resolved href titles from any HTML/XHTML TOC-like page. */
function parseHtmlLinkTitles(
  html: string,
  baseDir: string,
): Map<string, string> {
  const titles = new Map<string, string>();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(doc.querySelectorAll("a[href]"));
  for (const a of links) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || /^(https?:|mailto:)/i.test(href)) {
      continue;
    }
    const [pathPart] = href.split("#");
    if (!pathPart) continue;
    const resolved = resolvePath(baseDir, decodeURIComponent(pathPart));
    const title = getCleanTextContent(a);
    if (title && !titles.has(resolved)) titles.set(resolved, title);
  }
  return titles;
}

function parseNavTitles(navHtml: string, baseDir: string): Map<string, string> {
  return parseHtmlLinkTitles(navHtml, baseDir);
}

function parseNcxTitles(ncxXml: string, opfDir: string): Map<string, string> {
  const titles = new Map<string, string>();
  const doc = parseXml(ncxXml);
  for (const navPoint of findByLocalName(doc, "navPoint")) {
    const label = firstMatchLocalName(navPoint, "navLabel");
    const text = label ? firstMatchLocalName(label, "text") : undefined;
    const content = firstMatchLocalName(navPoint, "content");
    const src = getAttr(content, "src");
    if (!src) continue;
    const [pathPart] = src.split("#");
    const resolved = resolvePath(opfDir, decodeURIComponent(pathPart));
    const title = getCleanTextContent(text);
    if (title && !titles.has(resolved)) titles.set(resolved, title);
  }
  return titles;
}

function firstHeadingTitle(html: string): string | undefined {
  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const heading = doc.querySelector("h1, h2, h3, h4");
  const t = getCleanTextContent(heading);
  return t || undefined;
}

function filenameStem(path: string): string {
  const name = basename(path).replace(/\.[^.]+$/, "");
  return name || path;
}

function looksLikeTocPage(rawHtml: string): boolean {
  if (
    /epub:type\s*=\s*["'][^"']*\btoc\b/i.test(rawHtml) ||
    /\btype\s*=\s*["'][^"']*\btoc\b/i.test(rawHtml)
  ) {
    return true;
  }

  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const heading = getCleanTextContent(doc.querySelector("h1, h2, h3"));
  if (/table of contents/i.test(heading)) return true;

  const internal = Array.from(doc.querySelectorAll("a[href]")).filter((a) => {
    const href = a.getAttribute("href") ?? "";
    return (
      /\.x?html?(?:#|$)/i.test(href) &&
      !/^(https?:|mailto:)/i.test(href) &&
      getCleanTextContent(a).length > 0
    );
  });
  return internal.length >= 8;
}

function lookupTitle(
  titleMap: Map<string, string>,
  href: string,
): string | undefined {
  if (titleMap.has(href)) return titleMap.get(href);
  const base = basename(href);
  for (const [key, title] of titleMap) {
    if (basename(key) === base) return title;
  }
  return undefined;
}

export async function parseEpub(file: Blob): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const containerXml = await readZipText(zip, "META-INF/container.xml");
  if (!containerXml) {
    throw new Error("Not a valid EPUB: missing META-INF/container.xml");
  }

  const container = parseXml(containerXml);
  const rootfile =
    findByLocalName(container, "rootfile").find((el) =>
      (getAttr(el, "media-type") || "").includes("package+xml"),
    ) ?? findByLocalName(container, "rootfile")[0];

  const opfPath = getAttr(rootfile, "full-path");
  if (!opfPath) throw new Error("Not a valid EPUB: missing OPF path");

  const opfXml = await readZipText(zip, opfPath);
  if (!opfXml) throw new Error(`Not a valid EPUB: missing OPF at ${opfPath}`);

  const opf = parseXml(opfXml);
  const opfDir = dirname(opfPath);

  //Find author
  const authorEl =
    //epub2: dc:creator
    firstMatchLocalName(opf, "creator") ??
    //epub3: dcterms:creator
    Array.from(opf.querySelectorAll('[property="dcterms:creator"]')).at(0);
  const author = getCleanTextContent(authorEl) || undefined;

  // Get items
  const manifestItems = findByLocalName(opf, "item");
  const manifest = new Map<string, ManifestItem>();
  for (const item of manifestItems) {
    const id = getAttr(item, "id");
    if (!id) continue;
    manifest.set(id, {
      href: getAttr(item, "href"),
      mediaType: getAttr(item, "media-type"),
      properties: getAttr(item, "properties"),
    });
  }

  const spine = findByLocalName(opf, "itemref");
  if (spine.length === 0) throw new Error("Not a valid EPUB: empty spine");

  const spineHtml: SpineHtml[] = [];
  for (const itemref of spine) {
    const idref = getAttr(itemref, "idref");
    const linear = getAttr(itemref, "linear");
    if (linear === "no") continue;
    const item = manifest.get(idref);
    if (!item) continue;
    if (
      item.mediaType &&
      !item.mediaType.includes("html") &&
      !item.href.match(/\.x?html?$/i)
    ) {
      continue;
    }

    const href = resolvePath(opfDir, item.href);
    const raw = await readZipText(zip, href);
    if (raw == null) continue;
    spineHtml.push({ idref, href, raw });
  }

  // Get titles
  const titleMap = new Map<string, string>();
  mergeTitleMaps(titleMap, await getTitlesFromNavFile(manifest, opfDir, zip));
  mergeTitleMaps(titleMap, await getTitlesFromNcxFile(manifest, opfDir, zip));
  if (titleMap.size == 0) {
    // Backup approach for titles: populate from table of contents
    for (const entry of spineHtml) {
      if (!looksLikeTocPage(entry.raw)) continue;
      mergeTitleMaps(
        titleMap,
        parseHtmlLinkTitles(entry.raw, dirname(entry.href)),
      );
    }
  }

  // Get chapters
  const chapters: Chapter[] = [];

  for (const entry of spineHtml) {
    const bodyHtml = extractBodyHtml(entry.raw);
    const html = sanitizeChapterHtml(bodyHtml);
    const fromToc = lookupTitle(titleMap, entry.href);
    const fromHeading = firstHeadingTitle(html);
    const titleText = fromToc || fromHeading || filenameStem(entry.href);

    chapters.push({
      id: entry.idref || `item-${chapters.length + 1}`,
      href: entry.href,
      title: titleText,
      html,
    });
  }

  if (chapters.length === 0) {
    throw new Error("No readable chapters found in this EPUB");
  }

  const displayTitle =
    getCleanTextContent(firstMatchLocalName(opf, "title")) ||
    (file instanceof File ? file.name.replace(/\.epub$/i, "") : "Untitled");

  return {
    title: displayTitle,
    author,
    chapters,
  };
}
