import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import { createCatalog } from '../lib/catalog'
import { APPLIANCES, DIFFICULTY } from '../lib/labels'
import {
  emptyForm, emptyIngredient, emptyStep, newKey, qtyToText, saveRecipe,
  type FormGroup, type FormIngredient, type FormState, type FormStep,
} from '../lib/recipes'

interface UnitRow {
  code: string
}

interface LoadedRecipe {
  id: string
  version: number
  title: string
  description: string | null
  servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  difficulty: string | null
  appliances: string[]
  storage_days: number | null
  freezable: boolean | null
  storage_notes: string | null
  recipe_ingredients: {
    position: number
    section: string | null
    original_text: string | null
    display_name: string | null
    quantity_min: number | null
    quantity_max: number | null
    quantity_text: string | null
    unit: string | null
    alt_quantity: number | null
    alt_unit: string | null
    preparation: string | null
    is_optional: boolean
    ingredients: { name: string } | null
  }[]
  recipe_steps: {
    id: string
    position: number
    section: string | null
    body: string
    temperature_c: number | null
    timer_min_seconds: number | null
    timer_max_seconds: number | null
  }[]
  recipe_tags: { tags: { name: string } | null }[]
}

function toForm(r: LoadedRecipe): FormState {
  const groups: FormGroup[] = []
  for (const it of [...r.recipe_ingredients].sort((a, b) => a.position - b.position)) {
    const section = it.section ?? ''
    let g = groups[groups.length - 1]
    if (!g || g.section !== section) {
      g = { key: newKey(), section, items: [] }
      groups.push(g)
    }
    g.items.push({
      key: newKey(),
      ingredient: it.ingredients?.name ?? it.display_name ?? it.original_text ?? '',
      qty: qtyToText(it.quantity_min, it.quantity_max, it.quantity_text),
      unit: it.unit ?? '',
      preparation: it.preparation ?? '',
      optional: it.is_optional,
      alt_quantity: it.alt_quantity,
      alt_unit: it.alt_unit,
    })
  }
  return {
    title: r.title,
    description: r.description ?? '',
    servings: r.servings ?? 4,
    prep: r.prep_minutes?.toString() ?? '',
    cook: r.cook_minutes?.toString() ?? '',
    difficulty: r.difficulty ?? '',
    groups: groups.length ? groups : [{ key: newKey(), section: '', items: [emptyIngredient()] }],
    steps: [...r.recipe_steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        key: newKey(),
        id: s.id,
        section: s.section ?? '',
        text: s.body,
        temp: s.temperature_c?.toString() ?? '',
        min: s.timer_min_seconds != null ? String(s.timer_min_seconds / 60) : '',
        max: s.timer_max_seconds != null ? String(s.timer_max_seconds / 60) : '',
      })),
    tags: r.recipe_tags.flatMap((t) => (t.tags ? [t.tags.name] : [])),
    appliances: r.appliances,
    storageDays: r.storage_days?.toString() ?? '',
    freezable: r.freezable === true ? 'si' : r.freezable === false ? 'no' : '',
    storageNotes: r.storage_notes ?? '',
  }
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

export default function RecipeForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session, householdId } = useAuth()
  const [f, setF] = useState<FormState>(emptyForm)
  const [loaded, setLoaded] = useState<LoadedRecipe | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [units, setUnits] = useState<UnitRow[]>([])
  const [ingNames, setIngNames] = useState<string[]>([])
  const [tagNames, setTagNames] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('units').select('code').order('code').then(({ data }) => setUnits((data ?? []) as UnitRow[]))
    if (householdId)
      createCatalog(householdId).then((c) => {
        setIngNames(c.ingredientNames)
        setTagNames(c.tagNames)
      })
  }, [householdId])

  useEffect(() => {
    if (!id) return
    supabase
      .from('recipes')
      .select('*,recipe_ingredients(*,ingredients(name)),recipe_steps(*),recipe_tags(tags(name))')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else {
          const r = data as unknown as LoadedRecipe
          setLoaded(r)
          setF(toForm(r))
        }
        setLoading(false)
      })
  }, [id])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const setItem = (gk: string, ik: string, patch: Partial<FormIngredient>) =>
    set('groups', f.groups.map((g) => g.key !== gk ? g : { ...g, items: g.items.map((i) => (i.key === ik ? { ...i, ...patch } : i)) }))
  const setStepAt = (k: string, patch: Partial<FormStep>) =>
    set('steps', f.steps.map((s) => (s.key === k ? { ...s, ...patch } : s)))

  function addTag() {
    const t = newTag.trim().toLowerCase()
    if (t && !f.tags.includes(t)) set('tags', [...f.tags, t])
    setNewTag('')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return setError('Ponle un nombre a la receta.')
    if (!f.groups.some((g) => g.items.some((i) => i.ingredient.trim()))) return setError('Añade al menos un ingrediente.')
    if (!f.steps.some((s) => s.text.trim())) return setError('Añade al menos un paso.')
    setBusy(true)
    setError(null)
    try {
      const rid = await saveRecipe(f, {
        householdId: householdId!,
        userId: session!.user.id,
        editing: loaded ? { id: loaded.id, version: loaded.version, snapshot: loaded } : undefined,
      })
      navigate(`/receta/${rid}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (loading) return <p className="center">Cargando…</p>
  const allAppliances = [...new Set([...APPLIANCES, ...f.appliances])]
  const availableTags = tagNames.filter((t) => !f.tags.includes(t))

  return (
    <form className="recipe-form" onSubmit={submit} noValidate>
      <Link to={id ? `/receta/${id}` : '/'}>← Cancelar</Link>
      <h1>{id ? 'Editar receta' : 'Nueva receta'}</h1>

      <label className="field">
        Nombre
        <input value={f.title} onChange={(e) => set('title', e.target.value)} required />
      </label>
      <label className="field">
        Descripción (opcional)
        <textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </label>

      <div className="field">
        <span className="lbl">Raciones</span>
        <div className="servings">
          <button type="button" aria-label="Menos raciones" onClick={() => set('servings', Math.max(1, f.servings - 1))}>−</button>
          <span>{f.servings}</span>
          <button type="button" aria-label="Más raciones" onClick={() => set('servings', f.servings + 1)}>+</button>
        </div>
      </div>
      <div className="two">
        <label className="field">
          Preparación (min)
          <input inputMode="numeric" value={f.prep} onChange={(e) => set('prep', e.target.value)} />
        </label>
        <label className="field">
          Cocción (min)
          <input inputMode="numeric" value={f.cook} onChange={(e) => set('cook', e.target.value)} />
        </label>
      </div>
      <div className="field">
        <span className="lbl">Dificultad</span>
        <div className="chiprow">
          {DIFFICULTY.map((d) => (
            <Chip key={d.value} on={f.difficulty === d.value} onClick={() => set('difficulty', f.difficulty === d.value ? '' : d.value)}>
              {d.label}
            </Chip>
          ))}
        </div>
      </div>

      <h2>Ingredientes</h2>
      <p className="muted">Cantidad: «200», «0,5», «1/2», «2-3» o un texto como «al gusto».</p>
      <datalist id="ing-names">{ingNames.map((n) => <option key={n} value={n} />)}</datalist>
      {f.groups.map((g, gi) => (
        <fieldset key={g.key} className="group">
          {(gi > 0 || g.section) && (
            <label className="field">
              Sección
              <input value={g.section} placeholder="Ej.: Salsa" onChange={(e) => set('groups', f.groups.map((x) => (x.key === g.key ? { ...x, section: e.target.value } : x)))} />
            </label>
          )}
          {g.items.map((it) => (
            <div key={it.key} className="ing-edit">
              <div className="ing-main">
                <label className="field q">
                  Cantidad
                  <input value={it.qty} onChange={(e) => setItem(g.key, it.key, { qty: e.target.value })} />
                </label>
                <label className="field u">
                  Unidad
                  <select value={it.unit} onChange={(e) => setItem(g.key, it.key, { unit: e.target.value })}>
                    <option value="">—</option>
                    {units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                Ingrediente
                <input list="ing-names" value={it.ingredient} onChange={(e) => setItem(g.key, it.key, { ingredient: e.target.value })} />
              </label>
              <label className="field">
                Nota (opcional)
                <input value={it.preparation} placeholder="picada, en dados…" onChange={(e) => setItem(g.key, it.key, { preparation: e.target.value })} />
              </label>
              <div className="ing-actions">
                <Chip on={it.optional} onClick={() => setItem(g.key, it.key, { optional: !it.optional })}>opcional</Chip>
                <button type="button" className="link" onClick={() => set('groups', f.groups.map((x) => x.key === g.key ? { ...x, items: x.items.filter((i) => i.key !== it.key) } : x))}>
                  Quitar
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="add" onClick={() => set('groups', f.groups.map((x) => (x.key === g.key ? { ...x, items: [...x.items, emptyIngredient()] } : x)))}>
            + Ingrediente
          </button>
        </fieldset>
      ))}
      <button type="button" className="add" onClick={() => set('groups', [...f.groups, { key: newKey(), section: '', items: [emptyIngredient()] }])}>
        + Sección
      </button>

      <h2>Pasos</h2>
      {f.steps.map((s, i) => (
        <fieldset key={s.key} className="group">
          <legend>Paso {i + 1}</legend>
          <label className="field">
            Qué hay que hacer
            <textarea rows={3} value={s.text} onChange={(e) => setStepAt(s.key, { text: e.target.value })} />
          </label>
          <div className="three">
            <label className="field">
              Temp. (°C)
              <input inputMode="numeric" value={s.temp} onChange={(e) => setStepAt(s.key, { temp: e.target.value })} />
            </label>
            <label className="field">
              Tiempo (min)
              <input inputMode="numeric" value={s.min} onChange={(e) => setStepAt(s.key, { min: e.target.value })} />
            </label>
            <label className="field">
              Hasta (min)
              <input inputMode="numeric" value={s.max} onChange={(e) => setStepAt(s.key, { max: e.target.value })} />
            </label>
          </div>
          <label className="field">
            Sección (opcional)
            <input value={s.section} placeholder="Ej.: Salsa" onChange={(e) => setStepAt(s.key, { section: e.target.value })} />
          </label>
          <div className="ing-actions">
            <button type="button" className="link" disabled={i === 0} onClick={() => { const a = [...f.steps]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set('steps', a) }}>Subir</button>
            <button type="button" className="link" disabled={i === f.steps.length - 1} onClick={() => { const a = [...f.steps]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set('steps', a) }}>Bajar</button>
            <button type="button" className="link" onClick={() => set('steps', f.steps.filter((x) => x.key !== s.key))}>Quitar</button>
          </div>
        </fieldset>
      ))}
      <button type="button" className="add" onClick={() => set('steps', [...f.steps, emptyStep()])}>+ Paso</button>

      <h2>Etiquetas</h2>
      <div className="chiprow">
        {f.tags.map((t) => <Chip key={t} on onClick={() => set('tags', toggle(f.tags, t))}>{t} ×</Chip>)}
      </div>
      <div className="tag-add">
        <datalist id="tag-names">{availableTags.map((t) => <option key={t} value={t} />)}</datalist>
        <label className="field">
          Añadir etiqueta
          <input list="tag-names" value={newTag} onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
        </label>
        <button type="button" onClick={addTag}>Añadir</button>
      </div>

      <h2>Cocinado y conservación</h2>
      <div className="field">
        <span className="lbl">Electrodomésticos</span>
        <div className="chiprow">
          {allAppliances.map((a) => <Chip key={a} on={f.appliances.includes(a)} onClick={() => set('appliances', toggle(f.appliances, a))}>{a}</Chip>)}
        </div>
      </div>
      <label className="field">
        Días en el frigorífico
        <input inputMode="numeric" value={f.storageDays} onChange={(e) => set('storageDays', e.target.value)} />
      </label>
      <div className="field">
        <span className="lbl">¿Se puede congelar?</span>
        <div className="chiprow">
          <Chip on={f.freezable === 'si'} onClick={() => set('freezable', f.freezable === 'si' ? '' : 'si')}>sí</Chip>
          <Chip on={f.freezable === 'no'} onClick={() => set('freezable', f.freezable === 'no' ? '' : 'no')}>no</Chip>
          <Chip on={f.freezable === ''} onClick={() => set('freezable', '')}>no sé</Chip>
        </div>
      </div>
      <label className="field">
        Notas de conservación
        <textarea rows={2} value={f.storageNotes} onChange={(e) => set('storageNotes', e.target.value)} />
      </label>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="formfoot">
        <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar receta'}</button>
      </div>
    </form>
  )
}
