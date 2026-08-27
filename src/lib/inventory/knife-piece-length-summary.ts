import type { MaterialCategory } from '@/lib/types'

export function appendKnifePieceLengthToSummary(
  summary: string,
  category: MaterialCategory,
  pieceLengthLabel: string,
) {
  if (category !== 'knives') return summary

  const lengthSummary = `Длина: ${pieceLengthLabel}`
  return summary && summary !== '—' ? `${summary}, ${lengthSummary}` : lengthSummary
}
