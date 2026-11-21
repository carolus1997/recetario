import type { CardRecipe } from '../components/RecipeCard'

export interface Filters {
  tags: string[]
  difficulty: string[]
  maxMinutes: number | null
  appliances: string[]
  freezable: boolean
  onlyFavs: boolean
}

export const emptyFilters: Filters = {
  tags: [], difficulty: [], maxMinutes: null, appliances: [], freezable: false, onlyFavs: false,
}

export const KIND_LABEL: Record<string, string> = {
  momento: 'Momento', dieta: 'Dieta', cocina: 'Cocina', tecnica: 'Técnica', otro: 'Otras',
}
export const KIND_ORDER = ['momento', 'dieta', 'cocina', 'tecnica', 'otro']

export function activeCount(f: Filters): number {
  return f.tags.length + f.difficulty.length + f.appliances.length + (f.maxMinutes != null ? 1 : 0) +
    (f.freezable ? 1 : 0) + (f.onlyFavs ? 1 : 0)
}

// Dentro de un mismo tipo basta con cumplir uno (O); entre tipos distintos tienen que cumplirse todos (Y).
export function matches(r: CardRecipe, f: Filters, favs: Set<string>, kinds: Record<string, string>): boolean {
  if (f.onlyFavs && !favs.has(r.id)) return false
  const byKind = new Map<string, string[]>()
  for (const t of f.tags) {
    const k = kinds[t] ?? 'otro'
    byKind.set(k, [...(byKind.get(k) ?? []), t])
  }
  for (const list of byKind.values()) if (!list.some((t) => r.tags.includes(t))) return false
  if (f.difficulty.length && !(r.difficulty && f.difficulty.includes(r.difficulty))) return false
  if (f.maxMinutes != null) {
    const total = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
    if (total === 0 || total > f.maxMinutes) return false
  }
  if (f.appliances.length && !f.appliances.some((a) => r.appliances.includes(a))) return false
  if (f.freezable && r.freezable !== true) return false
  return true
}
