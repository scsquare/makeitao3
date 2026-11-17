# makeitao3

Static EPUB reader that presents chapters in an Archive of Our Own–style layout.

## Develop

```bash
npm install
npm run dev
```

## Use

1. Upload an `.epub` on the library screen.
2. Open a book to read; previous/next moves between spine chapters.
3. Progress (chapter + scroll) and the EPUB stay in IndexedDB in this browser.
4. Remove a book, or use **Clear all** to wipe stored data.

## Fonts

System Lucida Grande / Georgia stacks match AO3 by default. To use custom files, place `.woff2` assets in `public/fonts/` and uncomment the `@font-face` rules in `src/styles/ao3.css`.
