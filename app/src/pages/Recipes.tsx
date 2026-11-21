import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface Row {
  id: string
  title: string
  prep_minutes: number | null
  cook_minutes: number | null
  variant_label: string | null
  recipe_tags: { tags: { name: string } | null }[]
  recipe_ingredients: { ingredients: { name: string } | null }[]
}

export default function Recipes() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    supabase
      .from('recipes')
      .select(
        'id,title,prep_minutes,cook_minutes,variant_label,recipe_tags(tags(name)),recipe_ingredients(ingredients(name))',
      )
      .order('title')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows(data as unknown as Row[])
      })
  }, [])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!rows) return []
    if (!needle) return rows
    return rows.filter((r) => {
      const hay = [
        r.title,
        ...r.recipe_tags.map((t) => t.tags?.name ?? ''),
        ...r.recipe_ingredients.map((i) => i.ingredients?.name ?? ''),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(needle)
    })
  }, [rows, q])

  if (error) return <p className="error">{error}</p>
  if (!rows) return <p className="center">Cargando…</p>

  return (
    <>
      <input
        className="search"
        type="search"
        placeholder="Buscar por nombre, ingrediente o etiqueta"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {rows.length === 0 && (
        <p className="center">
          Aún no hay recetas. Ve a <Link to="/importar">Importar</Link>.
        </p>
      )}
      <ul className="cards">
        {visible.map((r) => {
          const total = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
          return (
            <li key={r.id}>
              <Link to={`/receta/${r.id}`}>
                <strong>{r.title}</strong>
                {r.variant_label && <span className="muted"> · {r.variant_label}</span>}
                <div className="muted">{total > 0 ? `${total} min` : ''}</div>
                <div className="chips">
                  {r.recipe_tags.map((t) => t.tags && <span key={t.tags.name}>{t.tags.name}</span>)}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
