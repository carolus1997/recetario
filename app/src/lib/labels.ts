export const DIFFICULTY: { value: string; label: string }[] = [
  { value: 'facil', label: 'fácil' },
  { value: 'media', label: 'media' },
  { value: 'dificil', label: 'difícil' },
]

export const difficultyLabel = (v: string | null) => DIFFICULTY.find((d) => d.value === v)?.label ?? v ?? ''

export const APPLIANCES = ['horno', 'airfryer', 'microondas', 'olla', 'olla a presión', 'sartén', 'batidora']
