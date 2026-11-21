import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { formatQuantity, needsDe, type IngredientRow } from '../lib/quantity'
import {
  deletePhoto,
  setCover,
  setStep,
  signedUrls,
  uploadPhoto,
  type RecipeImage,
} from '../lib/photos'
import PhotoAdd from '../components/PhotoAdd'
import PhotoViewer from '../components/PhotoViewer'

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
  recipe_images: RecipeImage[]
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
  const { householdId } = useAuth()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [servings, setServings] = useState<number | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<string | null>(null) // 'general' | id de paso
  const [viewer, setViewer] = useState<number | null>(null)

  const load = useCallback(
    async (initial: boolean) => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          '*,recipe_ingredients(*,ingredients(name)),recipe_steps(*),recipe_tags(tags(name)),recipe_images(*)',
        )
        .eq('id', id!)
        .single()
      if (error) return setError(error.message)
      const r = data as unknown as Recipe
      r.recipe_ingredients.sort((a, b) => a.position - b.position)
      r.recipe_steps.sort((a, b) => a.position - b.position)
      r.recipe_images.sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)
      setRecipe(r)
      if (initial) setServings(r.servings)
      try {
        setUrls(await signedUrls(r.recipe_images.map((i) => i.storage_path)))
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [id],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  const general = useMemo(() => (recipe?.recipe_images ?? []).filter((i) => !i.step_id), [recipe])
  // El visor recorre todas las fotos en este orden: generales y luego las de los pasos.
  const allImages = useMemo(
    () => [...general, ...(recipe?.recipe_images ?? []).filter((i) => i.step_id)],
    [general, recipe],
  )

  async function upload(files: File[], stepId: string | null) {
    if (!recipe || !householdId) return
    setUploading(stepId ?? 'general')
    setError(null)
    let count = recipe.recipe_images.length
    let hasCover = recipe.recipe_images.some((i) => i.is_cover)
    try {
      for (const file of files) {
        await uploadPhoto({ householdId, recipeId: recipe.id, file, stepId, existingCount: count, hasCover })
        count += 1
        if (!stepId) hasCover = true
      }
    } catch (e) {
      setError((e as Error).message)
    }
    await load(false)
    setUploading(null)
  }

  async function act(fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    }
    await load(false)
  }

  async function remove() {
    if (!recipe || !confirm(`¿Eliminar «${recipe.title}»? No se puede deshacer.`)) return
    const paths = recipe.recipe_images.map((i) => i.storage_path)
    const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
    if (error) return setError(error.message)
    if (paths.length) await supabase.storage.from('recipe-images').remove(paths)
    navigate('/')
  }

  if (!recipe) return error ? <p className="error">{error}</p> : <p className="center">Cargando…</p>

  const factor = recipe.servings && servings ? servings / recipe.servings : 1
  const meta = [
    recipe.prep_minutes != null && `Preparación ${recipe.prep_minutes} min`,
    recipe.cook_minutes != null && `Cocción ${recipe.cook_minutes} min`,
    recipe.difficulty && `Dificultad ${recipe.difficulty}`,
    recipe.appliances.length > 0 && recipe.appliances.join(', '),
  ].filter(Boolean)
  const stepPhotos = (stepId: string) => recipe.recipe_images.filter((i) => i.step_id === stepId)
  const openPhoto = (img: RecipeImage) => setViewer(allImages.findIndex((i) => i.id === img.id))

  return (
    <article className="recipe">
      <Link to="/">← Recetas</Link>
      <h1>{recipe.title}</h1>
      {meta.length > 0 && <p className="muted">{meta.join(' · ')}</p>}
      <div className="chips">
        {recipe.recipe_tags.map((t) => t.tags && <span key={t.tags.name}>{t.tags.name}</span>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section aria-label="Fotos">
        {general.length > 0 && (
          <>
            <button type="button" className="cover" onClick={() => openPhoto(general[0])} aria-label="Ver foto de portada">
              {urls[general[0].storage_path] && <img src={urls[general[0].storage_path]} alt={`Foto de ${recipe.title}`} />}
            </button>
            {general.length > 1 && (
              <div className="thumbs">
                {general.slice(1).map((img) => (
                  <button key={img.id} type="button" className="thumb" onClick={() => openPhoto(img)} aria-label="Ver foto">
                    {urls[img.storage_path] && <img src={urls[img.storage_path]} alt="" />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <PhotoAdd
          busy={uploading === 'general'}
          label={general.length ? 'Otra foto' : 'Añadir foto'}
          onFiles={(f) => upload(f, null)}
        />
      </section>

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
                {stepPhotos(s.id).length > 0 && (
                  <div className="thumbs">
                    {stepPhotos(s.id).map((img) => (
                      <button key={img.id} type="button" className="thumb" onClick={() => openPhoto(img)} aria-label={`Ver foto del paso ${s.position + 1}`}>
                        {urls[img.storage_path] && <img src={urls[img.storage_path]} alt="" />}
                      </button>
                    ))}
                  </div>
                )}
                <PhotoAdd compact busy={uploading === s.id} onFiles={(f) => upload(f, s.id)} />
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

      {viewer !== null && allImages.length > 0 && (
        <PhotoViewer
          images={allImages}
          urls={urls}
          index={Math.min(viewer, allImages.length - 1)}
          steps={recipe.recipe_steps}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          onCover={(img) => act(() => setCover(img))}
          onStep={(img, stepId) => act(() => setStep(img, stepId))}
          onDelete={(img) => {
            if (!confirm('¿Eliminar esta foto? No se puede deshacer.')) return
            void act(() => deletePhoto(img))
            if (allImages.length <= 1) setViewer(null)
          }}
        />
      )}
    </article>
  )
}
