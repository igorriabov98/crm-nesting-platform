type PipeRowWithSteelType = Record<string, unknown> & {
  steel_types?: { name?: unknown } | null
}

type SupplyOrderCharacteristic = {
  label: string
  value: string
}

export function getRequestItemSelect(table: string) {
  return table === 'request_pipe'
    ? '*, materials(id, name), steel_types(name)'
    : '*, materials(id, name)'
}

export function withPipeSteelGrade(
  table: string,
  row: PipeRowWithSteelType,
  characteristics: SupplyOrderCharacteristic[]
) {
  if (table !== 'request_pipe') return characteristics

  const steelGrade = typeof row.steel_types?.name === 'string'
    ? row.steel_types.name.trim()
    : ''
  if (!steelGrade) return characteristics

  const pipeTypeIndex = characteristics.findIndex((part) => part.label === 'Тип трубы')
  const insertAt = pipeTypeIndex >= 0 ? pipeTypeIndex + 1 : 0
  return [
    ...characteristics.slice(0, insertAt),
    { label: 'Марка', value: steelGrade },
    ...characteristics.slice(insertAt),
  ]
}
