import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { supabase } from './supabase'
import { BUCKET } from './photos'

export const BACKUP_FORMAT = 'recetario-backup/1'
const PAGE = 1000 // la API devuelve como máximo 1000 filas por petición

type Row = Record<string, unknown>
type Progress = (msg: string) => void

interface BackupData {
  format: string
  exported_at: string
  tables: {
    ingredients: Row[]
    ingredient_aliases: Row[]
    ingredient_unit_conversions: Row[]
    ingredient_yields: Row[]
    tags: Row[]
    recipes: Row[]
    recipe_ingredients: Row[]
    recipe_steps: Row[]
    recipe_tags: Row[]
    recipe_images: Row[]
    recipe_sources: Row[]
    recipe_revisions: Row[]
    user_favorites: Row[] // solo las de quien exporta
  }
}

async function fetchAll(table: string, orderBy: string[], userId?: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('*')
    if (userId) q = q.eq('user_id', userId)
    for (const c of orderBy) q = q.order(c)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

const fileName = (path: string) => path.split('/').pop()!

// ---------- Exportar ----------

export async function exportBackup(userId: string, progress: Progress): Promise<{ blob: Blob; recipes: number; photos: number }> {
  progress('Leyendo recetas…')
  const t = {
    ingredients: await fetchAll('ingredients', ['id']),
    ingredient_aliases: await fetchAll('ingredient_aliases', ['id']),
    ingredient_unit_conversions: await fetchAll('ingredient_unit_conversions', ['ingredient_id', 'unit']),
    ingredient_yields: await fetchAll('ingredient_yields', ['from_ingredient_id', 'to_ingredient_id']),
    tags: await fetchAll('tags', ['id']),
    recipes: await fetchAll('recipes', ['id']),
    recipe_ingredients: await fetchAll('recipe_ingredients', ['id']),
    recipe_steps: await fetchAll('recipe_steps', ['id']),
    recipe_tags: await fetchAll('recipe_tags', ['recipe_id', 'tag_id']),
    recipe_images: await fetchAll('recipe_images', ['id']),
    recipe_sources: await fetchAll('recipe_sources', ['id']),
    recipe_revisions: await fetchAll('recipe_revisions', ['id']),
    user_favorites: await fetchAll('user_favorites', ['recipe_id'], userId),
  }

  const files: Zippable = {}
  const images = t.recipe_images
  for (let i = 0; i < images.length; i++) {
    progress(`Descargando fotos (${i + 1} de ${images.length})…`)
    const path = images[i].storage_path as string
    const { data, error } = await supabase.storage.from(BUCKET).download(path)
    if (error || !data) throw new Error(`No se pudo descargar la foto ${fileName(path)}: ${error?.message ?? 'sin datos'}`)
    files[`photos/${fileName(path)}`] = [new Uint8Array(await data.arrayBuffer()), { level: 0 }] // ya están comprimidas
  }

  const payload: BackupData = { format: BACKUP_FORMAT, exported_at: new Date().toISOString(), tables: t }
  files['data.json'] = [strToU8(JSON.stringify(payload)), { level: 6 }]
  progress('Creando el archivo…')
  const zipped = zipSync(files)
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), recipes: t.recipes.length, photos: images.length }
}

// ---------- Restaurar ----------

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const pick = (row: Row, keys: string[]): Row => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))

export interface RestoreResult {
  created: string[]
  skipped: string[]
  failed: string[]
  photos: number
}

// Nunca borra ni modifica lo que ya existe: las recetas con un título ya presente se omiten,
// y los ingredientes y etiquetas se enlazan por nombre con los existentes.
export async function restoreBackup(
  file: File,
  householdId: string,
  userId: string,
  progress: Progress,
): Promise<RestoreResult> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('El archivo no es un ZIP válido.')
  }
  if (!entries['data.json']) throw new Error('Falta data.json: no parece una copia de Recetario.')
  const data = JSON.parse(strFromU8(entries['data.json'])) as BackupData
  if (data.format !== BACKUP_FORMAT) throw new Error(`Formato no reconocido (${data.format}).`)
  const t = data.tables

  const result: RestoreResult = { created: [], skipped: [], failed: [], photos: 0 }

  // --- Ingredientes: se enlazan por nombre, o se crean ---
  progress('Ingredientes y etiquetas…')
  const ingMap = new Map<string, string>() // id antiguo -> id nuevo
  const existingIng = new Map<string, string>()
  for (const r of await fetchAll('ingredients', ['id'])) existingIng.set(norm(r.name as string), r.id as string)
  const createdIng: string[] = []
  for (const r of t.ingredients) {
    const name = norm(r.name as string)
    let id = existingIng.get(name)
    if (!id) {
      const { data: ins, error } = await supabase
        .from('ingredients')
        .insert({ household_id: householdId, ...pick(r, ['name', 'category', 'common_units', 'allergens', 'state', 'notes']) })
        .select('id')
        .single()
      if (error) throw new Error(`ingrediente «${name}»: ${error.message}`)
      id = ins.id as string
      existingIng.set(name, id)
      createdIng.push(r.id as string)
    }
    ingMap.set(r.id as string, id)
  }
  // Alimento base (parent) solo en los ingredientes creados ahora.
  for (const r of t.ingredients) {
    if (!r.parent_ingredient_id || !createdIng.includes(r.id as string)) continue
    const parent = ingMap.get(r.parent_ingredient_id as string)
    if (parent) await supabase.from('ingredients').update({ parent_ingredient_id: parent }).eq('id', ingMap.get(r.id as string)!)
  }
  const aliasRows = t.ingredient_aliases.flatMap((a) => {
    const ing = ingMap.get(a.ingredient_id as string)
    return ing ? [{ household_id: householdId, ingredient_id: ing, alias: a.alias }] : []
  })
  if (aliasRows.length) await supabase.from('ingredient_aliases').upsert(aliasRows, { onConflict: 'household_id,alias', ignoreDuplicates: true })
  const convRows = t.ingredient_unit_conversions.flatMap((c) => {
    const ing = ingMap.get(c.ingredient_id as string)
    return ing ? [{ ...pick(c, ['unit', 'grams_per_unit', 'source']), ingredient_id: ing }] : []
  })
  if (convRows.length) await supabase.from('ingredient_unit_conversions').upsert(convRows, { onConflict: 'ingredient_id,unit', ignoreDuplicates: true })
  const yieldRows = t.ingredient_yields.flatMap((y) => {
    const a = ingMap.get(y.from_ingredient_id as string)
    const b = ingMap.get(y.to_ingredient_id as string)
    return a && b ? [{ from_ingredient_id: a, to_ingredient_id: b, to_per_from: y.to_per_from, source: y.source ?? null }] : []
  })
  if (yieldRows.length) await supabase.from('ingredient_yields').upsert(yieldRows, { onConflict: 'from_ingredient_id,to_ingredient_id', ignoreDuplicates: true })

  // --- Etiquetas ---
  const tagMap = new Map<string, string>()
  const existingTags = new Map<string, string>()
  for (const r of await fetchAll('tags', ['id'])) existingTags.set(norm(r.name as string), r.id as string)
  for (const r of t.tags) {
    const name = norm(r.name as string)
    let id = existingTags.get(name)
    if (!id) {
      const { data: ins, error } = await supabase
        .from('tags')
        .insert({ household_id: householdId, name, kind: r.kind ?? 'otro' })
        .select('id')
        .single()
      if (error) throw new Error(`etiqueta «${name}»: ${error.message}`)
      id = ins.id as string
      existingTags.set(name, id)
    }
    tagMap.set(r.id as string, id)
  }

  // --- Recetas ---
  const existing = await fetchAll('recipes', ['id'])
  const titleToId = new Map(existing.map((r) => [norm(r.title as string), r.id as string]))
  const recipeMap = new Map<string, string>() // id antiguo -> id nuevo (solo las creadas)
  const oldTitleToId = new Map(t.recipes.map((r) => [r.id as string, norm(r.title as string)]))

  const by = <T extends Row>(rows: T[], key: string) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r[key] as string, [...(m.get(r[key] as string) ?? []), r])
    return m
  }
  const ingByRecipe = by(t.recipe_ingredients, 'recipe_id')
  const stepsByRecipe = by(t.recipe_steps, 'recipe_id')
  const tagsByRecipe = by(t.recipe_tags, 'recipe_id')
  const imgsByRecipe = by(t.recipe_images, 'recipe_id')
  const srcByRecipe = by(t.recipe_sources, 'recipe_id')
  const revByRecipe = by(t.recipe_revisions, 'recipe_id')

  for (let n = 0; n < t.recipes.length; n++) {
    const r = t.recipes[n]
    const title = r.title as string
    progress(`Restaurando recetas (${n + 1} de ${t.recipes.length})…`)
    if (titleToId.has(norm(title))) {
      result.skipped.push(title)
      continue
    }
    let newId: string | null = null
    const uploaded: string[] = []
    try {
      const { data: rec, error } = await supabase
        .from('recipes')
        .insert({
          household_id: householdId,
          created_by: userId,
          ...pick(r, ['title', 'description', 'servings', 'prep_minutes', 'cook_minutes', 'category', 'difficulty', 'storage_days', 'freezable', 'storage_notes', 'notes', 'variant_label']),
          appliances: (r.appliances as string[] | null) ?? [],
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      newId = rec.id as string
      const rid = newId

      const ingRows = (ingByRecipe.get(r.id as string) ?? []).map((i) => ({
        recipe_id: rid,
        ingredient_id: i.ingredient_id ? (ingMap.get(i.ingredient_id as string) ?? null) : null,
        ...pick(i, ['position', 'section', 'original_text', 'display_name', 'quantity_min', 'quantity_max', 'unit', 'alt_quantity', 'alt_unit', 'quantity_text', 'preparation']),
        is_optional: i.is_optional ?? false,
      }))
      if (ingRows.length) {
        const e = (await supabase.from('recipe_ingredients').insert(ingRows)).error
        if (e) throw new Error(e.message)
      }

      const oldSteps = stepsByRecipe.get(r.id as string) ?? []
      const stepMap = new Map<string, string>() // id antiguo de paso -> id nuevo
      if (oldSteps.length) {
        const { data: ins, error: e } = await supabase
          .from('recipe_steps')
          .insert(oldSteps.map((s) => ({ recipe_id: rid, ...pick(s, ['position', 'section', 'body', 'temperature_c', 'timer_min_seconds', 'timer_max_seconds']) })))
          .select('id,position')
        if (e) throw new Error(e.message)
        const byPos = new Map((ins ?? []).map((s) => [s.position as number, s.id as string]))
        for (const s of oldSteps) stepMap.set(s.id as string, byPos.get(s.position as number)!)
      }

      const tagRows = (tagsByRecipe.get(r.id as string) ?? []).flatMap((x) => {
        const tag = tagMap.get(x.tag_id as string)
        return tag ? [{ recipe_id: rid, tag_id: tag }] : []
      })
      if (tagRows.length) {
        const e = (await supabase.from('recipe_tags').insert(tagRows)).error
        if (e) throw new Error(e.message)
      }

      const srcRows = (srcByRecipe.get(r.id as string) ?? []).map((s) => ({ recipe_id: rid, ...pick(s, ['kind', 'url', 'original_content', 'imported_at']) }))
      if (srcRows.length) await supabase.from('recipe_sources').insert(srcRows)
      const revRows = (revByRecipe.get(r.id as string) ?? []).map((v) => ({ recipe_id: rid, ...pick(v, ['version', 'snapshot', 'created_at']) }))
      if (revRows.length) await supabase.from('recipe_revisions').insert(revRows)

      for (const img of imgsByRecipe.get(r.id as string) ?? []) {
        const bytes = entries[`photos/${fileName(img.storage_path as string)}`]
        if (!bytes) throw new Error(`falta la foto ${fileName(img.storage_path as string)} en el archivo`)
        const ext = fileName(img.storage_path as string).split('.').pop() ?? 'webp'
        const path = `${householdId}/${rid}/${crypto.randomUUID()}.${ext}`
        const type = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp'
        const up = await supabase.storage.from(BUCKET).upload(path, new Blob([bytes as BlobPart], { type }), { contentType: type })
        if (up.error) throw new Error(up.error.message)
        uploaded.push(path)
        const e = (
          await supabase.from('recipe_images').insert({
            recipe_id: rid,
            step_id: img.step_id ? (stepMap.get(img.step_id as string) ?? null) : null,
            storage_path: path,
            ...pick(img, ['position', 'is_cover', 'width', 'height', 'bytes']),
            origin: img.origin ?? 'user',
          })
        ).error
        if (e) throw new Error(e.message)
        result.photos++
      }

      recipeMap.set(r.id as string, rid)
      titleToId.set(norm(title), rid)
      result.created.push(title)
    } catch (e) {
      // No dejar una receta a medias: se borra con sus fotos.
      if (newId) await supabase.from('recipes').delete().eq('id', newId)
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded)
      result.failed.push(`${title}: ${(e as Error).message}`)
    }
  }

  // --- Variantes: se enlazan con su original (restaurada o ya existente) ---
  for (const r of t.recipes) {
    const child = recipeMap.get(r.id as string)
    if (!child || !r.parent_recipe_id) continue
    const parentTitle = oldTitleToId.get(r.parent_recipe_id as string)
    const parent = parentTitle ? titleToId.get(parentTitle) : undefined
    if (parent && parent !== child) await supabase.from('recipes').update({ parent_recipe_id: parent }).eq('id', child)
  }

  // --- Favoritas de quien restaura ---
  const favRows = t.user_favorites.flatMap((f) => {
    const rid = recipeMap.get(f.recipe_id as string)
    return rid ? [{ user_id: userId, recipe_id: rid }] : []
  })
  if (favRows.length) await supabase.from('user_favorites').upsert(favRows, { onConflict: 'user_id,recipe_id', ignoreDuplicates: true })

  return result
}
