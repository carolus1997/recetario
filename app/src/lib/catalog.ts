import { supabase } from './supabase'

export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

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

// "garbanzos cocidos" -> estado cocido, alimento base "garbanzo" (heurística simple)
function parseState(name: string): { state: string | null; base: string | null } {
  const m = name.match(/^(.+?)\s+cocid[oa]s?$/)
  if (!m) return { state: null, base: null }
  return { state: 'cocido', base: m[1].replace(/s$/, '') }
}

// Catálogo de ingredientes y etiquetas del hogar: busca por nombre o alias y crea lo que falte.
export async function createCatalog(householdId: string) {
  const ingMap = new Map<string, string>()
  const { data: ings } = await supabase.from('ingredients').select('id,name').eq('household_id', householdId)
  ings?.forEach((i) => ingMap.set(norm(i.name), i.id))
  const { data: aliases } = await supabase
    .from('ingredient_aliases')
    .select('ingredient_id,alias')
    .eq('household_id', householdId)
  aliases?.forEach((a) => ingMap.set(norm(a.alias), a.ingredient_id))

  const tagMap = new Map<string, string>()
  const { data: tags } = await supabase.from('tags').select('id,name').eq('household_id', householdId)
  tags?.forEach((t) => tagMap.set(norm(t.name), t.id))

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

  return {
    ingredientId,
    tagId,
    ingredientNames: [...ingMap.keys()].sort(),
    tagNames: [...tagMap.keys()].sort(),
  }
}
