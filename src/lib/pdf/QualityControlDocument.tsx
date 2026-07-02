import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { DocumentData, DocumentItem } from '@/lib/actions/document-generation'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'

registerPdfFonts()

const COLS = {
  no: 38,
  name: 270,
  drawing: 90,
  welding: 86,
  cleaning: 86,
  straightening: 70,
  workable: 80,
}
const TABLE_WIDTH = 720

type QualityControlRow = {
  no: number
  name: string
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingRight: 54,
    paddingBottom: 42,
    paddingLeft: 54,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 9,
    lineHeight: 1.15,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  header: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    marginBottom: 24,
    paddingLeft: 56,
    paddingRight: 56,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderLabel: {
    width: 230,
    fontSize: 10,
    fontWeight: 'bold',
  },
  orderValue: {
    flex: 1,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  table: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    borderTopWidth: 0.7,
    borderLeftWidth: 0.7,
    borderColor: '#111111',
  },
  headerRow: {
    flexDirection: 'row',
    minHeight: 36,
  },
  row: {
    flexDirection: 'row',
    minHeight: 18,
  },
  cell: {
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
    paddingTop: 2,
    paddingRight: 4,
    paddingBottom: 2,
    paddingLeft: 4,
    justifyContent: 'center',
  },
  headerCell: {
    backgroundColor: '#efefef',
    alignItems: 'center',
    textAlign: 'center',
  },
  headerText: {
    fontSize: 8.6,
    fontWeight: 'bold',
    lineHeight: 1.08,
    textAlign: 'center',
  },
  numberText: {
    fontSize: 8.8,
    textAlign: 'center',
  },
  nameText: {
    fontSize: 8.8,
    lineHeight: 1.08,
  },
  signatureRow: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 28,
  },
  signatureItem: {
    width: 260,
    flexDirection: 'row',
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    marginRight: 8,
  },
  signatureLine: {
    flex: 1,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
    height: 16,
  },
})

function safeQuantity(value: number) {
  const quantity = Math.trunc(Number(value || 0))
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

function itemName(item: DocumentItem) {
  return item.product_name_uk || item.product_name_en || 'Товар'
}

function buildQualityRows(items: DocumentItem[]) {
  const rows: QualityControlRow[] = []

  for (const item of items) {
    const quantity = safeQuantity(item.quantity)
    const name = itemName(item)
    for (let index = 1; index <= quantity; index += 1) {
      rows.push({
        no: rows.length + 1,
        name: `${name} №${index}`,
      })
    }
  }

  return rows
}

function HeaderCell({ width, children }: { width: number; children: string }) {
  return (
    <View style={[styles.cell, styles.headerCell, { width }]}>
      <Text style={styles.headerText}>{children}</Text>
    </View>
  )
}

function EmptyCell({ width }: { width: number }) {
  return <View style={[styles.cell, { width }]} />
}

function QualityTable({ rows }: { rows: QualityControlRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow} fixed>
        <HeaderCell width={COLS.no}>№</HeaderCell>
        <HeaderCell width={COLS.name}>Назва товару</HeaderCell>
        <HeaderCell width={COLS.drawing}>{'Розміри\nвідповідають\nкресленням'}</HeaderCell>
        <HeaderCell width={COLS.welding}>Зварочні шви</HeaderCell>
        <HeaderCell width={COLS.cleaning}>Зачистка</HeaderCell>
        <HeaderCell width={COLS.straightening}>Рихтовка</HeaderCell>
        <HeaderCell width={COLS.workable}>Працездатність</HeaderCell>
      </View>

      {rows.map((row) => (
        <View key={`${row.no}-${row.name}`} style={styles.row} wrap={false}>
          <View style={[styles.cell, { width: COLS.no }]}>
            <Text style={styles.numberText}>{row.no}</Text>
          </View>
          <View style={[styles.cell, { width: COLS.name }]}>
            <Text style={styles.nameText}>{row.name}</Text>
          </View>
          <EmptyCell width={COLS.drawing} />
          <EmptyCell width={COLS.welding} />
          <EmptyCell width={COLS.cleaning} />
          <EmptyCell width={COLS.straightening} />
          <EmptyCell width={COLS.workable} />
        </View>
      ))}
    </View>
  )
}

export function QualityControlDocument({ data }: { data: DocumentData }) {
  const rows = buildQualityRows(data.items)

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} wrap={false}>
          <Text style={styles.headerTitle}>Звіт якості продукції</Text>
          <View style={styles.orderRow}>
            <Text style={styles.orderLabel}>Номер замовлення</Text>
            <Text style={styles.orderValue}>{data.machine.name}</Text>
          </View>
        </View>

        <QualityTable rows={rows} />

        <View style={styles.signatureRow} wrap={false}>
          <View style={styles.signatureItem}>
            <Text style={styles.signatureLabel}>Дата</Text>
            <View style={styles.signatureLine} />
          </View>
          <View style={styles.signatureItem}>
            <Text style={styles.signatureLabel}>Підпис</Text>
            <View style={styles.signatureLine} />
          </View>
        </View>
      </Page>
    </Document>
  )
}
