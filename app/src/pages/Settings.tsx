import { useRef, useState } from 'react'
import { useAuth } from '../auth'
import { exportBackup, restoreBackup, type RestoreResult } from '../lib/backup'

export default function Settings() {
  const { session, householdId } = useAuth()
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function doExport() {
    setBusy('export')
    setError(null)
    setDone(null)
    setResult(null)
    try {
      const { blob, recipes, photos } = await exportBackup(session!.user.id, setMsg)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recetario-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setDone(`Copia creada: ${recipes} recetas y ${photos} fotos (${(blob.size / 1048576).toFixed(1)} MB).`)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
    setMsg('')
  }

  async function doRestore(file: File) {
    setBusy('restore')
    setError(null)
    setDone(null)
    setResult(null)
    try {
      setResult(await restoreBackup(file, householdId!, session!.user.id, setMsg))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(null)
    setMsg('')
  }

  return (
    <section>
      <h1><span className="u">Ajustes</span></h1>

      <h2>Copia de seguridad</h2>
      <p className="muted">
        Un archivo ZIP con todas las recetas, ingredientes, etiquetas, historial de revisiones, tus favoritas y las
        fotos. Guárdalo en un lugar seguro: contiene el contenido del recetario.
      </p>
      <button type="button" disabled={busy !== null} onClick={doExport}>
        {busy === 'export' ? 'Exportando…' : 'Exportar copia'}
      </button>

      <h2>Restaurar</h2>
      <p className="muted">
        Añade al recetario lo que contenga una copia. No borra ni cambia nada de lo que ya tienes: las recetas cuyo
        título ya existe se omiten, y los ingredientes y etiquetas se enlazan por nombre.
      </p>
      <input ref={input} type="file" accept=".zip,application/zip" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doRestore(f) }} />
      <button type="button" className="alt" disabled={busy !== null} onClick={() => input.current?.click()}>
        {busy === 'restore' ? 'Restaurando…' : 'Restaurar desde un archivo'}
      </button>

      {busy && <p aria-live="polite">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {result && (
        <div role="status">
          <p>
            Restauradas {result.created.length} {result.created.length === 1 ? 'receta' : 'recetas'} y {result.photos}{' '}
            {result.photos === 1 ? 'foto' : 'fotos'}.
          </p>
          {result.skipped.length > 0 && <p className="muted">Omitidas (ya existían): {result.skipped.join(', ')}</p>}
          {result.failed.map((f) => <p className="error" key={f}>Error en {f}</p>)}
        </div>
      )}
    </section>
  )
}
