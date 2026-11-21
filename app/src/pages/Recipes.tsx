import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { signedUrls } from '../lib/photos'
import { difficultyLabel } from '../lib/labels'
import { activeCount, emptyFilters, matches, type Filters } from '../lib/filters'
import { Ln } from '../components/Icon'
import FilterSheet from '../components/FilterSheet'
import RecipeCard, { type CardRecipe } from '../components/RecipeCard'

interface Row {
  id: string
  title: string
  prep_minutes: number | null
  cook_minutes: number | null
  difficulty: string | null
  freezable: boolean | null
  appliances: string[]
  parent_recipe_id: string | null
  variant_label: string | null
  recipe_tags: { tags: { name: string; kind: string } | null }[]
  recipe_ingredients: { ingredients: { name: string } | null }[]
}

export default function Recipes({ onlyFavorites = false }: { onlyFavorites?: boolean }) {
  const { session } = useAuth()
  const userId = session!.user.id
  const [rows, setRows] = useState<CardRecipe[] | null>(null)
  const [kinds, setKinds] = useState<Record<string, string>>({}) // etiqueta -> tipo
  const [favs, setFavs] = useState<Set<string>>(new Set())
  const [covers, setCovers] = useState<Record<string, string>>({}) // id de receta -> URL firmada
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [sheet, setSheet] = useState(false)
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    supabase
      .from('recipes')
      .select(
        'id,title,prep_minutes,cook_minutes,difficulty,freezable,appliances,parent_recipe_id,variant_label,recipe_tags(tags(name,kind)),recipe_ingredients(ingredients(name))',
      )
      .order('title')
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        const list = data as unknown as Row[]
        const k: Record<string, string> = {}
        for (const r of list) for (const t of r.recipe_tags) if (t.tags) k[t.tags.name] = t.tags.kind
        setKinds(k)
        setRows(
          list.map((r) => ({
            id: r.id,
            title: r.title,
            prep_minutes: r.prep_minutes,
            cook_minutes: r.cook_minutes,
            difficulty: r.difficulty,
            freezable: r.freezable,
            appliances: r.appliances ?? [],
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

  const setFav = useCallback(
    async (recipeId: string, on: boolean) => {
      setFavs((prev) => {
        const next = new Set(prev)
        if (on) next.add(recipeId)
        else next.delete(recipeId)
        return next
      })
      const { error } = on
        ? await supabase.from('user_favorites').insert({ user_id: userId, recipe_id: recipeId })
        : await supabase.from('user_favorites').delete().eq('user_id', userId).eq('recipe_id', recipeId)
      if (error) {
        setError(error.message)
        setFavs((prev) => {
          const next = new Set(prev)
          if (on) next.delete(recipeId)
          else next.add(recipeId)
          return next
        })
      }
    },
    [userId],
  )

  const toggleFavorite = useCallback(
    (recipeId: string) => {
      const was = favs.has(recipeId)
      void setFav(recipeId, !was)
      if (was && onlyFavorites) {
        // La tarjeta sigue visible unos segundos para poder deshacer.
        const title = rows?.find((r) => r.id === recipeId)?.title ?? ''
        setUndo({ id: recipeId, title })
        clearTimeout(undoTimer.current)
        undoTimer.current = setTimeout(() => setUndo(null), 6000)
      }
    },
    [favs, onlyFavorites, rows, setFav],
  )

  const effective = useMemo<Filters>(() => ({ ...filters, onlyFavs: onlyFavorites || filters.onlyFavs }), [filters, onlyFavorites])
  const favsView = useMemo(() => (undo ? new Set([...favs, undo.id]) : favs), [favs, undo])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows ?? []).filter((r) => {
      if (!matches(r, effective, favsView, kinds)) return false
      if (!needle) return true
      return [r.title, ...r.tags, ...r.ingredientNames].join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, effective, favsView, kinds])

  // Las variantes se muestran bajo su original; si la original no pasa el filtro, la variante sale suelta.
  const { topLevel, children } = useMemo(() => {
    const ids = new Set(visible.map((r) => r.id))
    const children = new Map<string, CardRecipe[]>()
    const topLevel: CardRecipe[] = []
    for (const r of visible) {
      if (r.parent_recipe_id && ids.has(r.parent_recipe_id)) {
        children.set(r.parent_recipe_id, [...(children.get(r.parent_recipe_id) ?? []), r])
      } else topLevel.push(r)
    }
    return { topLevel, children }
  }, [visible])

  if (error) return <p className="error">{error}</p>
  if (!rows) return <p className="center">Cargando…</p>

  const active = activeCount(filters)
  // Lista de filtros activos, cada uno con su cruz para quitarlo.
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...filters.tags.map((t) => ({ key: `t-${t}`, label: t, remove: () => setFilters({ ...filters, tags: filters.tags.filter((x) => x !== t) }) })),
    ...filters.difficulty.map((d) => ({ key: `d-${d}`, label: difficultyLabel(d), remove: () => setFilters({ ...filters, difficulty: filters.difficulty.filter((x) => x !== d) }) })),
    ...(filters.maxMinutes != null ? [{ key: 'time', label: `hasta ${filters.maxMinutes} min`, remove: () => setFilters({ ...filters, maxMinutes: null }) }] : []),
    ...filters.appliances.map((a) => ({ key: `a-${a}`, label: a, remove: () => setFilters({ ...filters, appliances: filters.appliances.filter((x) => x !== a) }) })),
    ...(filters.freezable ? [{ key: 'frz', label: 'se congela', remove: () => setFilters({ ...filters, freezable: false }) }] : []),
    ...(filters.onlyFavs && !onlyFavorites ? [{ key: 'fav', label: 'favoritas', remove: () => setFilters({ ...filters, onlyFavs: false }) }] : []),
  ]
  const total = rows.filter((r) => !onlyFavorites || favs.has(r.id)).length

  return (
    <>
      <div className="pagehead">
        <div>
          <h1><span className="u">{onlyFavorites ? 'Favoritas' : 'Recetas'}</span></h1>
          <p className="muted">
            {onlyFavorites ? 'Mis recetas favoritas' : 'Mi cuaderno'} · {total} {total === 1 ? 'receta' : 'recetas'}
          </p>
        </div>
        {!onlyFavorites && <Link className="linkbtn" to="/nueva">+ Nueva</Link>}
      </div>
      <div className="searchrow">
        <div className="searchbox">
          <Ln name="srch" />
          <input type="search" aria-label="Buscar" placeholder="Nombre, ingrediente o etiqueta" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="alt filterbtn" onClick={() => setSheet(true)}>
          Filtros{active > 0 ? ` (${active})` : ''}
        </button>
      </div>
      {chips.length > 0 && (
        <div className="filters" role="group" aria-label="Filtros activos">
          {chips.map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed="true" aria-label={`Quitar filtro ${c.label}`} onClick={c.remove}>
              {c.label} ×
            </button>
          ))}
          <button type="button" className="link" onClick={() => setFilters(emptyFilters)}>Limpiar todo</button>
        </div>
      )}
      <p className="muted" aria-live="polite">
        {(q || active > 0) && `${visible.length} ${visible.length === 1 ? 'resultado' : 'resultados'}`}
      </p>

      {rows.length === 0 && (
        <p className="center">
          Aún no hay recetas. Ve a <Link to="/importar">Importar</Link>.
        </p>
      )}
      {rows.length > 0 && visible.length === 0 && (
        <p className="center">
          {onlyFavorites && !q && active === 0
            ? 'Todavía no tienes favoritas. Toca el corazón de una receta para guardarla aquí.'
            : 'Ninguna receta coincide.'}
        </p>
      )}
      <ul className="cards">
        {topLevel.map((r) => (
          <li key={r.id}>
            <RecipeCard recipe={r} favorite={favs.has(r.id)} coverUrl={covers[r.id]} onToggleFavorite={toggleFavorite} />
            {(children.get(r.id) ?? []).length > 0 && (
              <div className="variants" aria-label={`Variantes de ${r.title}`}>
                {children.get(r.id)!.map((v) => (
                  <RecipeCard key={v.id} compact recipe={v} favorite={favs.has(v.id)} coverUrl={covers[v.id]} onToggleFavorite={toggleFavorite} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {undo && (
        <div className="toast" role="status">
          <span>Quitada de favoritas</span>
          <button type="button" className="link" onClick={() => { clearTimeout(undoTimer.current); void setFav(undo.id, true); setUndo(null) }}>
            Deshacer
          </button>
        </div>
      )}

      {sheet && (
        <FilterSheet
          recipes={rows}
          favs={favs}
          kinds={kinds}
          initial={filters}
          showFavs={!onlyFavorites}
          onApply={(f) => { setFilters(f); setSheet(false) }}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  )
}
