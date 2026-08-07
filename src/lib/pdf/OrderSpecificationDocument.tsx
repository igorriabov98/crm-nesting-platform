import type { ReactNode } from 'react'
import { Document, Page, StyleSheet, Text, View, type ViewProps } from '@react-pdf/renderer'
import type { DocumentData, DocumentItem } from '@/lib/actions/document-generation'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'
import { formatMoney, formatQuantity } from './format'

registerPdfFonts()

const TRAILING_RAL_CODE_PATTERN = /\s*\(?RAL\s*[-:]?\s*\d{4}\)?\s*$/i

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingRight: 28,
    paddingBottom: 32,
    paddingLeft: 28,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 9.2,
    lineHeight: 1.18,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  title: {
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  table: {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: '#111111',
  },
  row: {
    flexDirection: 'row',
    minHeight: 42,
  },
  headerRow: {
    flexDirection: 'row',
    minHeight: 48,
    fontWeight: 'bold',
  },
  cell: {
    paddingTop: 6,
    paddingRight: 5,
    paddingBottom: 6,
    paddingLeft: 5,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#111111',
  },
  cellContentCenter: {
    justifyContent: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  headerText: {
    textAlign: 'center',
    fontSize: 9.5,
    fontWeight: 'bold',
    lineHeight: 1.15,
  },
  itemNameEn: {
    fontWeight: 'bold',
  },
  itemNameUk: {
    marginTop: 2,
  },
  name: {
    width: '26%',
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
  totalWeight: {
    width: '13%',
  },
  totalPrice: {
    width: '14%',
  },
  totalLabel: {
    width: '86%',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  totalValue: {
    width: '14%',
    fontWeight: 'bold',
    textAlign: 'center',
  },
})

function normalizedRalNumber(value: string) {
  return value
    .trim()
    .replace(/^RAL\s*[-:]?\s*/i, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

function productName(item: DocumentItem, language: 'en' | 'uk') {
  const sourceName = language === 'en'
    ? item.product_name_en || item.product_name_uk || 'Item'
    : item.product_name_uk || item.product_name_en || 'Товар'
  return sourceName.trim().replace(TRAILING_RAL_CODE_PATTERN, '').trim()
}

export function formatOrderSpecificationCoating(item: DocumentItem) {
  if (item.coating === 'cold_zinc') return 'Cold zinc coating'
  if (item.coating === 'zinc') return 'Hot-dip zinc coating'
  if (item.coating === 'powder_coating') {
    const ralNumber = normalizedRalNumber(item.ral_number)
    return ralNumber ? `Powder coating (RAL ${ralNumber})` : 'Powder coating'
  }
  return 'No coating'
}

export function formatOrderSpecificationCoatingUk(item: DocumentItem) {
  if (item.coating === 'cold_zinc') return 'Холодне цинкове покриття'
  if (item.coating === 'zinc') return 'Гаряче цинкове покриття'
  if (item.coating === 'powder_coating') {
    const ralNumber = normalizedRalNumber(item.ral_number)
    return ralNumber ? `Порошкове фарбування (RAL ${ralNumber})` : 'Порошкове фарбування'
  }
  return 'Без покриття'
}

type PdfViewStyle = NonNullable<ViewProps['style']>

function combinedCellStyle(style: PdfViewStyle) {
  return Array.isArray(style)
    ? [styles.cell, styles.cellContentCenter, ...style]
    : [styles.cell, styles.cellContentCenter, style]
}

function HeaderCell({ style, children }: { style: PdfViewStyle; children: ReactNode }) {
  return (
    <View style={combinedCellStyle(style)}>
      <Text style={styles.headerText}>{children}</Text>
    </View>
  )
}

function ValueCell({ style, children }: { style: PdfViewStyle; children: ReactNode }) {
  return (
    <View style={combinedCellStyle(style)}>
      <Text style={styles.centered}>{children}</Text>
    </View>
  )
}

function TableHeader() {
  return (
    <View style={styles.headerRow} fixed>
      <HeaderCell style={styles.name}>Item name{'\n'}(Найменування товару)</HeaderCell>
      <HeaderCell style={styles.coating}>Coating{'\n'}(Покриття)</HeaderCell>
      <HeaderCell style={styles.quantity}>Q-ty{'\n'}(Кіл-ть)</HeaderCell>
      <HeaderCell style={styles.metric}>Weight per pc, kg{'\n'}(Вага за шт, кг)</HeaderCell>
      <HeaderCell style={styles.metric}>Price in Euro{'\n'}(Ціна Євро)</HeaderCell>
      <HeaderCell style={styles.totalWeight}>Total weight, kg{'\n'}(Загальна вага, кг)</HeaderCell>
      <HeaderCell style={styles.totalPrice}>Total in Euro{'\n'}(Сума Євро)</HeaderCell>
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
              <View style={[styles.cell, styles.cellContentCenter, styles.name]}>
                <Text style={styles.itemNameEn}>{productName(item, 'en')}</Text>
                <Text style={styles.itemNameUk}>{productName(item, 'uk')}</Text>
              </View>
              <View style={[styles.cell, styles.cellContentCenter, styles.coating]}>
                <Text style={styles.itemNameEn}>{formatOrderSpecificationCoating(item)}</Text>
                <Text style={styles.itemNameUk}>{formatOrderSpecificationCoatingUk(item)}</Text>
              </View>
              <ValueCell style={styles.quantity}>{formatQuantity(item.quantity)}</ValueCell>
              <ValueCell style={styles.metric}>{formatQuantity(item.weight)}</ValueCell>
              <ValueCell style={styles.metric}>{formatMoney(item.price)}</ValueCell>
              <ValueCell style={styles.totalWeight}>{formatQuantity(item.net_weight)}</ValueCell>
              <ValueCell style={styles.totalPrice}>{formatMoney(item.total)}</ValueCell>
            </View>
          ))}
          <View style={styles.row} wrap={false}>
            <View style={[styles.cell, styles.cellContentCenter, styles.totalLabel]}>
              <Text>Total/Всього:</Text>
            </View>
            <View style={[styles.cell, styles.cellContentCenter, styles.totalValue]}>
              <Text>{formatMoney(data.totals.goods_total)}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
