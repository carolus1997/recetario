// Referencia a un <symbol> del sprite. "ill" = ilustración con trazo de cera; "ln" = icono de línea.
export function Ill({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg className={`ill ${className}`} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

export function Ln({ name, className = '' }: { name: string; className?: string }) {
  return (
    <svg className={`ln ${className}`} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}

const KEYWORDS: [RegExp, string][] = [
  [/tomate/, 'tomato'],
  [/cebolla/, 'onion'],
  [/lim[oó]n/, 'lemon'],
  [/espinaca/, 'spinach'],
  [/feta|queso|mozzarella/, 'feta'],
  [/aceite/, 'oil'],
  [/garbanzo|legumbre|lenteja/, 'chickpeas'],
]

// Elige la ilustración según los ingredientes de la receta (la primera que coincida).
export function illustrationFor(names: string[]): string {
  for (const [re, symbol] of KEYWORDS) if (names.some((n) => re.test(n.toLowerCase()))) return symbol
  return 'spoon'
}
