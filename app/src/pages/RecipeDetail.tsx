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
import { difficultyLabel } from '../lib/labels'
import PhotoAdd from '../components/PhotoAdd'
import PhotoViewer from '../components/PhotoViewer'

interface FamilyRow {
  id: string
  title: string
  variant_label: string | null
  parent_recipe_id: string | null
}
interface OriginalIng extends IngredientRow {
  ingredient_id: string | null
  ingredients: { name: string } | null
}

interface Ing extends IngredientRow {
  id: string
  ingredient_id: string | null
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
  parent_recipe_id: string | null
  variant_label: string | null
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
  const [family, setFamily] = useState<FamilyRow[]>([]) // original y variantes
  const [originalIngs, setOriginalIngs] = useState<OriginalIng[] | null>(null)
  const [deleteDialog, setDeleteDialog] = useState(false)

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

  const recipeId = recipe?.id
  const parentId = recipe?.parent_recipe_id ?? null
  useEffect(() => {
    if (!recipeId) return
    const rootId = parentId ?? recipeId
    supabase
      .from('recipes')
      .select('id,title,variant_label,parent_recipe_id')
      .or(`id.eq.${rootId},parent_recipe_id.eq.${rootId}`)
      .order('created_at')
      .then(({ data }) => setFamily((data ?? []) as FamilyRow[]))
    setOriginalIngs(null)
    if (parentId)
      supabase
        .from('recipe_ingredients')
        .select('ingredient_id,quantity_min,quantity_max,unit,quantity_text,alt_quantity,alt_unit,ingredients(name)')
        .eq('recipe_id', parentId)
        .then(({ data }) => setOriginalIngs((data ?? []) as unknown as OriginalIng[]))
  }, [recipeId, parentId])

  // Diferencias de ingredientes frente a la receta original.
  const diff = useMemo(() => {
    if (!recipe || !recipe.parent_recipe_id || !originalIngs) return null
    const key = (i: { ingredient_id: string | null }) => i.ingredient_id ?? ''
    const orig = new Map(originalIngs.map((i) => [key(i), i]))
    const cur = new Map(recipe.recipe_ingredients.map((i) => [key(i), i]))
    const lines: { sym: '+' | '−' | '≠'; text: string }[] = []
    for (const [k, c] of cur) {
      const name = c.ingredients?.name ?? c.original_text ?? ''
      const o = orig.get(k)
      if (!o) lines.push({ sym: '+', text: `${[formatQuantity(c, 1)].filter(Boolean).join('')} ${name}`.trim() })
      else if (formatQuantity(o, 1) !== formatQuantity(c, 1))
        lines.push({ sym: '≠', text: `${name}: ${formatQuantity(o, 1) || 'sin cantidad'} → ${formatQuantity(c, 1) || 'sin cantidad'}` })
    }
    for (const [k, o] of orig) if (!cur.has(k)) lines.push({ sym: '−', text: o.ingredients?.name ?? '' })
    return lines
  }, [recipe, originalIngs])

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

  const variants = family.filter((x) => x.parent_recipe_id === recipe?.id)

  function remove() {
    if (!recipe) return
    if (variants.length > 0) return setDeleteDialog(true)
    if (confirm(`¿Eliminar «${recipe.title}»? No se puede deshacer.`)) void doDelete(false)
  }

  // withVariants=false: las variantes pasan a ser recetas independientes. true: se borran con la original.
  async function doDelete(withVariants: boolean) {
    if (!recipe) return
    setDeleteDialog(false)
    const paths = recipe.recipe_images.map((i) => i.storage_path)
    if (withVariants && variants.length) {
      const { data } = await supabase.from('recipe_images').select('storage_path').in('recipe_id', variants.map((v) => v.id))
      paths.push(...(data ?? []).map((d) => d.storage_path as string))
    } else if (variants.length) {
      const up = await supabase.from('recipes').update({ parent_recipe_id: null, variant_label: null }).eq('parent_recipe_id', recipe.id)
      if (up.error) return setError(up.error.message)
    }
    const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
    if (error) return setError(error.message)
    if (paths.length) await supabase.storage.from('recipe-images').remove(paths)
    navigate('/')
  }

  async function makeIndependent() {
    if (!recipe || !confirm('Esta receta dejará de ser una variante y pasará a ser una receta independiente.')) return
    await act(async () => {
      const { error } = await supabase.from('recipes').update({ parent_recipe_id: null, variant_label: null }).eq('id', recipe.id)
      if (error) throw new Error(error.message)
    })
  }

  if (!recipe) return error ? <p className="error">{error}</p> : <p className="center">Cargando…</p>

  const factor = recipe.servings && servings ? servings / recipe.servings : 1
  const meta = [
    recipe.prep_minutes != null && `Preparación ${recipe.prep_minutes} min`,
    recipe.cook_minutes != null && `Cocción ${recipe.cook_minutes} min`,
    recipe.difficulty && `Dificultad ${difficultyLabel(recipe.difficulty)}`,
    recipe.appliances.length > 0 && recipe.appliances.join(', '),
  ].filter(Boolean)
  const stepPhotos = (stepId: string) => recipe.recipe_images.filter((i) => i.step_id === stepId)
  const openPhoto = (img: RecipeImage) => setViewer(allImages.findIndex((i) => i.id === img.id))

  return (
    <article className="recipe">
      <Link to="/">← Recetas</Link>
      <div className="pagehead">
        <h1>{recipe.title}</h1>
        <Link className="linkbtn alt" to={`/receta/${recipe.id}/editar`}>Editar</Link>
      </div>
      {meta.length > 0 && <p className="muted">{meta.join(' · ')}</p>}
      {recipe.recipe_steps.length > 0 && (
        <Link className="linkbtn" to={`/receta/${recipe.id}/cocinar`}>Cocinar paso a paso</Link>
      )}
      <div className="chips">
        {recipe.recipe_tags.map((t) => t.tags && <span key={t.tags.name}>{t.tags.name}</span>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {(family.length > 1 || recipe.parent_recipe_id) && (
        <section aria-label="Versiones" className="versions">
          <h3>Versiones</h3>
          <div className="chiprow">
            {family.map((v) => (
              <Link key={v.id} className="chip" to={`/receta/${v.id}`} aria-current={v.id === recipe.id ? 'page' : undefined} aria-pressed={v.id === recipe.id}>
                {v.parent_recipe_id ? v.variant_label : 'Original'}
              </Link>
            ))}
          </div>
          {recipe.parent_recipe_id && (
            <>
              <p className="muted">
                Variante de <Link to={`/receta/${recipe.parent_recipe_id}`}>{family.find((x) => x.id === recipe.parent_recipe_id)?.title ?? 'la original'}</Link>
                {recipe.variant_label && <> · {recipe.variant_label}</>}
              </p>
              {diff && (
                <>
                  <h3>Qué cambia</h3>
                  {diff.length === 0 ? (
                    <p className="muted">Mismos ingredientes que la original (los pasos pueden variar).</p>
                  ) : (
                    <ul className="diff">
                      {diff.map((l, k) => (
                        <li key={k}><b aria-label={l.sym === '+' ? 'añade' : l.sym === '−' ? 'quita' : 'cambia'}>{l.sym}</b> {l.text}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <button type="button" className="link" onClick={makeIndependent}>Hacer receta independiente</button>
            </>
          )}
        </section>
      )}
      {!recipe.parent_recipe_id && (
        <Link className="linkbtn alt" to={`/receta/${recipe.id}/variante`}>+ Crear variante</Link>
      )}

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

      {deleteDialog && (
        <div className="sheet-wrap" onClick={() => setDeleteDialog(false)}>
          <div className="dialog" role="alertdialog" aria-labelledby="dlg-t" onClick={(e) => e.stopPropagation()}>
            <h2 id="dlg-t">Esta receta tiene {variants.length} {variants.length === 1 ? 'variante' : 'variantes'}</h2>
            <p>¿Qué hacemos con {variants.length === 1 ? 'ella' : 'ellas'}?</p>
            <button type="button" onClick={() => doDelete(false)}>Eliminar solo la original</button>
            <p className="muted">Las variantes se conservan como recetas independientes.</p>
            <button type="button" className="danger" onClick={() => doDelete(true)}>Eliminar la original y sus variantes</button>
            <button type="button" className="alt" onClick={() => setDeleteDialog(false)}>Cancelar</button>
          </div>
        </div>
      )}

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
