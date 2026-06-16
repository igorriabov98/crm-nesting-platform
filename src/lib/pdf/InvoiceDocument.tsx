import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { DocumentData, DocumentExpense } from '@/lib/actions/document-generation'
import { PdfImage } from './components'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'
import { amountToWordsEn, amountToWordsUa, formatDate, formatMoney, formatQuantity, groupItemsByHsCode } from './format'

registerPdfFonts()

const styles = StyleSheet.create({
  page: {
    paddingTop: 52,
    paddingRight: 56,
    paddingBottom: 44,
    paddingLeft: 56,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 6.4,
    lineHeight: 1.15,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  borderedBlock: {
    borderWidth: 0.7,
    borderColor: '#111111',
  },
  row: {
    flexDirection: 'row',
  },
  topCellLeft: {
    width: '51%',
    minHeight: 72,
    padding: 3,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
  },
  topCellRight: {
    width: '49%',
    minHeight: 72,
    padding: 3,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
  },
  buyerCell: {
    width: '51%',
    minHeight: 72,
    padding: 3,
    borderRightWidth: 0.7,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
  },
  detailsCell: {
    width: '49%',
    minHeight: 72,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
  },
  detailsCellTop: {
    minHeight: 30,
    padding: 3,
    borderBottomWidth: 0.7,
    borderColor: '#111111',
  },
  detailsCellBottom: {
    minHeight: 42,
    padding: 3,
  },
  bankCell: {
    padding: 3,
  },
  label: {
    fontWeight: 'bold',
  },
  topBlockText: {
    fontSize: 7.8,
    fontWeight: 'bold',
    lineHeight: 1.32,
  },
  title: {
    marginTop: 2,
  },
  invoiceTitle: {
    marginTop: 18,
  },
  invoiceTitleGap: {
    height: 9,
  },
  invoiceDate: {
    textAlign: 'right',
  },
  mutedLine: {
    marginTop: 1,
  },
  table: {
    marginTop: 4,
    borderTopWidth: 0.7,
    borderLeftWidth: 0.7,
    borderColor: '#111111',
  },
  tableRow: {
    flexDirection: 'row',
    minHeight: 17,
  },
  tableHeader: {
    flexDirection: 'row',
    minHeight: 24,
    fontWeight: 'bold',
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
  center: {
    textAlign: 'center',
  },
  right: {
    textAlign: 'right',
  },
  bold: {
    fontWeight: 'bold',
  },
  groupCell: {
    width: '100%',
    fontWeight: 'bold',
  },
  itemNo: {
    width: '7%',
  },
  itemName: {
    width: '44%',
  },
  measurement: {
    width: '13%',
  },
  quantity: {
    width: '9%',
  },
  price: {
    width: '13%',
  },
  total: {
    width: '14%',
  },
  totalsLabel: {
    width: '86%',
    fontWeight: 'bold',
  },
  itemNameEn: {
    fontWeight: 'bold',
  },
  footer: {
    marginTop: 8,
  },
  words: {
    marginTop: 4,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  wordsUa: {
    marginTop: 2,
    textAlign: 'center',
    fontSize: 5.8,
  },
  signatureRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  signatureLeft: {
    width: '38%',
  },
  stampWrap: {
    width: '24%',
    alignItems: 'center',
    marginTop: -8,
  },
  signatureRight: {
    width: '38%',
    paddingTop: 14,
    alignItems: 'flex-end',
  },
})

const COLS = {
  no: [styles.cell, styles.center, styles.itemNo],
  name: [styles.cell, styles.itemName],
  measurement: [styles.cell, styles.center, styles.measurement],
  quantity: [styles.cell, styles.center, styles.quantity],
  price: [styles.cell, styles.right, styles.price],
  total: [styles.cell, styles.right, styles.total],
}

function isTransportExpense(expense: DocumentExpense) {
  const category = expense.category.trim().toLowerCase()
  return category === 'транспорт' || category === 'transport' || category.includes('транспорт')
}

function formatSellerName(name: string) {
  const baseName = name
    .trim()
    .replace(/\s+LLC\.?$/i, '')
    .replace(/^["«]+/, '')
    .replace(/["»]+$/, '')
    .trim()

  return baseName ? `«${baseName}» LLC` : ''
}

function buyerAddressLines(address: string, clientName: string) {
  let value = address.trim()
  if (!value) return []

  const normalizedClientName = clientName.trim()
  if (normalizedClientName && value.toLowerCase().startsWith(normalizedClientName.toLowerCase())) {
    value = value.slice(normalizedClientName.length).replace(/^[\s,]+/, '').trim()
  }

  const explicitLines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (explicitLines.length > 1) return explicitLines

  const postalMatch = /^(.+?)\s+(\d{4,6}\s+[^,]+),\s*(.+)$/.exec(value)
  if (postalMatch) {
    return [postalMatch[1], `${postalMatch[2]},`, postalMatch[3]]
  }

  const commaParts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (commaParts.length >= 3) {
    return [
      commaParts.slice(0, -2).join(', '),
      `${commaParts.at(-2)},`,
      commaParts.at(-1) || '',
    ].filter(Boolean)
  }

  return [value]
}

function deliveryBasisLine(prefix: string, location: string) {
  const cleanPrefix = prefix.trim()
  const cleanLocation = location.trim()
  if (!cleanPrefix) return cleanLocation
  if (!cleanLocation) return cleanPrefix
  return `${cleanPrefix} - ${cleanLocation}`
}

function rowNumberFor(groups: ReturnType<typeof groupItemsByHsCode>, groupIndex: number, itemIndex: number) {
  return groups
    .slice(0, groupIndex)
    .reduce((sum, group) => sum + group.items.length, 0) + itemIndex + 1
}

function TableHeader() {
  return (
    <View style={styles.tableHeader} fixed>
      <Text style={COLS.no}>№</Text>
      <Text style={COLS.name}>Item name{'\n'}(Найменування товару)</Text>
      <Text style={COLS.measurement}>Measure-ment{'\n'}(Од. вим.)</Text>
      <Text style={COLS.quantity}>Q-ty{'\n'}(Кіл-ть)</Text>
      <Text style={COLS.price}>Price in Euro{'\n'}(Ціна Євро)</Text>
      <Text style={COLS.total}>Total in Euro{'\n'}(Сума Євро)</Text>
    </View>
  )
}

function InvoiceItemsTable({ data }: { data: DocumentData }) {
  const groups = groupItemsByHsCode(data.items)
  const transportTotal = data.expenses
    .filter(isTransportExpense)
    .reduce((sum, expense) => sum + expense.amount, 0)
  const otherExpenses = data.expenses.filter((expense) => !isTransportExpense(expense))

  return (
    <View style={styles.table}>
      <TableHeader />

      {groups.map((group, groupIndex) => (
        <View key={group.uktzed}>
          <View style={styles.tableRow} wrap={false}>
            <Text style={[styles.cell, styles.groupCell]}>HS code (код УКТЗЕД) {group.uktzed}</Text>
          </View>

          {group.items.map((item, itemIndex) => {
            const currentNumber = rowNumberFor(groups, groupIndex, itemIndex)

            return (
              <View key={`${group.uktzed}-${currentNumber}`} style={styles.tableRow} wrap={false}>
                <Text style={COLS.no}>{currentNumber}</Text>
                <View style={COLS.name}>
                  <Text style={styles.itemNameEn}>{item.product_name_en}</Text>
                  <Text>{item.product_name_uk}</Text>
                </View>
                <Text style={COLS.measurement}>Pcs/шт</Text>
                <Text style={COLS.quantity}>{formatQuantity(item.quantity)}</Text>
                <Text style={COLS.price}>{formatMoney(item.price)}</Text>
                <Text style={COLS.total}>{formatMoney(item.total)}</Text>
              </View>
            )
          })}
        </View>
      ))}

      {transportTotal > 0 && (
        <View style={styles.tableRow} wrap={false}>
          <Text style={[styles.cell, { width: '86%' }]}>Foreightcost/Транспорт</Text>
          <Text style={COLS.total}>{formatMoney(transportTotal)}</Text>
        </View>
      )}

      {otherExpenses.map((expense, index) => (
        <View key={`${expense.label}-${index}`} style={styles.tableRow} wrap={false}>
          <Text style={[styles.cell, { width: '86%' }]}>Additional expenses / Додаткові витрати: {expense.label}</Text>
          <Text style={COLS.total}>{formatMoney(expense.amount)}</Text>
        </View>
      ))}

      <View style={styles.tableRow} wrap={false}>
        <Text style={[styles.cell, styles.totalsLabel]}>Total/Всього:</Text>
        <Text style={[styles.cell, styles.right, styles.bold, styles.total]}>{formatMoney(data.totals.grand_total)}</Text>
      </View>
    </View>
  )
}

export function InvoiceDocument({ data }: { data: DocumentData }) {
  const number = data.machine.specification_number || data.machine.name
  const date = formatDate(data.machine.specification_date)
  const contractNumber = data.contract?.number || ''
  const contractDate = formatDate(data.contract?.date)
  const deliveryLocationEn = data.client.delivery_basis_location_en || data.client.country_city || ''
  const deliveryLocationUa = data.client.delivery_basis_location_ua || data.client.delivery_basis_location_en || data.client.country_city || ''
  const deliveryBasisEn = deliveryBasisLine(data.company.delivery_basis_en, deliveryLocationEn)
  const deliveryBasisUa = deliveryBasisLine(data.company.delivery_basis_ua, deliveryLocationUa)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.borderedBlock} wrap={false}>
          <View style={styles.row}>
            <View style={styles.topCellLeft}>
              <Text style={styles.topBlockText}>Seller/Продавець</Text>
              <Text style={styles.topBlockText}>{formatSellerName(data.company.name_en)}</Text>
              <Text style={styles.topBlockText}>{data.company.address_en}</Text>
            </View>
            <View style={styles.topCellRight}>
              <Text style={[styles.topBlockText, styles.invoiceDate]}>Date/Дата {date}</Text>
              <Text style={[styles.topBlockText, styles.invoiceTitle]}>INVOICE № {number}</Text>
              <View style={styles.invoiceTitleGap} />
              <Text style={[styles.topBlockText, styles.title]}>РАХУНОК-ФАКТУРА № {number}</Text>
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.buyerCell}>
              <Text style={styles.topBlockText}>Buyer/Payer/Consignee</Text>
              <Text style={styles.topBlockText}>Покупець/Платник/Вантажоотримувач</Text>
              <Text style={styles.topBlockText}>{data.client.name}</Text>
              {buyerAddressLines(data.client.address, data.client.name).map((line) => (
                <Text key={line} style={styles.topBlockText}>{line}</Text>
              ))}
            </View>
            <View style={styles.detailsCell}>
              <View style={styles.detailsCellTop}>
                <Text style={styles.topBlockText}>Contract / Контракт {contractNumber} від {contractDate}</Text>
                <Text style={styles.topBlockText}>Specification/ Специфікація {number} від {date}</Text>
              </View>
              <View style={styles.detailsCellBottom}>
                <Text style={styles.topBlockText}>{deliveryBasisEn}</Text>
                <Text style={styles.topBlockText}>{deliveryBasisUa}</Text>
                <Text style={styles.topBlockText}>The country of origin: Ukraine</Text>
                <Text style={styles.topBlockText}>Країна походження: Україна</Text>
              </View>
            </View>
          </View>

          <View style={styles.bankCell}>
            <Text style={styles.topBlockText}>Bank details/Банківські реквізити:</Text>
            <Text style={styles.topBlockText}>Legal entity: {data.company.name_en}</Text>
            <Text style={styles.topBlockText}>Enterprise code: {data.company.enterprise_code}</Text>
            <Text style={styles.topBlockText}>Currency of account: EUR</Text>
            <Text style={styles.topBlockText}>IBAN: {data.company.iban}</Text>
            <Text style={styles.topBlockText}>Bank name: {data.company.bank_name}</Text>
            <Text style={styles.topBlockText}>Beneficiary bank: {data.company.bank_address}</Text>
            <Text style={styles.topBlockText}>SWIFT code: {data.company.swift}</Text>
            <Text style={styles.topBlockText}>Intermediary bank: {data.company.intermediary_bank_name}</Text>
            <Text style={styles.topBlockText}>SWIFT code: {data.company.intermediary_bank_swift}</Text>
          </View>
        </View>

        <InvoiceItemsTable data={data} />

        <View style={styles.footer} wrap={false}>
          <Text style={styles.words}>{amountToWordsEn(data.totals.grand_total)}</Text>
          <Text style={styles.wordsUa}>{amountToWordsUa(data.totals.grand_total)}</Text>

          <View style={styles.signatureRow}>
            <View style={styles.signatureLeft}>
              <Text>Director</Text>
              <Text>«{data.company.name_en}»</Text>
              <Text>Директор</Text>
              <Text>{data.company.name_ua}</Text>
            </View>
            <View style={styles.stampWrap}>
              <PdfImage src={data.stampUrl} type="stamp" />
            </View>
            <View style={styles.signatureRight}>
              <Text>{data.company.director_name_en}</Text>
              <Text>{data.company.director_name_ua}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  )
}
