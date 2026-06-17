import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { DocumentData, DocumentExpense, DocumentItem } from '@/lib/actions/document-generation'
import { PdfSignatureStampOverlay } from './components'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'
import { amountToWordsEn, amountToWordsUa, formatDate, formatMoney, formatQuantity, groupItemsByHsCode } from './format'

registerPdfFonts()

const TABLE_WIDTH = 490.8
const ITEMS_PER_PAGE = 13
const COLS = {
  no: 53.4,
  item: 223.7,
  measurement: 53.4,
  quantity: 53.4,
  price: 53.4,
  total: 53.5,
}
const TOTALS_LABEL_WIDTH = COLS.no + COLS.item + COLS.measurement + COLS.quantity + COLS.price

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingRight: 51,
    paddingBottom: 40,
    paddingLeft: 51,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 5.8,
    lineHeight: 1.12,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  table: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    borderTopWidth: 0.7,
    borderLeftWidth: 0.7,
    borderColor: '#111111',
  },
  specHeader: {
    width: TABLE_WIDTH,
    minHeight: 72,
    paddingTop: 4,
    paddingRight: 4,
    paddingBottom: 8,
    paddingLeft: 4,
    alignSelf: 'center',
    justifyContent: 'flex-start',
    textAlign: 'center',
  },
  titleLine: {
    fontSize: 7.4,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 1.08,
  },
  subtitleLine: {
    fontSize: 7.2,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 1.08,
  },
  englishTitleLine: {
    marginTop: 7,
  },
  headerRow: {
    flexDirection: 'row',
    height: 27,
  },
  tableRow: {
    flexDirection: 'row',
    minHeight: 18.8,
  },
  hsRow: {
    flexDirection: 'row',
    minHeight: 9.5,
  },
  continuationHsRow: {
    minHeight: 26.8,
  },
  summaryRow: {
    flexDirection: 'row',
    minHeight: 9.5,
  },
  totalRow: {
    flexDirection: 'row',
    minHeight: 11.8,
  },
  cell: {
    paddingTop: 2,
    paddingRight: 3,
    paddingBottom: 2,
    paddingLeft: 3,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
  },
  headerCell: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  headerText: {
    fontSize: 6.9,
    fontWeight: 'bold',
    lineHeight: 1.05,
    marginTop: -3.4,
    textAlign: 'center',
  },
  headerTextSingle: {
    marginTop: -2.3,
  },
  headerTextItem: {
    marginTop: -3.8,
  },
  headerTextMeasure: {
    marginTop: -3.65,
  },
  headerTextAmount: {
    marginTop: -3.8,
  },
  itemRowCell: {
    justifyContent: 'center',
    height: '100%',
  },
  itemRowCellCenter: {
    alignItems: 'center',
  },
  itemRowCellLeft: {
    alignItems: 'flex-start',
  },
  itemRowText: {
    fontSize: 6.9,
    lineHeight: 1.05,
    marginTop: -2.4,
    textAlign: 'center',
  },
  itemRowTextTotal: {
    marginTop: -2.9,
  },
  center: {
    textAlign: 'center',
  },
  right: {
    textAlign: 'right',
  },
  bold: {
    fontWeight: 'bold',
  },
  hsCell: {
    width: TABLE_WIDTH,
    paddingTop: 2,
    paddingRight: 3,
    paddingBottom: 1,
    paddingLeft: 3,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hsText: {
    fontWeight: 'bold',
    marginTop: -3.4,
    textAlign: 'center',
  },
  itemNameEn: {
    fontSize: 6.9,
    fontWeight: 'bold',
    lineHeight: 1.05,
    marginTop: -2.15,
  },
  itemNameUa: {
    fontSize: 6.9,
    lineHeight: 1.05,
  },
  totalsLabelCell: {
    width: TOTALS_LABEL_WIDTH,
    paddingTop: 2,
    paddingRight: 3,
    paddingBottom: 2,
    paddingLeft: 3,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
    textAlign: 'right',
  },
  footer: {
    width: TABLE_WIDTH,
    alignSelf: 'center',
    marginTop: 10,
  },
  footerText: {
    textAlign: 'center',
    fontSize: 5.5,
    marginBottom: 3,
  },
  footerTextBold: {
    textAlign: 'center',
    fontSize: 5.5,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  deliveryBlock: {
    marginTop: 7,
  },
  signatureRow: {
    marginTop: 17,
    flexDirection: 'row',
    minHeight: 132,
  },
  signatureBlock: {
    width: '50%',
    alignItems: 'center',
  },
  signatureTitle: {
    fontSize: 5.4,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 2,
  },
  signatureLine: {
    fontSize: 5.2,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 2,
  },
  signatureName: {
    fontSize: 5.2,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyAssetSpace: {
    height: 84,
  },
  companyAssets: {
    height: 92,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

const columnStyles = {
  no: [styles.cell, styles.center, { width: COLS.no }],
  item: [styles.cell, { width: COLS.item }],
  measurement: [styles.cell, styles.center, { width: COLS.measurement }],
  quantity: [styles.cell, styles.center, { width: COLS.quantity }],
  price: [styles.cell, styles.right, { width: COLS.price }],
  total: [styles.cell, styles.right, { width: COLS.total }],
}

type SpecificationTableRow =
  | { type: 'group'; key: string; uktzed: string }
  | { type: 'item'; key: string; item: DocumentItem; number: number }

function isTransportExpense(expense: DocumentExpense) {
  const category = expense.category.trim().toLowerCase()
  const label = expense.label.trim().toLowerCase()

  return category === 'transport'
    || category === 'transport_cost'
    || category.includes('транспорт')
    || label.includes('транспорт')
    || label.includes('transport')
}

function formatUnitPrice(value: number) {
  return formatMoney(value)
    .replace(/,00$/, '')
    .replace(/(\,\d)0$/, '$1')
}

function buyerDirectorName(data: DocumentData) {
  return data.client.second_director_name_en
    || data.client.director_name
    || data.client.name
}

function sellerDirectorName(data: DocumentData) {
  return data.company.director_name_en
    || data.company.director_name_ua
}

function specificationAmountToWordsEn(value: number) {
  return amountToWordsEn(value).replace(/ hundred ([a-z-]+ euros)/i, ' hundred and $1')
}

function specificationPages(items: DocumentItem[]) {
  const groups = groupItemsByHsCode(items)
  const pages: SpecificationTableRow[][] = []
  let pageRows: SpecificationTableRow[] = []
  let pageItemCount = 0
  let number = 1

  for (const group of groups) {
    let groupAddedToPage = false

    for (const item of group.items) {
      if (pageItemCount >= ITEMS_PER_PAGE) {
        pages.push(pageRows)
        pageRows = []
        pageItemCount = 0
        groupAddedToPage = false
      }

      if (!groupAddedToPage) {
        pageRows.push({ type: 'group', key: `group-${group.uktzed}-${pages.length}-${number}`, uktzed: group.uktzed })
        groupAddedToPage = true
      }

      pageRows.push({
        type: 'item',
        key: `item-${group.uktzed}-${number}`,
        item,
        number,
      })
      pageItemCount += 1
      number += 1
    }
  }

  if (pageRows.length > 0) pages.push(pageRows)

  return pages
}

function Header({ number, date, contractNumber, contractDate }: {
  number: string
  date: string
  contractNumber: string
  contractDate: string
}) {
  return (
    <View style={styles.specHeader} wrap={false}>
      <Text style={styles.titleLine}>СПЕЦИФІКАЦІЯ № {number}</Text>
      <Text style={styles.subtitleLine}>Від {date}</Text>
      <Text style={styles.subtitleLine}>До Контракту № {contractNumber} від {contractDate}</Text>
      <Text style={[styles.titleLine, styles.englishTitleLine]}>SPECIFICATION No.{number}</Text>
      <Text style={styles.subtitleLine}>dd. {date}</Text>
      <Text style={styles.subtitleLine}>To Contract No. {contractNumber} dated {contractDate}</Text>
    </View>
  )
}

function TableHeader() {
  return (
    <View style={styles.headerRow} wrap={false}>
      <View style={[styles.cell, { width: COLS.no }, styles.headerCell]}>
        <Text style={[styles.headerText, styles.headerTextSingle]}>№</Text>
      </View>
      <View style={[styles.cell, { width: COLS.item }, styles.headerCell]}>
        <Text style={[styles.headerText, styles.headerTextItem]}>Item name{'\n'}(Найменування товару)</Text>
      </View>
      <View style={[styles.cell, { width: COLS.measurement }, styles.headerCell]}>
        <Text style={[styles.headerText, styles.headerTextMeasure]}>Measure-ment{'\n'}(Од. вим.)</Text>
      </View>
      <View style={[styles.cell, { width: COLS.quantity }, styles.headerCell]}>
        <Text style={styles.headerText}>Q-ty{'\n'}(Кіл-ть)</Text>
      </View>
      <View style={[styles.cell, { width: COLS.price }, styles.headerCell]}>
        <Text style={[styles.headerText, styles.headerTextAmount]}>Price in Euro{'\n'}(Ціна Євро)</Text>
      </View>
      <View style={[styles.cell, { width: COLS.total }, styles.headerCell]}>
        <Text style={[styles.headerText, styles.headerTextAmount]}>Total in Euro{'\n'}(Сума Євро)</Text>
      </View>
    </View>
  )
}

function SpecificationItemsTable({
  data,
  rows,
  showDocumentHeader,
  showTotals,
}: {
  data: DocumentData
  rows: SpecificationTableRow[]
  showDocumentHeader: boolean
  showTotals: boolean
}) {
  const transportTotal = data.expenses
    .filter(isTransportExpense)
    .reduce((sum, expense) => sum + expense.amount, 0)
  const otherExpenses = data.expenses.filter((expense) => !isTransportExpense(expense))

  return (
    <View>
      {showDocumentHeader && (
        <Header
          number={data.machine.specification_number || data.machine.name}
          date={formatDate(data.machine.specification_date)}
          contractNumber={data.contract?.number || ''}
          contractDate={formatDate(data.contract?.date)}
        />
      )}

      <View style={styles.table}>
        {showDocumentHeader && <TableHeader />}

        {rows.map((row, rowIndex) => {
          if (row.type === 'group') {
            const hsRowStyle = !showDocumentHeader && rowIndex === 0
              ? [styles.hsRow, styles.continuationHsRow]
              : styles.hsRow

            return (
              <View
                key={row.key}
                style={hsRowStyle}
                wrap={false}
              >
                <View style={styles.hsCell}>
                  <Text style={styles.hsText}>HS code (код УКТЗЕД) {row.uktzed}</Text>
                </View>
              </View>
            )
          }

          return (
            <View key={row.key} style={styles.tableRow} wrap={false}>
              <View style={[styles.cell, { width: COLS.no }, styles.itemRowCell, styles.itemRowCellCenter]}>
                <Text style={styles.itemRowText}>{row.number}</Text>
              </View>
              <View style={[styles.cell, { width: COLS.item }, styles.itemRowCell, styles.itemRowCellLeft]}>
                <Text style={styles.itemNameEn}>{row.item.product_name_en}</Text>
                <Text style={styles.itemNameUa}>{row.item.product_name_uk}</Text>
              </View>
              <View style={[styles.cell, { width: COLS.measurement }, styles.itemRowCell, styles.itemRowCellCenter]}>
                <Text style={styles.itemRowText}>Pcs/шт</Text>
              </View>
              <View style={[styles.cell, { width: COLS.quantity }, styles.itemRowCell, styles.itemRowCellCenter]}>
                <Text style={styles.itemRowText}>{formatQuantity(row.item.quantity)}</Text>
              </View>
              <View style={[styles.cell, { width: COLS.price }, styles.itemRowCell, styles.itemRowCellCenter]}>
                <Text style={styles.itemRowText}>{formatUnitPrice(row.item.price)}</Text>
              </View>
              <View style={[styles.cell, { width: COLS.total }, styles.itemRowCell, styles.itemRowCellCenter]}>
                <Text style={[styles.itemRowText, styles.itemRowTextTotal]}>{formatMoney(row.item.total)}</Text>
              </View>
            </View>
          )
        })}

        {showTotals && transportTotal > 0 && (
          <View style={styles.summaryRow} wrap={false}>
            <Text style={[styles.totalsLabelCell, styles.bold]}>Foreightcost/Транспорт</Text>
            <Text style={[styles.cell, styles.right, styles.bold, { width: COLS.total }]}>{formatMoney(transportTotal)}</Text>
          </View>
        )}

        {showTotals && otherExpenses.map((expense, index) => (
          <View key={`${expense.label}-${index}`} style={styles.summaryRow} wrap={false}>
            <Text style={styles.totalsLabelCell}>Additional expenses / Додаткові витрати: {expense.label}</Text>
            <Text style={columnStyles.total}>{formatMoney(expense.amount)}</Text>
          </View>
        ))}

        {showTotals && (
          <View style={styles.totalRow} wrap={false}>
            <Text style={[styles.totalsLabelCell, styles.bold]}>Total/Всього:</Text>
            <Text style={[styles.cell, styles.right, styles.bold, { width: COLS.total }]}>{formatMoney(data.totals.grand_total)}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

function Footer({ data }: { data: DocumentData }) {
  const deliveryCity = data.client.country_city || ''

  return (
    <View style={styles.footer} wrap={false}>
      <Text style={styles.footerTextBold}>Goods price includes packaging cost.</Text>
      <Text style={styles.footerText}>Ціна товару включає вартість упаковки (тари)</Text>
      <Text style={styles.footerTextBold}>{specificationAmountToWordsEn(data.totals.grand_total)}</Text>
      <Text style={styles.footerText}>{amountToWordsUa(data.totals.grand_total)}</Text>

      <View style={styles.deliveryBlock}>
        <Text style={styles.footerTextBold}>Delivery Basis: DAP - {deliveryCity}</Text>
        <Text style={styles.footerText}>Базис постачання: DAP - {deliveryCity}</Text>
      </View>

      <View style={styles.signatureRow}>
        <View style={styles.signatureBlock}>
          <Text style={styles.signatureTitle}>ПОКУПЕЦЬ / THE BUYER</Text>
          <Text style={styles.signatureLine}>Директор / Director</Text>
          <Text style={styles.signatureName}>{buyerDirectorName(data)}</Text>
          <View style={styles.emptyAssetSpace} />
        </View>
        <View style={styles.signatureBlock}>
          <Text style={styles.signatureTitle}>ПОКУПЕЦЬ / THE BUYER</Text>
          <Text style={styles.signatureLine}>Директор / Director</Text>
          <Text style={styles.signatureName}>{sellerDirectorName(data)}</Text>
          <View style={styles.companyAssets}>
            <PdfSignatureStampOverlay signatureSrc={data.signatureUrl} stampSrc={data.stampUrl} />
          </View>
        </View>
      </View>
    </View>
  )
}

export function SpecificationDocument({ data }: { data: DocumentData }) {
  const pages = specificationPages(data.items)
  const lastPageIndex = pages.length - 1

  return (
    <Document>
      {pages.map((rows, pageIndex) => (
        <Page key={`spec-page-${pageIndex}`} size="A4" style={styles.page}>
          <SpecificationItemsTable
            data={data}
            rows={rows}
            showDocumentHeader={pageIndex === 0}
            showTotals={pageIndex === lastPageIndex}
          />
          {pageIndex === lastPageIndex && <Footer data={data} />}
        </Page>
      ))}
    </Document>
  )
}
