import { useCallback, useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { listBooks, type BookRecord } from "./lib/db";
import "./styles/ao3.css";
import midsizeUrl from "./styles/25-media-midsize.css?url";
import narrowUrl from "./styles/26-media-narrow.css?url";

type View = { name: "library" } | { name: "reader"; bookId: string };

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const conditionalStylesheets = (
    <>
      <link
        rel="stylesheet"
        href={midsizeUrl}
        media="only screen and (max-width: 62em)"
      />
      <link
        rel="stylesheet"
        href={narrowUrl}
        media="only screen and (max-width: 42em)"
      />
    </>
  );

  const refreshBooks = useCallback(async () => {
    const rows = await listBooks();
    setBooks(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshBooks();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load library",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBooks]);

  return (
    <>
      {conditionalStylesheets}
      <div id="outer" className="wrapper">
        {view.name === "reader" ? (
          <div id="main" className="chapters-show region" role="main">
            <Reader
              bookId={view.bookId}
              onBack={async () => {
                await refreshBooks();
                setView({ name: "library" });
              }}
            />
          </div>
        ) : (
          <div id="main" className="clear">
            <h1 className="heading">makeitao3</h1>
            <p className="library-intro">
              Upload an EPUB to read it in an Archive of Our Own–style layout.
              Books and reading progress stay in this browser.
            </p>
            {error ? <p className="flash error">{error}</p> : null}
            {loading ? (
              <p>Loading library…</p>
            ) : (
              <Library
                books={books}
                onOpen={(bookId) => setView({ name: "reader", bookId })}
                onChange={refreshBooks}
                onError={setError}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
