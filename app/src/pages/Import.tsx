import { useState } from 'react'
import { useAuth } from '../auth'
import { importRecipes, type ImportFile, type ImportResult } from '../lib/import'
import seed from '../data/recetas-semilla.json'

export default function ImportPage() {
  const { session, householdId } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(file: ImportFile) {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await importRecipes(file, householdId!, session!.user.id))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  function runText() {
    try {
      const parsed = JSON.parse(text) as ImportFile
      if (!Array.isArray(parsed.recipes)) throw new Error('Falta la lista "recipes".')
      void run(parsed)
    } catch (e) {
      setError(`JSON no válido: ${(e as Error).message}`)
    }
  }

  return (
    <section>
      <h1>Importar recetas</h1>
      <p className="muted">
        Pega un JSON con formato <code>recetario-import/0.1</code>. Las recetas con un título que ya
        existe se omiten.
      </p>
      <textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"format":"recetario-import/0.1","recipes":[…]}'
      />
      <div className="row">
        <button disabled={busy || !text.trim()} onClick={runText}>
          Importar JSON
        </button>
        <button disabled={busy} onClick={() => run(seed as ImportFile)}>
          Cargar las 5 recetas de ejemplo
        </button>
      </div>
      {busy && <p>Importando…</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <div>
          {result.created.length > 0 && <p>Creadas: {result.created.join(', ')}</p>}
          {result.skipped.length > 0 && <p>Omitidas (ya existían): {result.skipped.join(', ')}</p>}
          {result.failed.map((f) => (
            <p className="error" key={f}>
              Error en {f}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
