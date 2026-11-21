import { useRef } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  busy?: boolean
  label?: string
  compact?: boolean
}

// Dos entradas: cámara (en el móvil abre la cámara) y galería (permite varias).
export default function PhotoAdd({ onFiles, busy, label = 'Añadir foto', compact }: Props) {
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length) onFiles(files)
  }
  return (
    <div className={compact ? 'photoadd compact' : 'photoadd'}>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <input ref={gal} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={handle} />
      <button type="button" disabled={busy} onClick={() => cam.current?.click()}>
        {busy ? 'Subiendo…' : compact ? '📷 Foto' : `📷 ${label}`}
      </button>
      <button type="button" className="alt" disabled={busy} onClick={() => gal.current?.click()}>
        {compact ? 'Galería' : 'Desde la galería'}
      </button>
    </div>
  )
}
