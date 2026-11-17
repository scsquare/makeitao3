export type Chapter = {
  id: string
  href: string
  title: string
  html: string
}

export type ParsedBook = {
  title: string
  author?: string
  chapters: Chapter[]
}
