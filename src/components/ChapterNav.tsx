type Props = {
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
}

export function ChapterNav({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: Props) {
  if (!hasPrevious && !hasNext) return null

  return (
    <ul className="work navigation actions">
      {hasPrevious ? (
        <li className="chapter previous">
          <a
            href="#workskin"
            onClick={(e) => {
              e.preventDefault()
              onPrevious()
            }}
          >
            ← Previous Chapter
          </a>
        </li>
      ) : null}
      {hasNext ? (
        <li className="chapter next">
          <a
            href="#workskin"
            onClick={(e) => {
              e.preventDefault()
              onNext()
            }}
          >
            Next Chapter →
          </a>
        </li>
      ) : null}
    </ul>
  )
}
