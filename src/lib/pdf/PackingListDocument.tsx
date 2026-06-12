import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { DocumentData } from '@/lib/actions/document-generation'
import { PackingItemsTable, PdfImage } from './components'
import { formatDate, packingSummary } from './format'
import { pdfStyles } from './styles'

export function PackingListDocument({ data }: { data: DocumentData }) {
  const number = data.machine.specification_number || data.machine.name
  const date = formatDate(data.machine.specification_date)
  const contractNumber = data.contract?.number || ''
  const contractDate = formatDate(data.contract?.date)
  const packingDescription = packingSummary(data.items) || '-'

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={pdfStyles.page}>
        <View style={pdfStyles.header}>
          <View style={pdfStyles.headerColumn}>
            <Text style={pdfStyles.title}>Packing list № {number}</Text>
            <Text style={pdfStyles.title}>Пакувальний лист № {number}</Text>
            <Text>Date/Дата {date}</Text>
          </View>
          <View style={pdfStyles.headerColumnRight}>
            <Text>Contract / Контракт {contractNumber} від {contractDate}</Text>
            <Text>Specification / Специфікація {number} від {date}</Text>
            <Text>Delivery Basis: DAP – {data.client.country_city}</Text>
            <Text>The country of origin: Ukraine</Text>
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text>Consignor / Відправник: {data.company.name_en}, {data.company.address_en}</Text>
          <Text>Recipient / Отримувач: {data.client.name}, {data.client.address}</Text>
        </View>

        <PackingItemsTable data={data} />

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.note}>TOTAL: {data.totals.total_places} places: {packingDescription}</Text>
          <Text>ВСЬОГО: {data.totals.total_places} місць: {packingDescription}</Text>
        </View>

        <View style={pdfStyles.signatureRow}>
          <View style={pdfStyles.signatureBlock}>
            <Text>Director «{data.company.name_en}» / {data.company.director_name_en}</Text>
            <Text>Директор ТОВ «{data.company.name_ua}» / {data.company.director_name_ua}</Text>
          </View>
          <View style={pdfStyles.signatureBlockRight}>
            <PdfImage src={data.stampUrl} type="stamp" />
          </View>
        </View>
      </Page>
    </Document>
  )
}
