import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getBook,
  getProgress,
  setProgress,
  touchBookOpened,
  type BookRecord,
} from '../lib/db'
import { ChapterNav } from './ChapterNav'

type Props = {
  bookId: string
  onBack: () => void
}

export function Reader({ bookId, onBack }: Props) {
  const [book, setBook] = useState<BookRecord | null>(null)
  const [chapterIndex, setChapterIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const restoreScrollRef = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const record = await getBook(bookId)
        if (!record) {
          if (!cancelled) setError('Book not found')
          return
        }
        await touchBookOpened(bookId)
        const progress = await getProgress(bookId)
        if (cancelled) return
        setBook(record)
        const idx = Math.min(
          Math.max(progress?.chapterIndex ?? 0, 0),
          record.chapters.length - 1,
        )
        setChapterIndex(idx)
        restoreScrollRef.current = progress?.scrollY ?? 0
        setReady(true)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to open book')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookId])

  const persist = useCallback(
    (idx: number, scrollY: number) => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void setProgress({ bookId, chapterIndex: idx, scrollY })
      }, 200)
    },
    [bookId],
  )

  useEffect(() => {
    if (!ready) return
    const y = restoreScrollRef.current
    restoreScrollRef.current = null
    if (y != null && y > 0) {
      requestAnimationFrame(() => window.scrollTo(0, y))
    } else {
      window.scrollTo(0, 0)
    }
  }, [ready, chapterIndex])

  useEffect(() => {
    if (!ready) return
    const onScroll = () => persist(chapterIndex, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current)
      void setProgress({
        bookId,
        chapterIndex,
        scrollY: window.scrollY,
      })
    }
  }, [ready, chapterIndex, bookId, persist])

  const goToChapter = (idx: number) => {
    if (!book) return
    const next = Math.min(Math.max(idx, 0), book.chapters.length - 1)
    restoreScrollRef.current = 0
    setChapterIndex(next)
    void setProgress({ bookId, chapterIndex: next, scrollY: 0 })
  }

  if (error) {
    return (
      <div className="reader-error">
        <p className="flash error">{error}</p>
        <button type="button" className="action" onClick={onBack}>
          Back to library
        </button>
      </div>
    )
  }

  if (!book || !ready) {
    return <p>Opening book…</p>
  }

  const chapter = book.chapters[chapterIndex]
  const hasPrevious = chapterIndex > 0
  const hasNext = chapterIndex < book.chapters.length - 1
  const chapterNav = <>      <ChapterNav
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={() => goToChapter(chapterIndex - 1)}
        onNext={() => goToChapter(chapterIndex + 1)}
      /></>
  return (
    <div className="work">
      <p className="reader-toolbar">
        <button type="button" className="action" onClick={onBack}>
          ← Library
        </button>
      </p>

      {chapterNav}

      <div id="workskin">
        <h2 className="title heading">{book.title}</h2>
        <div id="chapters">
          <div className="chapter" id={`chapter-${chapterIndex + 1}`}>
            <h3 className="title">{chapter.title}</h3>
            <div
              className="userstuff module"
              role="article"
              dangerouslySetInnerHTML={{ __html: chapter.html }}
            />
          </div>
        </div>
      </div>

      {chapterNav}
    </div>
  )
}
