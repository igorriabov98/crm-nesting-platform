import type { MaterialCategory } from '@/lib/types'

type DraftFields = Record<string, string | boolean | undefined>

export function requiresPhysicalPieceLength(
  category: MaterialCategory,
  pipeType: string | null | undefined,
) {
  return category === 'circle'
    || category === 'knives'
    || (category === 'pipe' && Boolean(pipeType) && pipeType !== 'wire')
}

export function newMaterialReceiptPieceLength(
  category: MaterialCategory,
  fields: DraftFields,
) {
  if (!requiresPhysicalPieceLength(category, String(fields.pipe_type || ''))) return ''
  return String(fields.piece_length_mm || '').trim()
}

export function validateNewMaterialPieceLength(
  category: MaterialCategory,
  fields: DraftFields,
) {
  if (!requiresPhysicalPieceLength(category, String(fields.pipe_type || ''))) return null
  const parsed = Number(String(fields.piece_length_mm || '').trim().replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? null : 'Введите длину материала'
}

export function appendLongStockPieceLengthToSummary(
  summary: string,
  category: MaterialCategory,
  pipeType: string | null | undefined,
  pieceLengthLabel: string,
) {
  if (!requiresPhysicalPieceLength(category, pipeType)) return summary

  const lengthSummary = `Длина: ${pieceLengthLabel}`
  return summary && summary !== '—' ? `${summary}, ${lengthSummary}` : lengthSummary
}
