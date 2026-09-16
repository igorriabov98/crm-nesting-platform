type RowWithSteelType = Record<string, unknown> & {
  steel_types?: { name?: unknown } | null
}

type SupplyOrderCharacteristic = {
  label: string
  value: string
}

export function getRequestItemSelect(table: string) {
  return STEEL_TYPE_TABLES.has(table)
    ? '*, materials(id, name), steel_types(name)'
    : '*, materials(id, name)'
}

const STEEL_TYPE_TABLES = new Set([
  'request_sheet_metal',
  'request_circle',
  'request_pipe',
  'request_knives',
])

export function withRequestSteelType(
  table: string,
  row: RowWithSteelType,
  characteristics: SupplyOrderCharacteristic[]
) {
  if (!STEEL_TYPE_TABLES.has(table)) return characteristics

  const steelType = typeof row.steel_types?.name === 'string'
    ? row.steel_types.name.trim()
    : ''
  if (!steelType) return characteristics
  if (characteristics.some((part) => part.label === 'Тип стали' && part.value === steelType)) {
    return characteristics
  }

  const pipeTypeIndex = characteristics.findIndex((part) => part.label === 'Тип трубы')
  const gradeIndex = characteristics.findIndex((part) => part.label === 'Марка')
  const insertAt = pipeTypeIndex >= 0 ? pipeTypeIndex + 1 : gradeIndex >= 0 ? gradeIndex + 1 : 0
  return [
    ...characteristics.slice(0, insertAt),
    { label: 'Тип стали', value: steelType },
    ...characteristics.slice(insertAt),
  ]
}

/** @deprecated Use withRequestSteelType. */
export const withPipeSteelGrade = withRequestSteelType
