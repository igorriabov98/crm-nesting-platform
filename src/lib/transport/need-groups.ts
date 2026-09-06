export type TransportNeedReference = {
  source: string
  id: string
  key: string
}

export type GroupableTransportItemDetail = {
  id: string
  logicalItemKey: string
  title: string
  description: string | null
  quantityLabel: string | null
  quantity: number | null
  requiredQuantity: number | null
  excessQuantity: number | null
  unit: string | null
  weightKg: number | null
  pieceLengthMm: number | null
  pieceCount: number | null
  machineLabel: string | null
  characteristics: Array<{ label: string; value: string }>
}

export type GroupableTransportNeed = {
  key: string
  positionKey: string
  id: string
  source: string
  kind: 'materials' | 'detailing' | 'outsourcing'
  title: string
  subtitle: string
  sourcePointKey: string
  sourcePointLabel: string
  sourcePointCity: string | null
  sourcePointAddress: string | null
  destinationPointKey: string
  destinationPointLabel: string
  destinationPointCity: string | null
  destinationPointAddress: string | null
  neededDate: string | null
  itemLabels: string[]
  itemDetails: GroupableTransportItemDetail[]
  volumeLabel: string | null
  weightKg: number | null
  selectable: boolean
  unavailableReason: string | null
}

export type TransportNeedPosition<TNeed extends GroupableTransportNeed = GroupableTransportNeed> = {
  key: string
  title: string
  subtitle: string
  neededDate: string | null
  volumeLabel: string | null
  weightKg: number | null
  weightComplete: boolean
  selectable: boolean
  unavailableReason: string | null
  itemDetails: GroupableTransportItemDetail[]
  references: TransportNeedReference[]
  needs: TNeed[]
}

export type TransportNeedGroup<TNeed extends GroupableTransportNeed = GroupableTransportNeed> = {
  key: string
  kind: GroupableTransportNeed['kind']
  title: string
  subtitle: string
  sourcePointKey: string
  sourcePointLabel: string
  sourcePointCity: string | null
  sourcePointAddress: string | null
  destinationPointKey: string
  destinationPointLabel: string
  destinationPointCity: string | null
  destinationPointAddress: string | null
  neededDate: string | null
  itemLabels: string[]
  itemDetails: GroupableTransportItemDetail[]
  volumeLabel: string
  weightKg: number | null
  weightComplete: boolean
  selectable: boolean
  unavailableReason: string | null
  positions: TransportNeedPosition<TNeed>[]
  needs: TNeed[]
}

function numberLabel(value: number, maximumFractionDigits = 3) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value)
}

export function formatTransportCarriedQuantity(input: {
  quantity: number | null
  unit: string | null
  pieceLengthMm: number | null
  pieceCount: number | null
}) {
  const { quantity, unit, pieceLengthMm, pieceCount } = input
  const normalizedUnit = unit?.trim().toLocaleLowerCase('ru').replace(/\./g, '') || ''
  const isLengthUnit = normalizedUnit === 'мм' || normalizedUnit === 'mm'
  const hasWholePieces = pieceLengthMm !== null
    && pieceCount !== null
    && Number.isFinite(pieceLengthMm)
    && Number.isInteger(pieceCount)
    && pieceLengthMm > 0
    && pieceCount > 0
  const quantityMatchesPieces = quantity !== null
    && hasWholePieces
    && Math.abs(quantity - pieceLengthMm * pieceCount) < 0.000001

  if (isLengthUnit && quantityMatchesPieces) {
    return `${numberLabel(pieceCount, 0)} шт. × ${numberLabel(pieceLengthMm, 0)} мм`
  }
  return quantity !== null && unit ? `${numberLabel(quantity)} ${unit}` : null
}

export function hasCompleteTransportPositionSelection<TNeed extends GroupableTransportNeed>(
  availableNeeds: TNeed[],
  selectedNeeds: TNeed[],
) {
  const selectedKeys = new Set(selectedNeeds.map((need) => need.key))
  const selectedPositionKeys = new Set(selectedNeeds.map((need) => need.positionKey))
  return availableNeeds.every((need) => (
    !selectedPositionKeys.has(need.positionKey) || selectedKeys.has(need.key)
  ))
}

function sumNullable(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return known.length === values.length
    ? known.reduce((sum, value) => sum + value, 0)
    : null
}

function sumKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null
}

function mergedDetail(details: GroupableTransportItemDetail[]) {
  if (new Set(details.map((detail) => detail.logicalItemKey)).size !== 1) {
    return details
  }

  const first = details[0]
  const quantity = sumNullable(details.map((detail) => detail.quantity))
  const requiredQuantity = sumNullable(details.map((detail) => detail.requiredQuantity))
  const excessQuantity = sumNullable(details.map((detail) => detail.excessQuantity))
  const weightKg = sumNullable(details.map((detail) => detail.weightKg))
  const unit = new Set(details.map((detail) => detail.unit).filter(Boolean)).size === 1 ? first.unit : null
  const knownPieceLengths = details
    .map((detail) => detail.pieceLengthMm)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
  const pieceLengthMm = knownPieceLengths.length === details.length && new Set(knownPieceLengths).size === 1
    ? knownPieceLengths[0]
    : null
  const pieceCount = sumNullable(details.map((detail) => detail.pieceCount))
  const quantityLabel = formatTransportCarriedQuantity({ quantity, unit, pieceLengthMm, pieceCount })
    || first.quantityLabel

  return [{
    ...first,
    id: first.logicalItemKey,
    quantity,
    requiredQuantity,
    excessQuantity,
    weightKg,
    unit,
    pieceLengthMm,
    pieceCount,
    quantityLabel,
  }]
}

function positionFromNeeds<TNeed extends GroupableTransportNeed>(needs: TNeed[]): TransportNeedPosition<TNeed> {
  const first = needs[0]
  const details = mergedDetail(needs.flatMap((need) => need.itemDetails))
  const weightKg = sumNullable(needs.map((need) => need.weightKg))
  const machineLabels = Array.from(new Set(
    details.map((detail) => detail.machineLabel).filter((label): label is string => Boolean(label)),
  ))
  const amountLabel = details.length === 1 ? details[0].quantityLabel : `${details.length} поз.`
  const normalizedUnit = details.length === 1 ? details[0].unit?.trim().toLocaleLowerCase('ru').replace(/\./g, '') : null
  const volumeLabel = [
    amountLabel,
    weightKg !== null && !['кг', 'kg'].includes(normalizedUnit || '') ? `${numberLabel(weightKg)} кг` : null,
  ].filter(Boolean).join(' · ')
  return {
    key: first.positionKey,
    title: details.length === 1 ? details[0].title : first.title,
    subtitle: machineLabels.join(', ') || first.subtitle,
    neededDate: first.neededDate,
    volumeLabel,
    weightKg,
    weightComplete: needs.every((need) => need.weightKg !== null),
    selectable: needs.every((need) => need.selectable),
    unavailableReason: needs.find((need) => need.unavailableReason)?.unavailableReason || null,
    itemDetails: details,
    references: needs.map((need) => ({ source: need.source, id: need.id, key: need.key })),
    needs,
  }
}

function groupKey(need: GroupableTransportNeed) {
  if (need.source !== 'supply_schedule') return `need:${need.key}`
  return [
    'supply',
    need.sourcePointKey,
    need.destinationPointKey,
    need.neededDate || 'no-date',
  ].join('|')
}

export function groupTransportNeeds<TNeed extends GroupableTransportNeed>(needs: TNeed[]): TransportNeedGroup<TNeed>[] {
  const grouped = new Map<string, TNeed[]>()
  for (const need of needs) {
    const key = groupKey(need)
    grouped.set(key, [...(grouped.get(key) || []), need])
  }

  return Array.from(grouped, ([key, groupedNeeds]) => {
    const first = groupedNeeds[0]
    const positionsByKey = new Map<string, TNeed[]>()
    for (const need of groupedNeeds) {
      positionsByKey.set(need.positionKey, [...(positionsByKey.get(need.positionKey) || []), need])
    }
    const positions = Array.from(positionsByKey.values(), positionFromNeeds)
    const itemDetails = positions.flatMap((position) => position.itemDetails)
    const knownWeightKg = sumKnown(positions.map((position) => position.weightKg))
    const weightComplete = positions.every((position) => position.weightComplete)
    const isSupplyGroup = first.source === 'supply_schedule'
    const machines = Array.from(new Set(
      itemDetails.map((detail) => detail.machineLabel).filter((label): label is string => Boolean(label)),
    ))
    const volumeLabel = [
      `${positions.length} поз.`,
      knownWeightKg !== null
        ? `${weightComplete ? '' : 'известно '}${numberLabel(knownWeightKg)} кг`
        : null,
    ].filter(Boolean).join(' · ')

    return {
      key,
      kind: first.kind,
      title: isSupplyGroup ? `Поставка от ${first.subtitle}` : first.title,
      subtitle: isSupplyGroup ? machines.join(', ') || 'Материалы' : first.subtitle,
      sourcePointKey: first.sourcePointKey,
      sourcePointLabel: first.sourcePointLabel,
      sourcePointCity: first.sourcePointCity,
      sourcePointAddress: first.sourcePointAddress,
      destinationPointKey: first.destinationPointKey,
      destinationPointLabel: first.destinationPointLabel,
      destinationPointCity: first.destinationPointCity,
      destinationPointAddress: first.destinationPointAddress,
      neededDate: first.neededDate,
      itemLabels: positions.map((position) => position.title),
      itemDetails,
      volumeLabel,
      weightKg: knownWeightKg,
      weightComplete,
      selectable: positions.some((position) => position.selectable),
      unavailableReason: positions.find((position) => position.unavailableReason)?.unavailableReason || null,
      positions,
      needs: groupedNeeds,
    }
  }).sort((left, right) => (
    (left.neededDate || '9999-12-31').localeCompare(right.neededDate || '9999-12-31')
    || left.sourcePointLabel.localeCompare(right.sourcePointLabel, 'ru')
  ))
}
