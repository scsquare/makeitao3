import { useState } from 'react'
import {
  clearAll,
  deleteBook,
  saveBook,
  type BookRecord,
} from '../lib/db'
import { parseEpub } from '../lib/epub/parseEpub'
import { UploadDropzone } from './UploadDropzone'

type Props = {
  books: BookRecord[]
  onOpen: (bookId: string) => void
  onChange: () => Promise<void>
  onError: (message: string | null) => void
}

function newId(): string {
  return crypto.randomUUID()
}

export function Library({ books, onOpen, onChange, onError }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleUpload = async (file: File) => {
    onError(null)
    try {
      const parsed = await parseEpub(file)
      const id = newId()
      await saveBook({
        id,
        title: parsed.title,
        author: parsed.author,
        epubBlob: file,
        chapters: parsed.chapters,
      })
      await onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to import EPUB')
    }
  }

  const handleDelete = async (id: string) => {
    setBusyId(id)
    onError(null)
    try {
      await deleteBook(id)
      await onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete book')
    } finally {
      setBusyId(null)
    }
  }

  const handleClearAll = async () => {
    if (
      !window.confirm(
        'Remove all books and reading progress from this browser?',
      )
    ) {
      return
    }
    onError(null)
    try {
      await clearAll()
      await onChange()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to clear library')
    }
  }

  return (
    <div className="library">
      <UploadDropzone
        onFile={handleUpload}
        onError={(message) => onError(message)}
      />

      <div className="library-header">
        <h2 className="heading">Your library</h2>
        {books.length > 0 ? (
          <button type="button" className="action" onClick={handleClearAll}>
            Clear all
          </button>
        ) : null}
      </div>

      {books.length === 0 ? (
        <p className="library-empty">No books yet. Upload an EPUB to begin.</p>
      ) : (
        <ul className="library-list">
          {books.map((book) => (
            <li key={book.id} className="library-item">
              <div className="library-item-main">
                <button
                  type="button"
                  className="library-open"
                  onClick={() => onOpen(book.id)}
                >
                  <span className="library-title">{book.title}</span>
                  {book.author ? (
                    <span className="library-author">{book.author}</span>
                  ) : null}
                  <span className="library-meta">
                    {book.chapters.length} chapter
                    {book.chapters.length === 1 ? '' : 's'}
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="action"
                disabled={busyId === book.id}
                onClick={() => handleDelete(book.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
