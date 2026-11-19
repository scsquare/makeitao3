import type JSZip from "jszip";

export function getCleanTextContent(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 
 * @param el Dom element
 * @param name attribute name
 * @returns string of attribute, empty string if not found
 */
export function getAttr(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name) ?? "";
}

/**
 * Returns the directory name of the path.
 * e.g. dirname("OEBPS/text/chapter1.xhtml") returns "OEBPS/text"
 * @param path
 * @returns string
 */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/**
 * Returns the file name
 * e.g. dirname("OEBPS/text/chapter1.xhtml") returns "chapter1.xhtml"
 * @param path
 * @returns string
 */
export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

export function resolvePath(baseDir: string, relative: string): string {
  if (!relative) return baseDir;
  if (relative.startsWith("/")) return relative.replace(/^\/+/, "");
  const parts = [...baseDir.split("/").filter(Boolean), ...relative.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Invalid EPUB XML");
  return doc;
}

/**
 * Finds elements in parent node whose local name matches that provided
 * @param parent ParentNode
 * @param localName string
 * @returns Array
 */
export function findByLocalName(
  parent: ParentNode,
  localName: string,
): Element[] {
  return Array.from(parent.querySelectorAll("*")).filter(
    (el) => el.localName === localName,
  );
}

/**
 *
 * @param parent
 * @param localName
 * @returns First element whose local name matches the one provided
 */
export function firstMatchLocalName(
  parent: ParentNode,
  localName: string,
): Element | undefined {
  return findByLocalName(parent, localName)[0];
}

export async function readZipText(
  zip: JSZip,
  path: string,
): Promise<string | undefined> {
  const normalized = path.replace(/^\/+/, "");
  const file =
    zip.file(normalized) ??
    zip.file(decodeURIComponent(normalized)) ??
    Object.values(zip.files).find(
      (f) => !f.dir && f.name.replace(/\\/g, "/") === normalized,
    );
  if (!file) return undefined;
  return file.async("text");
}
