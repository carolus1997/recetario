import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { signedUrls } from '../lib/photos'
import { Ln } from '../components/Icon'
import RecipeCard, { type CardRecipe } from '../components/RecipeCard'

interface Row {
  id: string
  title: string
  prep_minutes: number | null
  cook_minutes: number | null
  difficulty: string | null
  freezable: boolean | null
  parent_recipe_id: string | null
  variant_label: string | null
  recipe_tags: { tags: { name: string } | null }[]
  recipe_ingredients: { ingredients: { name: string } | null }[]
}

export default function Recipes() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [rows, setRows] = useState<CardRecipe[] | null>(null)
  const [favs, setFavs] = useState<Set<string>>(new Set())
  const [covers, setCovers] = useState<Record<string, string>>({}) // id de receta -> URL firmada
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<string>('todas') // 'todas' | 'favoritas' | nombre de etiqueta

  useEffect(() => {
    supabase
      .from('recipes')
      .select(
        'id,title,prep_minutes,cook_minutes,difficulty,freezable,parent_recipe_id,variant_label,recipe_tags(tags(name)),recipe_ingredients(ingredients(name))',
      )
      .order('title')
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        setRows(
          (data as unknown as Row[]).map((r) => ({
            id: r.id,
            title: r.title,
            prep_minutes: r.prep_minutes,
            cook_minutes: r.cook_minutes,
            difficulty: r.difficulty,
            freezable: r.freezable,
            parent_recipe_id: r.parent_recipe_id,
            variant_label: r.variant_label,
            tags: r.recipe_tags.flatMap((t) => (t.tags ? [t.tags.name] : [])),
            ingredientNames: r.recipe_ingredients.flatMap((i) => (i.ingredients ? [i.ingredients.name] : [])),
          })),
        )
      })
    supabase
      .from('recipe_images')
      .select('recipe_id,storage_path')
      .eq('is_cover', true)
      .then(async ({ data }) => {
        const list = data ?? []
        try {
          const signed = await signedUrls(list.map((c) => c.storage_path as string))
          setCovers(Object.fromEntries(list.map((c) => [c.recipe_id as string, signed[c.storage_path as string]]).filter(([, u]) => u)))
        } catch {
          /* sin portadas: se muestran las ilustraciones */
        }
      })
    supabase
      .from('user_favorites')
      .select('recipe_id')
      .eq('user_id', userId)
      .then(({ data }) => setFavs(new Set((data ?? []).map((f) => f.recipe_id as string))))
  }, [userId])

  const toggleFavorite = useCallback(
    async (recipeId: string) => {
      const was = favs.has(recipeId)
      setFavs((prev) => {
        const next = new Set(prev)
        if (was) next.delete(recipeId)
        else next.add(recipeId)
        return next
      })
      const { error } = was
        ? await supabase.from('user_favorites').delete().eq('user_id', userId).eq('recipe_id', recipeId)
        : await supabase.from('user_favorites').insert({ user_id: userId, recipe_id: recipeId })
      if (error) {
        setError(error.message)
        setFavs((prev) => {
          const next = new Set(prev)
          if (was) next.add(recipeId)
          else next.delete(recipeId)
          return next
        })
      }
    },
    [favs, userId],
  )

  const allTags = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.tags))].sort(), [rows])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      if (filter === 'favoritas' && !favs.has(r.id)) return false
      if (filter !== 'todas' && filter !== 'favoritas' && !r.tags.includes(filter)) return false
      if (!needle) return true
      return [r.title, ...r.tags, ...r.ingredientNames].join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, filter, favs])

  if (error) return <p className="error">{error}</p>
  if (!rows) return <p className="center">Cargando…</p>

  const chips = ['todas', 'favoritas', ...allTags]
  return (
    <>
      <div className="pagehead">
        <div>
          <h1><span className="u">Recetas</span></h1>
          <p className="muted">Mi cuaderno · {rows.length} {rows.length === 1 ? 'receta' : 'recetas'}</p>
        </div>
        <Link className="linkbtn" to="/nueva">+ Nueva</Link>
      </div>
      <div className="searchbox">
        <Ln name="srch" />
        <input
          type="search"
          aria-label="Buscar"
          placeholder="Nombre, ingrediente o etiqueta"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="filters" role="group" aria-label="Filtros">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            className="chip"
            aria-pressed={filter === c}
            onClick={() => setFilter(c)}
          >
            {c === 'todas' ? 'Todas' : c === 'favoritas' ? 'Favoritas' : c}
          </button>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="center">
          Aún no hay recetas. Ve a <Link to="/importar">Importar</Link>.
        </p>
      )}
      {rows.length > 0 && visible.length === 0 && <p className="center">Ninguna receta coincide.</p>}
      <ul className="cards">
        {visible.map((r) => (
          <li key={r.id}>
            <RecipeCard recipe={r} favorite={favs.has(r.id)} coverUrl={covers[r.id]} onToggleFavorite={toggleFavorite} />
          </li>
        ))}
      </ul>
    </>
  )
}
