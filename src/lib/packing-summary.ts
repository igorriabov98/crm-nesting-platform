export const DOCUMENT_WEIGHT_FACTOR = 1.05
export const PACKING_GROSS_EXTRA_KG = 200

type PackingSummaryGroup = {
  packing_type_en: string
  packing_type_ua?: string | null
  places: number
}

export function documentUnitWeight(weight: number) {
  return weight * DOCUMENT_WEIGHT_FACTOR
}

export function documentLineNetWeight(weight: number, quantity: number) {
  return documentUnitWeight(weight) * quantity
}

export function documentGrossWeight(netWeight: number) {
  return netWeight + PACKING_GROSS_EXTRA_KG
}

export function totalPackingPlaces(groups: PackingSummaryGroup[]) {
  return groups.reduce((sum, group) => sum + group.places, 0)
}

function pluralizeEn(type: string, count: number) {
  if (!type) return count === 1 ? 'place' : 'places'
  if (count === 1 || type.endsWith('s')) return type
  if (type.endsWith('y')) return `${type.slice(0, -1)}ies`
  return `${type}s`
}

function boxLabel(count: number, language: 'en' | 'ua') {
  if (language === 'en') return count === 1 ? `${count} box` : `${count} boxes`
  if (count % 10 === 1 && count % 100 !== 11) return `${count} коробка`
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} коробки`
  return `${count} коробок`
}

function joinSummaryParts(parts: string[], conjunction: string) {
  return parts.join(` ${conjunction} `)
}

export function packingSummaryFromGroups(
  groups: PackingSummaryGroup[],
  language: 'en' | 'ua',
  boxesCount = 0,
) {
  const totals = new Map<string, number>()
  for (const group of groups) {
    const type = language === 'en'
      ? group.packing_type_en
      : group.packing_type_ua || group.packing_type_en
    if (!type) continue
    totals.set(type, (totals.get(type) || 0) + group.places)
  }

  const parts = Array.from(totals.entries()).map(([type, count]) => (
    language === 'en' ? `${count} ${pluralizeEn(type, count)}` : `${count} ${type}`
  ))

  if (boxesCount > 0) parts.push(boxLabel(boxesCount, language))

  return joinSummaryParts(parts, language === 'en' ? 'and' : 'та')
}
