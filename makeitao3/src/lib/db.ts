import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Chapter } from './types'

export type BookRecord = {
  id: string
  title: string
  author?: string
  epubBlob: Blob
  chapters: Chapter[]
  addedAt: number
  lastOpenedAt: number
}

export type ProgressRecord = {
  bookId: string
  chapterIndex: number
  scrollY: number
  updatedAt: number
}

interface MakeItAo3DB extends DBSchema {
  books: {
    key: string
    value: BookRecord
    indexes: { 'by-last-opened': number }
  }
  progress: {
    key: string
    value: ProgressRecord
  }
}

const DB_NAME = 'makeitao3'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<MakeItAo3DB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<MakeItAo3DB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' })
        books.createIndex('by-last-opened', 'lastOpenedAt')
        db.createObjectStore('progress', { keyPath: 'bookId' })
      },
    })
  }
  return dbPromise
}

export async function listBooks(): Promise<BookRecord[]> {
  const db = await getDb()
  const books = await db.getAllFromIndex('books', 'by-last-opened')
  return books.reverse()
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  const db = await getDb()
  return db.get('books', id)
}

export async function saveBook(
  book: Omit<BookRecord, 'addedAt' | 'lastOpenedAt'> & {
    addedAt?: number
    lastOpenedAt?: number
  },
): Promise<BookRecord> {
  const db = await getDb()
  const now = Date.now()
  const existing = await db.get('books', book.id)
  const record: BookRecord = {
    ...book,
    addedAt: existing?.addedAt ?? book.addedAt ?? now,
    lastOpenedAt: book.lastOpenedAt ?? now,
  }
  await db.put('books', record)
  return record
}

export async function touchBookOpened(id: string): Promise<void> {
  const db = await getDb()
  const book = await db.get('books', id)
  if (!book) return
  book.lastOpenedAt = Date.now()
  await db.put('books', book)
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['books', 'progress'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('progress').delete(id)
  await tx.done
}

export async function getProgress(
  bookId: string,
): Promise<ProgressRecord | undefined> {
  const db = await getDb()
  return db.get('progress', bookId)
}

export async function setProgress(
  progress: Omit<ProgressRecord, 'updatedAt'>,
): Promise<void> {
  const db = await getDb()
  await db.put('progress', { ...progress, updatedAt: Date.now() })
}

export async function clearAll(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['books', 'progress'], 'readwrite')
  await tx.objectStore('books').clear()
  await tx.objectStore('progress').clear()
  await tx.done
}
