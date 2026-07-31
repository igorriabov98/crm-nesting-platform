import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { DocumentData, DocumentItem } from '@/lib/actions/document-generation'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'
import { formatMoney, formatQuantity } from './format'

registerPdfFonts()

const TRAILING_RAL_CODE_PATTERN = /\s*\(?RAL\s*[-:]?\s*\d{4}\)?\s*$/i

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingRight: 36,
    paddingBottom: 36,
    paddingLeft: 36,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 8,
    lineHeight: 1.25,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  title: {
    marginBottom: 18,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  table: {
    borderTopWidth: 0.8,
    borderLeftWidth: 0.8,
    borderColor: '#111111',
  },
  row: {
    flexDirection: 'row',
    minHeight: 26,
  },
  headerRow: {
    flexDirection: 'row',
    minHeight: 34,
    backgroundColor: '#e8edf3',
    fontWeight: 'bold',
  },
  cell: {
    paddingTop: 5,
    paddingRight: 4,
    paddingBottom: 5,
    paddingLeft: 4,
    borderRightWidth: 0.8,
    borderBottomWidth: 0.8,
    borderColor: '#111111',
  },
  centered: {
    textAlign: 'center',
  },
  right: {
    textAlign: 'right',
  },
  name: {
    width: '29%',
  },
  coating: {
    width: '15%',
  },
  quantity: {
    width: '8%',
  },
  metric: {
    width: '12%',
  },
  totalLabel: {
    width: '88%',
    fontWeight: 'bold',
    textAlign: 'right',
  },
  totalValue: {
    width: '12%',
    fontWeight: 'bold',
    textAlign: 'right',
  },
})

function normalizedRalNumber(value: string) {
  return value
    .trim()
    .replace(/^RAL\s*[-:]?\s*/i, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

function productName(item: DocumentItem) {
  const sourceName = item.product_name_en || item.product_name_uk || 'Item'
  return sourceName.trim().replace(TRAILING_RAL_CODE_PATTERN, '').trim()
}

export function formatOrderSpecificationCoating(item: DocumentItem) {
  if (item.coating === 'zinc') return 'Zinc coating'
  if (item.coating === 'powder_coating') {
    const ralNumber = normalizedRalNumber(item.ral_number)
    return ralNumber ? `Powder coating (RAL ${ralNumber})` : 'Powder coating'
  }
  return 'No coating'
}

function TableHeader() {
  return (
    <View style={styles.headerRow} fixed>
      <Text style={[styles.cell, styles.centered, styles.name]}>Product name</Text>
      <Text style={[styles.cell, styles.centered, styles.coating]}>Coating</Text>
      <Text style={[styles.cell, styles.centered, styles.quantity]}>Quantity, pcs</Text>
      <Text style={[styles.cell, styles.centered, styles.metric]}>Unit weight, kg</Text>
      <Text style={[styles.cell, styles.centered, styles.metric]}>Unit price, EUR</Text>
      <Text style={[styles.cell, styles.centered, styles.metric]}>Total weight, kg</Text>
      <Text style={[styles.cell, styles.centered, styles.metric]}>Total price, EUR</Text>
    </View>
  )
}

export function OrderSpecificationDocument({ data }: { data: DocumentData }) {
  const orderNumber = data.machine.specification_number || data.machine.name

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>
          ORDER SPECIFICATION FOR CLIENT {data.client.name}{'\n'}FOR ORDER {orderNumber}
        </Text>

        <View style={styles.table}>
          <TableHeader />
          {data.items.map((item, index) => (
            <View key={`${item.sort_order}-${index}`} style={styles.row} wrap={false}>
              <Text style={[styles.cell, styles.name]}>{productName(item)}</Text>
              <Text style={[styles.cell, styles.coating]}>{formatOrderSpecificationCoating(item)}</Text>
              <Text style={[styles.cell, styles.centered, styles.quantity]}>{formatQuantity(item.quantity)}</Text>
              <Text style={[styles.cell, styles.right, styles.metric]}>{formatQuantity(item.weight)}</Text>
              <Text style={[styles.cell, styles.right, styles.metric]}>{formatMoney(item.price)}</Text>
              <Text style={[styles.cell, styles.right, styles.metric]}>{formatQuantity(item.net_weight)}</Text>
              <Text style={[styles.cell, styles.right, styles.metric]}>{formatMoney(item.total)}</Text>
            </View>
          ))}
          <View style={styles.row} wrap={false}>
            <Text style={[styles.cell, styles.totalLabel]}>TOTAL COST, EUR</Text>
            <Text style={[styles.cell, styles.totalValue]}>{formatMoney(data.totals.goods_total)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
