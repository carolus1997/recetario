const PLURAL: Record<string, string> = {
  diente: 'dientes', hoja: 'hojas', lomo: 'lomos', pizca: 'pizcas',
  cucharada: 'cucharadas', cucharadita: 'cucharaditas', taza: 'tazas',
}
const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }

export function formatNumber(n: number): string {
  const whole = Math.floor(n)
  const frac = (n - whole).toFixed(2).replace(/0$/, '')
  const f = FRACTIONS[frac === '0.' ? '0' : frac]
  if (f) return whole > 0 ? `${whole} ${f}` : f
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

export interface IngredientRow {
  quantity_min: number | null
  quantity_max: number | null
  unit: string | null
  quantity_text: string | null
  alt_quantity: number | null
  alt_unit: string | null
}

// Escala solo si hay cantidad numérica; "al gusto" y similares no se tocan.
export function formatQuantity(row: IngredientRow, factor: number): string {
  if (row.quantity_min == null) return row.quantity_text ?? ''
  const min = row.quantity_min * factor
  const max = row.quantity_max != null ? row.quantity_max * factor : null
  const amount = max != null && max !== min ? `${formatNumber(min)}-${formatNumber(max)}` : formatNumber(min)
  const plural = min > 1
  let unit = ''
  if (row.unit && row.unit !== 'unidad') unit = plural ? (PLURAL[row.unit] ?? row.unit) : row.unit
  const alt = row.alt_quantity != null && row.alt_unit
    ? ` (≈ ${formatNumber(row.alt_quantity * factor)} ${row.alt_unit})` : ''
  return [amount, unit].filter(Boolean).join(' ') + alt
}

// "600 g de pechuga", "1 cebolla", "2 dientes de ajo"
export function needsDe(unit: string | null): boolean {
  return !!unit && unit !== 'unidad'
}
