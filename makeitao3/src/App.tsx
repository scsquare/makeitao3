import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { listBooks, type BookRecord } from './lib/db'
import './styles/ao3.css'

type View =
  | { name: 'library' }
  | { name: 'reader'; bookId: string }

export default function App() {
  const [view, setView] = useState<View>({ name: 'library' })
  const [books, setBooks] = useState<BookRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshBooks = useCallback(async () => {
    const rows = await listBooks()
    setBooks(rows)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refreshBooks()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load library')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshBooks])

  if (view.name === 'reader') {
    return (
      <div id="main" className="clear">
        <Reader
          bookId={view.bookId}
          onBack={async () => {
            await refreshBooks()
            setView({ name: 'library' })
          }}
        />
      </div>
    )
  }

  return (
    <div id="main" className="clear">
      <h1 className="heading">makeitao3</h1>
      <p className="library-intro">
        Upload an EPUB to read it in an Archive of Our Own–style layout. Books and
        reading progress stay in this browser.
      </p>
      {error ? <p className="flash error">{error}</p> : null}
      {loading ? (
        <p>Loading library…</p>
      ) : (
        <Library
          books={books}
          onOpen={(bookId) => setView({ name: 'reader', bookId })}
          onChange={refreshBooks}
          onError={setError}
        />
      )}
    </div>
  )
}
