import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import { knifeBevelCharacteristicLabel } from '@/lib/materials/knife-bevel'

export function formatSupplyOrderCharacteristicValue(
  table: string,
  field: string,
  value: unknown,
) {
  if (table === 'request_pipe' && field === 'pipe_type') {
    const key = String(value ?? '').trim()
    if (!key) return null
    return PIPE_SUBTYPE_LABELS[key] || 'Не указан'
  }
  if (table === 'request_knives' && field === 'knife_bevel_count') {
    return knifeBevelCharacteristicLabel(value)
  }
  return null
}
