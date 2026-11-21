import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatQuantity, needsDe, type IngredientRow } from '../lib/quantity'

interface Ing extends IngredientRow {
  id: string
  position: number
  section: string | null
  display_name: string | null
  original_text: string | null
  preparation: string | null
  is_optional: boolean
  ingredients: { name: string } | null
}
interface Step {
  id: string
  position: number
  section: string | null
  body: string
  temperature_c: number | null
}
interface Recipe {
  id: string
  title: string
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  difficulty: string | null
  appliances: string[]
  storage_days: number | null
  freezable: boolean | null
  storage_notes: string | null
  recipe_ingredients: Ing[]
  recipe_steps: Step[]
  recipe_tags: { tags: { name: string } | null }[]
}

function groupBySection<T extends { section: string | null }>(items: T[]) {
  const groups: { section: string | null; items: T[] }[] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.section === it.section) last.items.push(it)
    else groups.push({ section: it.section, items: [it] })
  }
  return groups
}

export default function RecipeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [servings, setServings] = useState<number | null>(null)

  useEffect(() => {
    supabase
      .from('recipes')
      .select('*,recipe_ingredients(*,ingredients(name)),recipe_steps(*),recipe_tags(tags(name))')
      .eq('id', id!)
      .single()
      .then(({ data, error }) => {
        if (error) return setError(error.message)
        const r = data as unknown as Recipe
        r.recipe_ingredients.sort((a, b) => a.position - b.position)
        r.recipe_steps.sort((a, b) => a.position - b.position)
        setRecipe(r)
        setServings(r.servings)
      })
  }, [id])

  async function remove() {
    if (!recipe || !confirm(`¿Eliminar «${recipe.title}»? No se puede deshacer.`)) return
    const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
    if (error) setError(error.message)
    else navigate('/')
  }

  if (error) return <p className="error">{error}</p>
  if (!recipe) return <p className="center">Cargando…</p>

  const factor = recipe.servings && servings ? servings / recipe.servings : 1
  const meta = [
    recipe.prep_minutes != null && `Preparación ${recipe.prep_minutes} min`,
    recipe.cook_minutes != null && `Cocción ${recipe.cook_minutes} min`,
    recipe.difficulty && `Dificultad ${recipe.difficulty}`,
    recipe.appliances.length > 0 && recipe.appliances.join(', '),
  ].filter(Boolean)

  return (
    <article className="recipe">
      <Link to="/">← Recetas</Link>
      <h1>{recipe.title}</h1>
      {meta.length > 0 && <p className="muted">{meta.join(' · ')}</p>}
      <div className="chips">
        {recipe.recipe_tags.map((t) => t.tags && <span key={t.tags.name}>{t.tags.name}</span>)}
      </div>

      {recipe.servings && servings && (
        <div className="servings">
          <button onClick={() => setServings(Math.max(1, servings - 1))} aria-label="Menos raciones">
            −
          </button>
          <span>{servings} raciones</span>
          <button onClick={() => setServings(servings + 1)} aria-label="Más raciones">
            +
          </button>
        </div>
      )}

      <h2>Ingredientes</h2>
      {groupBySection(recipe.recipe_ingredients).map((g, i) => (
        <div key={i}>
          {g.section && <h3>{g.section}</h3>}
          <ul className="ingredients">
            {g.items.map((it) => {
              const name = it.display_name ?? it.ingredients?.name ?? it.original_text ?? ''
              const qty = formatQuantity(it, factor)
              return (
                <li key={it.id}>
                  {qty}
                  {qty && needsDe(it.unit) ? ' de' : ''} {name}
                  {it.preparation && `, ${it.preparation}`}
                  {it.is_optional && <em> (opcional)</em>}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      <h2>Elaboración</h2>
      {groupBySection(recipe.recipe_steps).map((g, i) => (
        <div key={i}>
          {g.section && <h3>{g.section}</h3>}
          <ol start={g.items[0].position + 1}>
            {g.items.map((s) => (
              <li key={s.id}>
                {s.body}
                {s.temperature_c != null && <span className="muted"> · {s.temperature_c} °C</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}

      {(recipe.storage_days != null || recipe.freezable != null || recipe.storage_notes) && (
        <>
          <h2>Conservación</h2>
          <p>
            {recipe.storage_days != null && `${recipe.storage_days} días en frigorífico. `}
            {recipe.freezable === true && 'Apto para congelar. '}
            {recipe.freezable === false && 'No congelar. '}
            {recipe.storage_notes}
          </p>
        </>
      )}

      <button className="danger" onClick={remove}>
        Eliminar receta
      </button>
    </article>
  )
}
