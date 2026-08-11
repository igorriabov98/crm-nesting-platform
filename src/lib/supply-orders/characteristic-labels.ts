import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'

export function formatSupplyOrderCharacteristicValue(
  table: string,
  field: string,
  value: unknown,
) {
  if (table !== 'request_pipe' || field !== 'pipe_type') return null
  const key = String(value ?? '').trim()
  if (!key) return null
  return PIPE_SUBTYPE_LABELS[key] || 'Не указан'
}
