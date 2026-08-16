export const KNIFE_BEVEL_OPTIONS = [
  { value: 1, label: '1 скос' },
  { value: 2, label: '2 скоса' },
] as const

export type KnifeBevelCount = typeof KNIFE_BEVEL_OPTIONS[number]['value']

export function parseKnifeBevelCount(value: unknown): KnifeBevelCount | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return parsed === 1 || parsed === 2 ? parsed : null
}

export function requireKnifeBevelCount(value: unknown): KnifeBevelCount {
  const parsed = parseKnifeBevelCount(value)
  if (parsed === null) throw new Error('Выберите скос ножа: 1 или 2')
  return parsed
}

export function knifeBevelLabel(value: unknown) {
  const parsed = parseKnifeBevelCount(value)
  return KNIFE_BEVEL_OPTIONS.find((option) => option.value === parsed)?.label ?? null
}
