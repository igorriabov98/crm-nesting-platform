import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { DocumentData } from '@/lib/actions/document-generation'
import { CommercialItemsTable, PdfImage } from './components'
import { amountToWordsEn, amountToWordsUa, formatDate } from './format'
import { pdfStyles } from './styles'

export function SpecificationDocument({ data }: { data: DocumentData }) {
  const number = data.machine.specification_number || data.machine.name
  const date = formatDate(data.machine.specification_date)
  const contractNumber = data.contract?.number || ''
  const contractDate = formatDate(data.contract?.date)

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={pdfStyles.page}>
        <View style={pdfStyles.header}>
          <View style={pdfStyles.headerColumn}>
            <Text style={pdfStyles.title}>СПЕЦИФІКАЦІЯ № {number} Від {date}</Text>
            <Text style={pdfStyles.subtitle}>До Контракту № {contractNumber} від {contractDate}</Text>
          </View>
          <View style={pdfStyles.headerColumnRight}>
            <Text style={pdfStyles.title}>SPECIFICATION No.{number} dd. {date}</Text>
            <Text style={pdfStyles.subtitle}>To Contract No.{contractNumber} dated {contractDate}</Text>
          </View>
        </View>

        <CommercialItemsTable data={data} />

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.note}>{amountToWordsEn(data.totals.grand_total)}</Text>
          <Text style={pdfStyles.note}>{amountToWordsUa(data.totals.grand_total)}</Text>
          <Text style={pdfStyles.note}>Delivery Basis: DAP – {data.client.country_city}</Text>
          <Text>Базис постачання: DAP – {data.client.country_city}</Text>
        </View>

        <View style={pdfStyles.signatureRow}>
          <View style={pdfStyles.signatureBlock}>
            <Text style={pdfStyles.sectionTitle}>ПОКУПЕЦЬ / THE BUYER</Text>
            <Text>Директор / Director</Text>
            <Text>{data.client.second_director_name_en}</Text>
            <PdfImage src={data.signatureUrl} type="signature" />
            <Text>{data.client.name}</Text>
            <Text style={pdfStyles.smallText}>{data.client.address}</Text>
          </View>
          <View style={pdfStyles.signatureBlockRight}>
            <Text style={pdfStyles.sectionTitle}>ПОКУПЕЦЬ / THE BUYER</Text>
            <Text>Директор / Director</Text>
            <Text>{data.client.director_name}</Text>
            <PdfImage src={data.stampUrl} type="stamp" />
          </View>
        </View>
      </Page>
    </Document>
  )
}
