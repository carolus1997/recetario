import { supabase } from './supabase'
import { createCatalog } from './catalog'

export interface FormIngredient {
  key: string
  ingredient: string
  qty: string
  unit: string
  preparation: string
  optional: boolean
  alt_quantity: number | null // se conservan al editar, aún sin campo en el formulario
  alt_unit: string | null
}
export interface FormGroup {
  key: string
  section: string
  items: FormIngredient[]
}
export interface FormStep {
  key: string
  id?: string
  section: string
  text: string
  temp: string
  min: string
  max: string
}
export interface FormState {
  title: string
  description: string
  servings: number
  prep: string
  cook: string
  difficulty: string
  groups: FormGroup[]
  steps: FormStep[]
  tags: string[]
  appliances: string[]
  storageDays: string
  freezable: '' | 'si' | 'no'
  storageNotes: string
  variantLabel: string // solo si la receta es una variante
}

export const newKey = () => crypto.randomUUID()
export const emptyIngredient = (): FormIngredient => ({
  key: newKey(), ingredient: '', qty: '', unit: '', preparation: '', optional: false, alt_quantity: null, alt_unit: null,
})
export const emptyStep = (): FormStep => ({ key: newKey(), section: '', text: '', temp: '', min: '', max: '' })
export const emptyForm = (): FormState => ({
  title: '', description: '', servings: 4, prep: '', cook: '', difficulty: '',
  groups: [{ key: newKey(), section: '', items: [emptyIngredient()] }],
  steps: [emptyStep()], tags: [], appliances: [], storageDays: '', freezable: '', storageNotes: '', variantLabel: '',
})

// "2", "0,5", "1/2", "1 1/2", "2-3" -> números; cualquier otra cosa ("al gusto") se guarda como texto.
export function parseQty(raw: string): { min: number | null; max: number | null; text: string | null } {
  const s = raw.trim()
  if (!s) return { min: null, max: null, text: null }
  const num = (t: string): number => {
    const x = t.trim().replace(',', '.')
    const mixed = x.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
    if (mixed) return +mixed[1] + +mixed[2] / +mixed[3]
    const frac = x.match(/^(\d+)\s*\/\s*(\d+)$/)
    if (frac) return +frac[1] / +frac[2]
    return /^\d+(\.\d+)?$/.test(x) ? +x : NaN
  }
  const parts = s.split(/\s*[-–]\s*/)
  if (parts.length === 2) {
    const a = num(parts[0])
    const b = num(parts[1])
    if (!isNaN(a) && !isNaN(b) && b >= a) return { min: a, max: b, text: null }
  }
  const n = num(s)
  if (!isNaN(n)) return { min: n, max: null, text: null }
  return { min: null, max: null, text: s }
}

export function qtyToText(min: number | null, max: number | null, text: string | null): string {
  const f = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
  if (min == null) return text ?? ''
  return max != null && max !== min ? `${f(min)}-${f(max)}` : f(min)
}

const toInt = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Math.round(Number(s)))

export interface SaveContext {
  householdId: string
  userId: string
  editing?: { id: string; version: number; snapshot: unknown }
  parentId?: string | null // receta original, si esta receta es (o va a ser) una variante
}

export async function saveRecipe(f: FormState, ctx: SaveContext): Promise<string> {
  const catalog = await createCatalog(ctx.householdId)

  const fields = {
    title: f.title.trim(),
    description: f.description.trim() || null,
    servings: f.servings || null,
    prep_minutes: toInt(f.prep),
    cook_minutes: toInt(f.cook),
    difficulty: f.difficulty || null,
    appliances: f.appliances,
    storage_days: toInt(f.storageDays),
    freezable: f.freezable === 'si' ? true : f.freezable === 'no' ? false : null,
    storage_notes: f.storageNotes.trim() || null,
    variant_label: ctx.parentId ? f.variantLabel.trim() : null,
  }

  let recipeId: string
  const creating = !ctx.editing
  if (ctx.editing) {
    recipeId = ctx.editing.id
    // Copia del contenido anterior para poder recuperarlo.
    const rev = await supabase.from('recipe_revisions').insert({
      recipe_id: recipeId, version: ctx.editing.version, snapshot: ctx.editing.snapshot, changed_by: ctx.userId,
    })
    if (rev.error) throw new Error(rev.error.message)
    // Solo se actualiza si nadie la ha cambiado entretanto.
    const { data, error } = await supabase
      .from('recipes')
      .update({ ...fields, version: ctx.editing.version + 1 })
      .eq('id', recipeId)
      .eq('version', ctx.editing.version)
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0)
      throw new Error('Otra persona ha modificado esta receta mientras la editabas. Recarga la página para ver sus cambios.')
  } else {
    const { data, error } = await supabase
      .from('recipes')
      .insert({ ...fields, household_id: ctx.householdId, created_by: ctx.userId, parent_recipe_id: ctx.parentId ?? null })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    recipeId = data.id
  }

  try {
    // Ingredientes: se reemplazan por completo (nada depende de ellos).
    if (!creating) {
      const del = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId)
      if (del.error) throw new Error(del.error.message)
    }
    const ingRows = []
    let pos = 0
    for (const g of f.groups) {
      for (const it of g.items) {
        if (!it.ingredient.trim()) continue
        const q = parseQty(it.qty)
        ingRows.push({
          recipe_id: recipeId,
          ingredient_id: await catalog.ingredientId(it.ingredient),
          position: pos++,
          section: g.section.trim() || null,
          original_text: it.ingredient.trim(),
          quantity_min: q.min,
          quantity_max: q.max,
          unit: it.unit || null,
          quantity_text: q.text,
          alt_quantity: it.alt_quantity,
          alt_unit: it.alt_unit,
          preparation: it.preparation.trim() || null,
          is_optional: it.optional,
        })
      }
    }
    if (ingRows.length) {
      const r = await supabase.from('recipe_ingredients').insert(ingRows)
      if (r.error) throw new Error(r.error.message)
    }

    // Pasos: se actualizan por id para no soltar las fotos asociadas a cada paso.
    const steps = f.steps.filter((s) => s.text.trim())
    if (!creating) {
      const keep = steps.flatMap((s) => (s.id ? [s.id] : []))
      const { data: current } = await supabase.from('recipe_steps').select('id').eq('recipe_id', recipeId)
      const remove = (current ?? []).map((c) => c.id as string).filter((id) => !keep.includes(id))
      if (remove.length) {
        const r = await supabase.from('recipe_steps').delete().in('id', remove)
        if (r.error) throw new Error(r.error.message)
      }
      // Posición provisional alta para no chocar con la restricción de posiciones únicas.
      for (let i = 0; i < steps.length; i++) {
        if (!steps[i].id) continue
        const r = await supabase.from('recipe_steps').update({ position: 10000 + i }).eq('id', steps[i].id!)
        if (r.error) throw new Error(r.error.message)
      }
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const mn = toInt(s.min)
      const mx = toInt(s.max)
      const row = {
        position: i,
        section: s.section.trim() || null,
        body: s.text.trim(),
        temperature_c: toInt(s.temp),
        timer_min_seconds: mn != null ? mn * 60 : null,
        timer_max_seconds: mx != null ? mx * 60 : null,
      }
      // Al crear (también una variante copiada de otra receta) siempre se inserta: nunca se actualizan pasos ajenos.
      const r = !creating && s.id
        ? await supabase.from('recipe_steps').update(row).eq('id', s.id)
        : await supabase.from('recipe_steps').insert({ ...row, recipe_id: recipeId })
      if (r.error) throw new Error(r.error.message)
    }

    // Etiquetas
    if (!creating) {
      const r = await supabase.from('recipe_tags').delete().eq('recipe_id', recipeId)
      if (r.error) throw new Error(r.error.message)
    }
    const tagRows = []
    for (const t of f.tags) tagRows.push({ recipe_id: recipeId, tag_id: await catalog.tagId(t) })
    if (tagRows.length) {
      const r = await supabase.from('recipe_tags').insert(tagRows)
      if (r.error) throw new Error(r.error.message)
    }

    if (creating) await supabase.from('recipe_sources').insert({ recipe_id: recipeId, kind: 'manual' })
  } catch (e) {
    // Al crear no se deja una receta a medias.
    if (creating) await supabase.from('recipes').delete().eq('id', recipeId)
    throw e
  }
  return recipeId
}
