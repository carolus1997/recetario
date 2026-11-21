import { useMemo, useState } from 'react'
import type { CardRecipe } from './RecipeCard'
import { DIFFICULTY } from '../lib/labels'
import { KIND_LABEL, KIND_ORDER, emptyFilters, matches, type Filters } from '../lib/filters'

interface Props {
  recipes: CardRecipe[]
  favs: Set<string>
  kinds: Record<string, string>
  initial: Filters
  showFavs: boolean // en la pestaña Favoritas no tiene sentido
  onApply: (f: Filters) => void
  onClose: () => void
}

const TIMES = [15, 30, 45, 60]
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

export default function FilterSheet({ recipes, favs, kinds, initial, showFavs, onApply, onClose }: Props) {
  const [f, setF] = useState<Filters>(initial)

  const tagsByKind = useMemo(() => {
    const names = [...new Set(recipes.flatMap((r) => r.tags))].sort()
    const groups = new Map<string, string[]>()
    for (const n of names) {
      const k = kinds[n] ?? 'otro'
      groups.set(k, [...(groups.get(k) ?? []), n])
    }
    return KIND_ORDER.flatMap((k) => (groups.has(k) ? [[k, groups.get(k)!] as const] : []))
  }, [recipes, kinds])
  const appliances = useMemo(() => [...new Set(recipes.flatMap((r) => r.appliances))].sort(), [recipes])
  const count = useMemo(() => recipes.filter((r) => matches(r, f, favs, kinds)).length, [recipes, f, favs, kinds])

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet filter-sheet" role="dialog" aria-modal="true" aria-label="Filtros" onClick={(e) => e.stopPropagation()}>
        <h2>Filtros</h2>

        {tagsByKind.map(([kind, names]) => (
          <div key={kind} className="field">
            <span className="lbl">{KIND_LABEL[kind] ?? kind}</span>
            <div className="chiprow">
              {names.map((n) => (
                <Chip key={n} on={f.tags.includes(n)} onClick={() => setF({ ...f, tags: toggle(f.tags, n) })}>{n}</Chip>
              ))}
            </div>
          </div>
        ))}

        <div className="field">
          <span className="lbl">Dificultad</span>
          <div className="chiprow">
            {DIFFICULTY.map((d) => (
              <Chip key={d.value} on={f.difficulty.includes(d.value)} onClick={() => setF({ ...f, difficulty: toggle(f.difficulty, d.value) })}>{d.label}</Chip>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="lbl">Tiempo total</span>
          <div className="chiprow">
            {TIMES.map((t) => (
              <Chip key={t} on={f.maxMinutes === t} onClick={() => setF({ ...f, maxMinutes: f.maxMinutes === t ? null : t })}>hasta {t} min</Chip>
            ))}
          </div>
        </div>

        {appliances.length > 0 && (
          <div className="field">
            <span className="lbl">Electrodomésticos</span>
            <div className="chiprow">
              {appliances.map((a) => (
                <Chip key={a} on={f.appliances.includes(a)} onClick={() => setF({ ...f, appliances: toggle(f.appliances, a) })}>{a}</Chip>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="lbl">Otros</span>
          <div className="chiprow">
            <Chip on={f.freezable} onClick={() => setF({ ...f, freezable: !f.freezable })}>se congela</Chip>
            {showFavs && <Chip on={f.onlyFavs} onClick={() => setF({ ...f, onlyFavs: !f.onlyFavs })}>solo favoritas</Chip>}
          </div>
        </div>

        <p className="muted" aria-live="polite">
          {count} {count === 1 ? 'receta coincide' : 'recetas coinciden'}
        </p>
        <div className="row">
          <button type="button" className="alt" onClick={() => setF({ ...emptyFilters })}>Limpiar</button>
          <button type="button" onClick={() => onApply(f)}>Ver {count}</button>
        </div>
      </div>
    </div>
  )
}
