import { Image, Text, View } from '@react-pdf/renderer'
import type { DocumentData } from '@/lib/actions/document-generation'
import { formatMoney, formatQuantity, formatWeight, groupItemsByHsCode } from './format'
import { pdfStyles, tableWidths } from './styles'

type DocumentProps = {
  data: DocumentData
}

const packingWidths = {
  no: { width: '5%' },
  item: { width: '39%' },
  measurement: { width: '10%' },
  quantity: { width: '8%' },
  netWeight: { width: '13%' },
  packingType: { width: '17%' },
  places: { width: '8%' },
}

function rowStyle(striped: boolean) {
  return striped ? [pdfStyles.tableRow, pdfStyles.stripedRow] : [pdfStyles.tableRow]
}

function groupRow(label: string) {
  return (
    <View style={pdfStyles.tableGroupRow} wrap={false}>
      <Text style={[pdfStyles.cell, pdfStyles.cellBold, { width: '100%' }]}>{label}</Text>
    </View>
  )
}

function rowNumberFor(groups: ReturnType<typeof groupItemsByHsCode>, groupIndex: number, itemIndex: number) {
  return groups
    .slice(0, groupIndex)
    .reduce((sum, group) => sum + group.items.length, 0) + itemIndex + 1
}

export function CommercialItemsTable({ data }: DocumentProps) {
  const groups = groupItemsByHsCode(data.items)

  return (
    <View style={pdfStyles.table}>
      <View style={pdfStyles.tableHeader} fixed>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, tableWidths.no]}>№</Text>
        <Text style={[pdfStyles.cell, tableWidths.item]}>Item name (EN) / Назва (UA)</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, tableWidths.measurement]}>Measurement</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, tableWidths.quantity]}>Q-ty</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellRight, tableWidths.price]}>Price EUR</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellRight, tableWidths.total]}>Total EUR</Text>
      </View>

      {groups.map((group, groupIndex) => (
        <View key={group.uktzed}>
          {groupRow(`HS code (код УКТЗЕД) ${group.uktzed}`)}
          {group.items.map((item, itemIndex) => {
            const currentNumber = rowNumberFor(groups, groupIndex, itemIndex)

            return (
              <View key={`${group.uktzed}-${currentNumber}`} style={rowStyle(currentNumber % 2 === 0)} wrap={false}>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, tableWidths.no]}>{currentNumber}</Text>
                <View style={[pdfStyles.cell, tableWidths.item]}>
                  <Text style={pdfStyles.itemNameEn}>{item.product_name_en}</Text>
                  <Text>{item.product_name_uk}</Text>
                </View>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, tableWidths.measurement]}>Pcs/шт</Text>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, tableWidths.quantity]}>{formatQuantity(item.quantity)}</Text>
                <Text style={[pdfStyles.cell, pdfStyles.cellRight, tableWidths.price]}>{formatMoney(item.price)}</Text>
                <Text style={[pdfStyles.cell, pdfStyles.cellRight, tableWidths.total]}>{formatMoney(item.total)}</Text>
              </View>
            )
          })}
        </View>
      ))}

      {data.expenses.map((expense, index) => (
        <View key={`${expense.label}-${index}`} style={pdfStyles.tableRow} wrap={false}>
          <Text style={[pdfStyles.cell, { width: '86%' }]}>Additional expenses / Додаткові витрати: {expense.label}</Text>
          <Text style={[pdfStyles.cell, pdfStyles.cellRight, tableWidths.total]}>{formatMoney(expense.amount)}</Text>
        </View>
      ))}
      <View style={pdfStyles.tableRow} wrap={false}>
        <Text style={[pdfStyles.cell, pdfStyles.cellBold, { width: '86%' }]}>Total/Всього:</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellRight, pdfStyles.cellBold, tableWidths.total]}>{formatMoney(data.totals.grand_total)}</Text>
      </View>
    </View>
  )
}

export function PackingItemsTable({ data }: DocumentProps) {
  const groups = groupItemsByHsCode(data.items)

  return (
    <View style={pdfStyles.table}>
      <View style={pdfStyles.tableHeader} fixed>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.no]}>№</Text>
        <Text style={[pdfStyles.cell, packingWidths.item]}>Item name (EN) / Назва (UA)</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.measurement]}>Measurement</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.quantity]}>Q-ty</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellRight, packingWidths.netWeight]}>Net weight kg</Text>
        <Text style={[pdfStyles.cell, packingWidths.packingType]}>Type of packing</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.places]}>Places</Text>
      </View>

      {groups.map((group, groupIndex) => (
        <View key={group.uktzed}>
          {groupRow(`HS code (код УКТЗЕД) ${group.uktzed}`)}
          {group.items.map((item, itemIndex) => {
            const currentNumber = rowNumberFor(groups, groupIndex, itemIndex)

            return (
              <View key={`${group.uktzed}-${currentNumber}`} style={rowStyle(currentNumber % 2 === 0)} wrap={false}>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.no]}>{currentNumber}</Text>
                <View style={[pdfStyles.cell, packingWidths.item]}>
                  <Text style={pdfStyles.itemNameEn}>{item.product_name_en}</Text>
                  <Text>{item.product_name_uk}</Text>
                </View>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.measurement]}>Pcs/шт</Text>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.quantity]}>{formatQuantity(item.quantity)}</Text>
                <Text style={[pdfStyles.cell, pdfStyles.cellRight, packingWidths.netWeight]}>{formatWeight(item.net_weight)}</Text>
                <Text style={[pdfStyles.cell, packingWidths.packingType]}>{item.packing_type}</Text>
                <Text style={[pdfStyles.cell, pdfStyles.cellCenter, packingWidths.places]}>{item.packing_places}</Text>
              </View>
            )
          })}
        </View>
      ))}

      <View style={pdfStyles.tableRow} wrap={false}>
        <Text style={[pdfStyles.cell, pdfStyles.cellBold, { width: '87%' }]}>Gross weight, kg:</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellRight, pdfStyles.cellBold, { width: '13%' }]}>
          {formatWeight(data.totals.total_gross_weight)}
        </Text>
      </View>
      <View style={pdfStyles.tableRow} wrap={false}>
        <Text style={[pdfStyles.cell, pdfStyles.cellBold, { width: '87%' }]}>Net weight, kg:</Text>
        <Text style={[pdfStyles.cell, pdfStyles.cellRight, pdfStyles.cellBold, { width: '13%' }]}>
          {formatWeight(data.totals.total_net_weight)}
        </Text>
      </View>
    </View>
  )
}

export function PdfImage({ src, type }: { src: string | null; type: 'signature' | 'stamp' }) {
  if (!src) return null
  return <Image src={src} style={type === 'signature' ? pdfStyles.signatureImage : pdfStyles.stampImage} />
}

export function PdfSignatureStampOverlay({
  signatureSrc,
  stampSrc,
}: {
  signatureSrc: string | null
  stampSrc: string | null
}) {
  if (!signatureSrc && !stampSrc) return null

  return (
    <View style={pdfStyles.signatureStampOverlay}>
      {stampSrc && <Image src={stampSrc} style={pdfStyles.signatureStampStampImage} />}
      {signatureSrc && <Image src={signatureSrc} style={pdfStyles.signatureStampSignatureImage} />}
    </View>
  )
}
