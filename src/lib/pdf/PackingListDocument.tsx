import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type { DocumentData, DocumentItem, DocumentPackingGroup } from '@/lib/actions/document-generation'
import { PdfSignatureStampOverlay } from './components'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'
import { formatDate, formatQuantity, formatWeight, groupItemsByHsCode, packingSummary } from './format'

registerPdfFonts()

const TABLE_WIDTH = 490.8
const TOP_LEFT_WIDTH = 333
const TOP_RIGHT_WIDTH = TABLE_WIDTH - TOP_LEFT_WIDTH
const ITEM_ROW_HEIGHT = 22.6
const COLS = {
  no: 28,
  item: 224.8,
  measurement: 49,
  quantity: 34,
  netWeight: 42.7,
  packingType: 53,
  places: 59.3,
}
const LEFT_TABLE_WIDTH = COLS.no + COLS.item + COLS.measurement + COLS.quantity + COLS.netWeight

type NumberedItem = {
  item: DocumentItem
  number: number
}

type ItemRun = {
  key: string
  items: NumberedItem[]
  group: DocumentPackingGroup | null
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 70,
    paddingRight: 51,
    paddingBottom: 42,
    paddingLeft: 51,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 5.8,
    lineHeight: 1.12,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  bold: {
    fontWeight: 'bold',
  },
  topBlock: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    borderTopWidth: 0.7,
    borderLeftWidth: 0.7,
    borderColor: '#111111',
  },
  row: {
    flexDirection: 'row',
  },
  topCell: {
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
    paddingTop: 2.4,
    paddingRight: 2.8,
    paddingBottom: 2.4,
    paddingLeft: 2.8,
  },
  topTitleRow: {
    minHeight: 26,
  },
  partyRow: {
    minHeight: 35,
  },
  recipientRow: {
    minHeight: 56,
  },
  topText: {
    fontSize: 5.7,
    lineHeight: 1.12,
  },
  topTextBold: {
    fontSize: 5.7,
    lineHeight: 1.12,
    fontWeight: 'bold',
  },
  rightCenteredCell: {
    justifyContent: 'center',
  },
  deliveryPart: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 3,
    paddingRight: 3,
  },
  countryPart: {
    minHeight: 20,
    justifyContent: 'center',
    paddingLeft: 3,
    paddingRight: 3,
    borderTopWidth: 0.7,
    borderColor: '#111111',
  },
  table: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    borderLeftWidth: 0.7,
    borderColor: '#111111',
  },
  headerRow: {
    flexDirection: 'row',
    height: 31,
  },
  hsRow: {
    flexDirection: 'row',
    minHeight: 16.5,
  },
  itemRun: {
    flexDirection: 'row',
  },
  itemRow: {
    flexDirection: 'row',
    height: ITEM_ROW_HEIGHT,
  },
  cell: {
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
    paddingTop: 2,
    paddingRight: 2.4,
    paddingBottom: 2,
    paddingLeft: 2.4,
  },
  centerCell: {
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
  },
  headerCell: {
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
  },
  headerText: {
    fontSize: 5.6,
    fontWeight: 'bold',
    lineHeight: 1.08,
    textAlign: 'center',
  },
  hsText: {
    fontSize: 6.3,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  itemTextBlock: {
    justifyContent: 'center',
  },
  itemTextEn: {
    fontSize: 5.7,
    lineHeight: 1.08,
    fontWeight: 'bold',
  },
  itemTextUa: {
    fontSize: 5.7,
    lineHeight: 1.08,
  },
  valueText: {
    fontSize: 5.7,
    lineHeight: 1.08,
    textAlign: 'center',
  },
  valueTextBold: {
    fontSize: 5.7,
    lineHeight: 1.08,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  packingText: {
    fontSize: 5.6,
    lineHeight: 1.08,
    textAlign: 'center',
  },
  weightsTable: {
    width: 130,
    alignSelf: 'center',
    marginTop: 8,
    borderTopWidth: 0.7,
    borderLeftWidth: 0.7,
    borderColor: '#111111',
  },
  weightRow: {
    flexDirection: 'row',
    minHeight: 16,
  },
  weightLabel: {
    width: 84,
    fontSize: 5.5,
    textAlign: 'center',
    lineHeight: 1.05,
  },
  weightValue: {
    width: 46,
    fontSize: 5.6,
    textAlign: 'center',
  },
  summary: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    marginTop: 29,
    textAlign: 'center',
  },
  summaryLineEn: {
    fontSize: 5.7,
    lineHeight: 1.25,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  summaryLineUa: {
    fontSize: 5.5,
    lineHeight: 1.25,
    textAlign: 'center',
  },
  signatures: {
    width: TABLE_WIDTH,
    height: 112,
    alignSelf: 'center',
    marginTop: 18,
    position: 'relative',
  },
  signatureLeft: {
    position: 'absolute',
    left: 30,
    top: 18,
    width: 150,
  },
  signatureAssets: {
    position: 'absolute',
    left: 155,
    top: 0,
  },
  signatureRight: {
    position: 'absolute',
    right: 38,
    top: 18,
    width: 92,
  },
  signatureTextEn: {
    fontSize: 6,
    lineHeight: 1.12,
    fontWeight: 'bold',
  },
  signatureTextUa: {
    marginTop: 28,
    fontSize: 5.8,
    lineHeight: 1.12,
  },
})

function formatSellerName(name: string) {
  const baseName = name
    .trim()
    .replace(/\s+LLC\.?$/i, '')
    .replace(/^["«]+/, '')
    .replace(/["»]+$/, '')
    .trim()

  return baseName ? `«${baseName}» LLC` : ''
}

function addressLines(address: string, clientName?: string) {
  let value = address.trim()
  if (!value) return []

  if (clientName && value.toLowerCase().startsWith(clientName.toLowerCase())) {
    value = value.slice(clientName.length).replace(/^[\s,]+/, '').trim()
  }

  const explicitLines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (explicitLines.length > 1) return explicitLines

  const parts = value.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 2) return [value]

  return [
    `${parts[0]}, ${parts[1]},`,
    parts.slice(2).join(', '),
  ]
}

function deliveryBasisLine(prefix: string, location: string) {
  const cleanPrefix = prefix.trim()
  const cleanLocation = location.trim()
  if (!cleanPrefix) return cleanLocation
  if (!cleanLocation) return cleanPrefix
  return `${cleanPrefix} - ${cleanLocation}`
}

function pluralizeEn(type: string, count: number) {
  if (!type) return count === 1 ? 'place' : 'places'
  if (count === 1 || type.endsWith('s')) return type
  if (type.endsWith('y')) return `${type.slice(0, -1)}ies`
  return `${type}s`
}

function joinSummaryParts(parts: string[], conjunction: string) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`
}

function packingSummaryFromGroups(groups: DocumentPackingGroup[], language: 'en' | 'ua') {
  const totals = new Map<string, number>()
  for (const group of groups) {
    const type = language === 'en'
      ? group.packing_type_en
      : group.packing_type_ua || group.packing_type_en
    if (!type) continue
    totals.set(type, (totals.get(type) || 0) + group.places)
  }

  const parts = Array.from(totals.entries()).map(([type, count]) => {
    if (language === 'en') return `${count} ${pluralizeEn(type, count)}`
    return `${count} ${type}`
  })

  return joinSummaryParts(parts, language === 'en' ? 'and' : 'та')
}

function normalizePackingGroups(data: DocumentData) {
  if (data.packingGroups.length > 0) return data.packingGroups

  return data.items
    .map((item, index) => {
      if (!item.packing_type || item.packing_places <= 0) return null
      return {
        start_item_number: index + 1,
        end_item_number: index + 1,
        packing_type_en: item.packing_type,
        packing_type_ua: '',
        places: item.packing_places,
        sort_order: index,
      }
    })
    .filter((group): group is DocumentPackingGroup => Boolean(group))
}

function findPackingGroup(itemNumber: number, groups: DocumentPackingGroup[]) {
  return groups.find((group) => itemNumber >= group.start_item_number && itemNumber <= group.end_item_number) || null
}

function buildRuns(items: DocumentItem[], itemNumbers: Map<DocumentItem, number>, packingGroups: DocumentPackingGroup[]) {
  const runs: ItemRun[] = []

  for (const item of items) {
    const number = itemNumbers.get(item) || 0
    const group = findPackingGroup(number, packingGroups)
    const key = group
      ? `${group.start_item_number}-${group.end_item_number}-${group.packing_type_en}-${group.places}`
      : `item-${number}`
    const lastRun = runs[runs.length - 1]

    if (lastRun?.key === key) {
      lastRun.items.push({ item, number })
    } else {
      runs.push({ key, items: [{ item, number }], group })
    }
  }

  return runs
}

function HeaderCell({ width, children }: { width: number; children: ReactNode }) {
  return (
    <View style={[styles.cell, styles.headerCell, { width }]}>
      <Text style={styles.headerText}>{children}</Text>
    </View>
  )
}

function ItemRow({ item, number }: NumberedItem) {
  return (
    <View style={styles.itemRow} wrap={false}>
      <View style={[styles.cell, styles.centerCell, { width: COLS.no }]}>
        <Text style={styles.valueText}>{number}</Text>
      </View>
      <View style={[styles.cell, styles.itemTextBlock, { width: COLS.item }]}>
        <Text style={styles.itemTextEn}>{item.product_name_en}</Text>
        <Text style={styles.itemTextUa}>{item.product_name_uk}</Text>
      </View>
      <View style={[styles.cell, styles.centerCell, { width: COLS.measurement }]}>
        <Text style={styles.valueTextBold}>Pcs/шт</Text>
      </View>
      <View style={[styles.cell, styles.centerCell, { width: COLS.quantity }]}>
        <Text style={styles.valueText}>{formatQuantity(item.quantity)}</Text>
      </View>
      <View style={[styles.cell, styles.centerCell, { width: COLS.netWeight }]}>
        <Text style={styles.valueText}>{formatWeight(item.net_weight)}</Text>
      </View>
    </View>
  )
}

function ItemsTable({ data, packingGroups }: { data: DocumentData; packingGroups: DocumentPackingGroup[] }) {
  const itemNumbers = new Map<DocumentItem, number>()
  data.items.forEach((item, index) => itemNumbers.set(item, index + 1))
  const groupedItems = groupItemsByHsCode(data.items)

  return (
    <View style={styles.table}>
      <View style={styles.headerRow} wrap={false}>
        <HeaderCell width={COLS.no}>№</HeaderCell>
        <HeaderCell width={COLS.item}>{'Item name\n(Найменування товару)'}</HeaderCell>
        <HeaderCell width={COLS.measurement}>{'Measure-ment\n(Од. вим.)'}</HeaderCell>
        <HeaderCell width={COLS.quantity}>{'Q-ty\n(Кіл-ть)'}</HeaderCell>
        <HeaderCell width={COLS.netWeight}>{'Net weight, kg\n(Маса нетто\nкг)'}</HeaderCell>
        <HeaderCell width={COLS.packingType}>{'The type of\npacking\n(Вид груз.\nмісць)'}</HeaderCell>
        <HeaderCell width={COLS.places}>Places (Місця)</HeaderCell>
      </View>

      {groupedItems.map((group) => (
        <View key={group.uktzed} wrap={false}>
          <View style={styles.hsRow}>
            <View style={[styles.cell, styles.centerCell, { width: TABLE_WIDTH }]}>
              <Text style={styles.hsText}>HS code (код УКТЗЕД) {group.uktzed}</Text>
            </View>
          </View>

          {buildRuns(group.items, itemNumbers, packingGroups).map((run) => {
            const runHeight = run.items.length * ITEM_ROW_HEIGHT
            return (
              <View key={run.key} style={styles.itemRun} wrap={false}>
                <View style={{ width: LEFT_TABLE_WIDTH }}>
                  {run.items.map((numberedItem) => (
                    <ItemRow key={`${numberedItem.number}-${numberedItem.item.product_name_en}`} {...numberedItem} />
                  ))}
                </View>
                <View style={[styles.cell, styles.centerCell, { width: COLS.packingType, height: runHeight }]}>
                  <Text style={styles.packingText}>
                    {run.group ? `${run.group.packing_type_en}${run.group.packing_type_ua ? `\n(${run.group.packing_type_ua})` : ''}` : ''}
                  </Text>
                </View>
                <View style={[styles.cell, styles.centerCell, { width: COLS.places, height: runHeight }]}>
                  <Text style={styles.valueText}>{run.group ? run.group.places : ''}</Text>
                </View>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

export function PackingListDocument({ data }: { data: DocumentData }) {
  const number = data.machine.specification_number || data.machine.name
  const date = formatDate(data.machine.specification_date)
  const contractNumber = data.contract?.number || ''
  const contractDate = formatDate(data.contract?.date)
  const deliveryLocationEn = data.client.delivery_basis_location_en || data.client.country_city || ''
  const deliveryLocationUa = data.client.delivery_basis_location_ua || data.client.delivery_basis_location_en || data.client.country_city || ''
  const deliveryBasisEn = deliveryBasisLine(data.company.delivery_basis_en, deliveryLocationEn)
  const deliveryBasisUa = deliveryBasisLine(data.company.delivery_basis_ua, deliveryLocationUa)
  const packingGroups = normalizePackingGroups(data)
  const totalPlaces = packingGroups.length > 0
    ? packingGroups.reduce((sum, group) => sum + group.places, 0)
    : data.totals.total_places
  const summaryEn = packingSummaryFromGroups(packingGroups, 'en') || packingSummary(data.items) || '-'
  const summaryUa = packingSummaryFromGroups(packingGroups, 'ua') || summaryEn
  const netWeight = data.items.reduce((sum, item) => sum + item.net_weight, 0)
  const grossWeight = netWeight * 1.05
  const sellerName = formatSellerName(data.company.name_en) || data.company.name_en
  const sellerLines = addressLines(data.company.address_en)
  const buyerLines = addressLines(data.client.address, data.client.name)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.topBlock} wrap={false}>
          <View style={[styles.row, styles.topTitleRow]}>
            <View style={[styles.topCell, { width: TOP_LEFT_WIDTH }]}>
              <Text style={styles.topTextBold}>Packing list № {number}</Text>
              <Text style={styles.topTextBold}>Пакувальний лист № {number}</Text>
            </View>
            <View style={[styles.topCell, styles.rightCenteredCell, { width: TOP_RIGHT_WIDTH }]}>
              <Text style={styles.topTextBold}>Date/Дата {date}</Text>
            </View>
          </View>

          <View style={[styles.row, styles.partyRow]}>
            <View style={[styles.topCell, { width: TOP_LEFT_WIDTH }]}>
              <Text style={styles.topTextBold}>Consignor/ Відправник</Text>
              <Text style={styles.topTextBold}>{sellerName}</Text>
              {sellerLines.map((line) => <Text key={line} style={styles.topTextBold}>{line}</Text>)}
            </View>
            <View style={[styles.topCell, styles.rightCenteredCell, { width: TOP_RIGHT_WIDTH }]}>
              <Text style={styles.topTextBold}>Contract / Контракт {contractNumber} від {contractDate}</Text>
              <Text style={styles.topTextBold}>Specification/ Специфікація {number} від {date}</Text>
            </View>
          </View>

          <View style={[styles.row, styles.recipientRow]}>
            <View style={[styles.topCell, { width: TOP_LEFT_WIDTH }]}>
              <Text style={styles.topTextBold}>Recipient/ Отримувач:</Text>
              <Text style={[styles.topTextBold, { marginTop: 12 }]}>{data.client.name}</Text>
              {buyerLines.map((line) => <Text key={line} style={styles.topTextBold}>{line}</Text>)}
            </View>
            <View style={[styles.topCell, { width: TOP_RIGHT_WIDTH, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }]}>
              <View style={styles.deliveryPart}>
                <Text style={styles.topText}>{deliveryBasisEn}</Text>
                <Text style={styles.topText}>{deliveryBasisUa}</Text>
              </View>
              <View style={styles.countryPart}>
                <Text style={styles.topTextBold}>The country of origin: Ukraine.</Text>
                <Text style={styles.topTextBold}>Країна походження: Україна.</Text>
              </View>
            </View>
          </View>
        </View>

        <ItemsTable data={data} packingGroups={packingGroups} />

        <View style={styles.weightsTable} wrap={false}>
          <View style={styles.weightRow}>
            <View style={[styles.cell, styles.centerCell, styles.weightLabel]}>
              <Text>{'Gross weight, kg/\nМаса брутто, кг'}</Text>
            </View>
            <View style={[styles.cell, styles.centerCell, styles.weightValue]}>
              <Text>{formatWeight(grossWeight)}</Text>
            </View>
          </View>
          <View style={styles.weightRow}>
            <View style={[styles.cell, styles.centerCell, styles.weightLabel]}>
              <Text>{'Net weight, kg/\nМаса нетто, кг'}</Text>
            </View>
            <View style={[styles.cell, styles.centerCell, styles.weightValue]}>
              <Text>{formatWeight(netWeight)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.summary} wrap={false}>
          <Text style={styles.summaryLineEn}>TOTAL: {totalPlaces} places:{summaryEn}</Text>
          <Text style={styles.summaryLineUa}>ВСЬОГО: {totalPlaces} місць:{summaryUa}</Text>
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signatureLeft}>
            <Text style={styles.signatureTextEn}>Director {sellerName}</Text>
            <Text style={styles.signatureTextUa}>Директор {data.company.name_ua}</Text>
          </View>
          <View style={styles.signatureAssets}>
            <PdfSignatureStampOverlay signatureSrc={data.signatureUrl} stampSrc={data.stampUrl} />
          </View>
          <View style={styles.signatureRight}>
            <Text style={styles.signatureTextEn}>{data.company.director_name_en}</Text>
            <Text style={styles.signatureTextUa}>{data.company.director_name_ua}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
