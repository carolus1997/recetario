import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { signedUrls, type RecipeImage } from '../lib/photos'
import { formatQuantity, needsDe, type IngredientRow } from '../lib/quantity'

interface Ing extends IngredientRow {
  id: string
  position: number
  section: string | null
  display_name: string | null
  original_text: string | null
  preparation: string | null
  is_optional: boolean
  unit: string | null
  ingredients: { name: string } | null
}
interface Step {
  id: string
  position: number
  body: string
  section: string | null
  temperature_c: number | null
  timer_min_seconds: number | null
  timer_max_seconds: number | null
}
interface Recipe {
  id: string
  title: string
  servings: number | null
  storage_days: number | null
  freezable: boolean | null
  storage_notes: string | null
  recipe_ingredients: Ing[]
  recipe_steps: Step[]
  recipe_images: RecipeImage[]
}
interface TimerState {
  total: number // segundos
  endAt: number | null // marca de tiempo si está en marcha
  left: number // segundos restantes cuando está en pausa
  done: boolean
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const stepSeconds = (s: Step) => s.timer_max_seconds ?? s.timer_min_seconds ?? null

function describeTime(s: Step): string | null {
  const a = s.timer_min_seconds
  const b = s.timer_max_seconds
  if (a && b && a !== b) return `entre ${a / 60} y ${b / 60} min`
  const x = b ?? a
  return x ? `${Math.round((x / 60) * 10) / 10} min` : null
}

interface WakeLockSentinelLike {
  release: () => Promise<void>
}

function beep(ctx: AudioContext | null) {
  if (!ctx) return
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 880
    g.gain.value = 0.2
    o.connect(g).connect(ctx.destination)
    o.start(ctx.currentTime + i * 0.4)
    o.stop(ctx.currentTime + i * 0.4 + 0.2)
  }
}

export default function CookMode() {
  const { id } = useParams()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [i, setI] = useState(0)
  const [servings, setServings] = useState<number | null>(null)
  const [sheet, setSheet] = useState(false)
  const [timers, setTimers] = useState<Record<string, TimerState>>({})
  const [now, setNow] = useState(Date.now())
  const [alarm, setAlarm] = useState<string | null>(null)
  const audio = useRef<AudioContext | null>(null)

  useEffect(() => {
    supabase
      .from('recipes')
      .select('id,title,servings,storage_days,freezable,storage_notes,recipe_ingredients(*,ingredients(name)),recipe_steps(*),recipe_images(*)')
      .eq('id', id!)
      .single()
      .then(async ({ data, error }) => {
        if (error) return setError(error.message)
        const r = data as unknown as Recipe
        r.recipe_ingredients.sort((a, b) => a.position - b.position)
        r.recipe_steps.sort((a, b) => a.position - b.position)
        setRecipe(r)
        setServings(r.servings)
        try {
          setUrls(await signedUrls(r.recipe_images.filter((x) => x.step_id).map((x) => x.storage_path)))
        } catch {
          /* sin fotos de paso */
        }
      })
  }, [id])

  // Mantener la pantalla encendida mientras se cocina (si el navegador lo permite).
  useEffect(() => {
    let lock: WakeLockSentinelLike | null = null
    const request = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
        lock = (await wl?.request('screen')) ?? null
      } catch {
        /* no disponible */
      }
    }
    void request()
    const onVisible = () => document.visibilityState === 'visible' && void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])

  // Reloj y fin de temporizadores.
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      setTimers((prev) => {
        let changed = false
        const next = { ...prev }
        for (const [k, v] of Object.entries(prev)) {
          if (v.endAt && v.endAt <= n && !v.done) {
            next[k] = { ...v, endAt: null, left: 0, done: true }
            changed = true
            navigator.vibrate?.([300, 120, 300, 120, 300])
            beep(audio.current)
            setAlarm(k)
          }
        }
        return changed ? next : prev
      })
    }, 500)
    return () => clearInterval(t)
  }, [])

  if (!recipe) return error ? <p className="error center">{error}</p> : <p className="center">Cargando…</p>

  const steps = recipe.recipe_steps
  if (steps.length === 0)
    return (
      <div className="cook">
        <p className="center">Esta receta aún no tiene pasos.</p>
        <Link className="linkbtn" to={`/receta/${recipe.id}`}>Volver</Link>
      </div>
    )

  const finished = i >= steps.length
  const step = steps[Math.min(i, steps.length - 1)]
  const secs = stepSeconds(step)
  const timer = timers[step.id]
  const remaining = (t: TimerState) => (t.endAt ? Math.max(0, Math.ceil((t.endAt - now) / 1000)) : t.left)
  const running = Object.entries(timers).filter(([, t]) => t.endAt || t.done)
  const factor = recipe.servings && servings ? servings / recipe.servings : 1

  function startTimer(s: Step, total: number) {
    if (!audio.current) {
      try {
        audio.current = new AudioContext() // se crea con un gesto del usuario
      } catch {
        /* sin sonido */
      }
    }
    setTimers((p) => {
      const cur = p[s.id]
      const left = cur && !cur.done && cur.left > 0 ? cur.left : total
      return { ...p, [s.id]: { total, endAt: Date.now() + left * 1000, left, done: false } }
    })
  }
  const pauseTimer = (s: Step) =>
    setTimers((p) => {
      const cur = p[s.id]
      if (!cur?.endAt) return p
      return { ...p, [s.id]: { ...cur, endAt: null, left: Math.max(0, Math.ceil((cur.endAt - Date.now()) / 1000)) } }
    })
  const resetTimer = (s: Step) =>
    setTimers((p) => {
      const cur = p[s.id]
      return cur ? { ...p, [s.id]: { ...cur, endAt: null, left: cur.total, done: false } } : p
    })

  const stepPics = recipe.recipe_images.filter((x) => x.step_id === step.id && urls[x.storage_path])
  const R = 52
  const C = 2 * Math.PI * R
  const ringPct = timer && timer.total > 0 ? remaining(timer) / timer.total : 1

  return (
    <div className="cook" role="dialog" aria-label={`Cocinando ${recipe.title}`}>
      <div className="cook-top">
        <Link to={`/receta/${recipe.id}`} className="link">← Salir</Link>
        <strong>{recipe.title}</strong>
        <button type="button" className="chip" onClick={() => setSheet(true)}>Ingredientes</button>
      </div>

      {alarm && (
        <div className="alarm" role="alert">
          <span>¡Tiempo! {recipe.recipe_steps.find((s) => s.id === alarm) ? `Paso ${recipe.recipe_steps.find((s) => s.id === alarm)!.position + 1}` : ''}</span>
          <button type="button" onClick={() => setAlarm(null)}>Vale</button>
        </div>
      )}

      {running.length > 0 && (
        <div className="pills" aria-label="Temporizadores">
          {running.map(([k, t]) => {
            const idx = steps.findIndex((s) => s.id === k)
            return (
              <button key={k} type="button" className={`pill${t.done ? ' done' : ''}`} onClick={() => setI(idx)}>
                Paso {idx + 1} · {t.done ? '¡listo!' : mmss(remaining(t))}
              </button>
            )
          })}
        </div>
      )}

      {finished ? (
        <div className="cook-body">
          <h1>¡A la mesa!</h1>
          <p className="muted">Has terminado «{recipe.title}».</p>
          {(recipe.storage_days != null || recipe.freezable != null || recipe.storage_notes) && (
            <aside className="sticky">
              <h3>Conservación</h3>
              <p>
                {recipe.storage_days != null && `${recipe.storage_days} días en frigorífico. `}
                {recipe.freezable === true && 'Apto para congelar. '}
                {recipe.freezable === false && 'No congelar. '}
                {recipe.storage_notes}
              </p>
            </aside>
          )}
          <div className="row">
            <Link className="linkbtn" to={`/receta/${recipe.id}`}>Volver a la receta</Link>
            <button type="button" className="alt" onClick={() => { setI(0); setTimers({}) }}>Cocinar de nuevo</button>
          </div>
        </div>
      ) : (
        <div className="cook-body">
          <div className="cook-head">
            <span className="bigno">{i + 1}</span>
            <span>
              <span className="caps">Paso {i + 1} de {steps.length}</span>
              {step.section && <span className="muted"> · {step.section}</span>}
              <br />
              <span className="muted">
                {[describeTime(step), step.temperature_c != null && `${step.temperature_c} °C`].filter(Boolean).join(' · ')}
              </span>
            </span>
          </div>
          <div className="dots" aria-hidden="true">
            {steps.map((s, k) => <i key={s.id} className={k <= i ? 'on' : ''} />)}
          </div>
          <p className="cook-step">{step.body}</p>

          {stepPics.length > 0 && (
            <div className="cook-pics">
              {stepPics.slice(0, 3).map((p) => <img key={p.id} src={urls[p.storage_path]} alt="" />)}
            </div>
          )}

          {secs != null && (
            <div className="timer">
              <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={timer ? `Quedan ${mmss(remaining(timer))}` : `Temporizador de ${mmss(secs)}`}>
                <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(43,42,51,.15)" strokeWidth="8" />
                <circle cx="60" cy="60" r={R} fill="none" stroke={timer?.done ? 'var(--tomato)' : 'var(--olive)'} strokeWidth="8"
                  strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ringPct)} transform="rotate(-90 60 60)" />
                <text x="60" y="68" textAnchor="middle" className="ring-t">{mmss(timer ? remaining(timer) : secs)}</text>
              </svg>
              <div className="timer-btns">
                {timer?.endAt ? (
                  <button type="button" className="alt" onClick={() => pauseTimer(step)}>Pausar</button>
                ) : (
                  <button type="button" onClick={() => startTimer(step, secs)}>
                    {timer && !timer.done && timer.left < timer.total && timer.left > 0 ? 'Reanudar' : 'Empezar'}
                  </button>
                )}
                {timer && <button type="button" className="alt" onClick={() => resetTimer(step)}>Reiniciar</button>}
              </div>
            </div>
          )}
        </div>
      )}

      {!finished && (
        <div className="cook-foot">
          <button type="button" className="alt" disabled={i === 0} onClick={() => setI(i - 1)}>Atrás</button>
          <button type="button" onClick={() => setI(i + 1)}>{i === steps.length - 1 ? 'Terminar' : 'Siguiente paso'}</button>
        </div>
      )}

      {sheet && (
        <div className="sheet-wrap" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-label="Ingredientes" onClick={(e) => e.stopPropagation()}>
            <h2>Ingredientes</h2>
            {recipe.servings && servings && (
              <div className="servings">
                <button type="button" aria-label="Menos raciones" onClick={() => setServings(Math.max(1, servings - 1))}>−</button>
                <span>{servings} raciones</span>
                <button type="button" aria-label="Más raciones" onClick={() => setServings(servings + 1)}>+</button>
              </div>
            )}
            <ul className="ingredients">
              {recipe.recipe_ingredients.map((it) => {
                const qty = formatQuantity(it, factor)
                const name = it.display_name ?? it.ingredients?.name ?? it.original_text ?? ''
                return (
                  <li key={it.id}>
                    {qty}{qty && needsDe(it.unit) ? ' de' : ''} {name}
                    {it.preparation && `, ${it.preparation}`}
                    {it.is_optional && <em> (opcional)</em>}
                  </li>
                )
              })}
            </ul>
            <button type="button" onClick={() => setSheet(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}
