import { useCallback, useRef, useState, type DragEvent } from 'react'

type Props = {
  onFile: (file: File) => Promise<void>
  onError?: (message: string) => void
  disabled?: boolean
}

export function UploadDropzone({ onFile, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || disabled || busy) return
      if (
        !file.name.toLowerCase().endsWith('.epub') &&
        file.type !== 'application/epub+zip'
      ) {
        onError?.('Please choose an .epub file')
        return
      }
      setBusy(true)
      try {
        await onFile(file)
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [busy, disabled, onError, onFile],
  )

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    await handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <div
      className={`upload-dropzone${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <p>
        {busy
          ? 'Parsing EPUB…'
          : 'Drop an EPUB here, or choose a file to add it to your library.'}
      </p>
      <button
        type="button"
        className="action"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        Choose EPUB
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,application/epub+zip"
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
        }}
      />
    </div>
  )
}
