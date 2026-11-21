import { supabase } from './supabase'

export interface ImportIngredient {
  ingredient: string
  section?: string
  qty?: number
  qty_max?: number
  unit?: string
  qty_text?: string
  prep?: string
  optional?: boolean
  alt_qty?: number
  alt_unit?: string
}
export interface ImportStep {
  text: string
  section?: string
  temp_c?: number
  min?: number
  max?: number
}
export interface ImportRecipe {
  title: string
  description?: string
  servings?: number
  prep_minutes?: number
  cook_minutes?: number
  difficulty?: string
  appliances?: string[]
  storage_days?: number
  freezable?: boolean
  storage_notes?: string
  variant_of?: string
  variant_label?: string
  tags?: string[]
  ingredients: ImportIngredient[]
  steps: ImportStep[]
}
export interface ImportFile {
  format: string
  recipes: ImportRecipe[]
}

const TAG_KIND: Record<string, string> = {
  comida: 'momento',
  cena: 'momento',
  desayuno: 'momento',
  vegetariana: 'dieta',
  ligera: 'dieta',
  'cocina asiática': 'cocina',
  'cocina tradicional': 'cocina',
  airfryer: 'tecnica',
  horno: 'tecnica',
  'batch cooking': 'tecnica',
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// "garbanzos cocidos" -> estado cocido, alimento base "garbanzo" (heurística simple)
function parseState(name: string): { state: string | null; base: string | null } {
  const m = name.match(/^(.+?)\s+cocid[oa]s?$/)
  if (!m) return { state: null, base: null }
  return { state: 'cocido', base: m[1].replace(/s$/, '') }
}

export interface ImportResult {
  created: string[]
  skipped: string[]
  failed: string[]
}

export async function importRecipes(
  file: ImportFile,
  householdId: string,
  userId: string,
): Promise<ImportResult> {
  const result: ImportResult = { created: [], skipped: [], failed: [] }

  // Catálogo existente (nombre y alias -> id)
  const ingMap = new Map<string, string>()
  const { data: ings } = await supabase
    .from('ingredients')
    .select('id,name')
    .eq('household_id', householdId)
  ings?.forEach((i) => ingMap.set(norm(i.name), i.id))
  const { data: aliases } = await supabase
    .from('ingredient_aliases')
    .select('ingredient_id,alias')
    .eq('household_id', householdId)
  aliases?.forEach((a) => ingMap.set(norm(a.alias), a.ingredient_id))

  const tagMap = new Map<string, string>()
  const { data: tags } = await supabase.from('tags').select('id,name').eq('household_id', householdId)
  tags?.forEach((t) => tagMap.set(norm(t.name), t.id))

  const { data: existing } = await supabase
    .from('recipes')
    .select('id,title')
    .eq('household_id', householdId)
  const titles = new Map((existing ?? []).map((r) => [norm(r.title), r.id as string]))

  async function ingredientId(raw: string): Promise<string> {
    const name = norm(raw)
    const found = ingMap.get(name)
    if (found) return found
    const { state, base } = parseState(name)
    const parent = base ? await ingredientId(base) : null
    const { data, error } = await supabase
      .from('ingredients')
      .insert({ household_id: householdId, name, state, parent_ingredient_id: parent })
      .select('id')
      .single()
    if (error) throw new Error(`ingrediente «${name}»: ${error.message}`)
    ingMap.set(name, data.id)
    return data.id
  }

  async function tagId(raw: string): Promise<string> {
    const name = norm(raw)
    const found = tagMap.get(name)
    if (found) return found
    const { data, error } = await supabase
      .from('tags')
      .insert({ household_id: householdId, name, kind: TAG_KIND[name] ?? 'otro' })
      .select('id')
      .single()
    if (error) throw new Error(`etiqueta «${name}»: ${error.message}`)
    tagMap.set(name, data.id)
    return data.id
  }

  for (const r of file.recipes) {
    if (titles.has(norm(r.title))) {
      result.skipped.push(r.title)
      continue
    }
    let recipeId: string | null = null
    try {
      const parentId = r.variant_of ? (titles.get(norm(r.variant_of)) ?? null) : null
      const { data: rec, error } = await supabase
        .from('recipes')
        .insert({
          household_id: householdId,
          created_by: userId,
          title: r.title,
          description: r.description ?? null,
          servings: r.servings ?? null,
          prep_minutes: r.prep_minutes ?? null,
          cook_minutes: r.cook_minutes ?? null,
          difficulty: r.difficulty ?? null,
          appliances: r.appliances ?? [],
          storage_days: r.storage_days ?? null,
          freezable: r.freezable ?? null,
          storage_notes: r.storage_notes ?? null,
          parent_recipe_id: parentId,
          variant_label: parentId ? (r.variant_label ?? null) : null,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      const rid: string = rec.id
      recipeId = rid

      const ingRows = []
      for (let i = 0; i < r.ingredients.length; i++) {
        const it = r.ingredients[i]
        ingRows.push({
          recipe_id: rid,
          ingredient_id: await ingredientId(it.ingredient),
          position: i,
          section: it.section ?? null,
          original_text: it.ingredient,
          quantity_min: it.qty ?? null,
          quantity_max: it.qty_max ?? null,
          unit: it.unit ?? null,
          quantity_text: it.qty_text ?? null,
          alt_quantity: it.alt_qty ?? null,
          alt_unit: it.alt_unit ?? null,
          preparation: it.prep ?? null,
          is_optional: it.optional ?? false,
        })
      }
      const { error: e1 } = await supabase.from('recipe_ingredients').insert(ingRows)
      if (e1) throw new Error(e1.message)

      const stepRows = r.steps.map((s, i) => ({
        recipe_id: rid,
        position: i,
        section: s.section ?? null,
        body: s.text,
        temperature_c: s.temp_c ?? null,
        timer_min_seconds: s.min != null ? s.min * 60 : null,
        timer_max_seconds: s.max != null ? s.max * 60 : null,
      }))
      const { error: e2 } = await supabase.from('recipe_steps').insert(stepRows)
      if (e2) throw new Error(e2.message)

      const tagRows = []
      for (const t of r.tags ?? []) tagRows.push({ recipe_id: rid, tag_id: await tagId(t) })
      if (tagRows.length) {
        const { error: e3 } = await supabase.from('recipe_tags').insert(tagRows)
        if (e3) throw new Error(e3.message)
      }

      await supabase.from('recipe_sources').insert({ recipe_id: rid, kind: 'json' })
      titles.set(norm(r.title), rid)
      result.created.push(r.title)
    } catch (e) {
      // No dejar recetas a medias: se borra y se informa.
      if (recipeId) await supabase.from('recipes').delete().eq('id', recipeId)
      result.failed.push(`${r.title}: ${(e as Error).message}`)
    }
  }
  return result
}
