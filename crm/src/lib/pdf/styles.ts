import { StyleSheet } from '@react-pdf/renderer'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'

registerPdfFonts()

export const PDF_COLORS = {
  tableHeader: '#1e40af',
  rowStripe: '#f0f4ff',
  white: '#ffffff',
  text: '#111827',
  border: '#d1d5db',
  group: '#f3f4f6',
}

export const pdfStyles = StyleSheet.create({
  page: {
    padding: 20,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 8,
    color: PDF_COLORS.text,
    backgroundColor: PDF_COLORS.white,
  },
  row: {
    flexDirection: 'row',
  },
  header: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  headerColumn: {
    flex: 1,
    paddingRight: 10,
  },
  headerColumnRight: {
    flex: 1,
    paddingLeft: 10,
  },
  title: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 9,
    marginBottom: 2,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  table: {
    width: '100%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: PDF_COLORS.border,
    marginTop: 8,
  },
  tableRow: {
    flexDirection: 'row',
    minHeight: 22,
  },
  tableHeader: {
    flexDirection: 'row',
    minHeight: 24,
    backgroundColor: PDF_COLORS.tableHeader,
    color: PDF_COLORS.white,
    fontWeight: 'bold',
  },
  tableGroupRow: {
    flexDirection: 'row',
    minHeight: 18,
    backgroundColor: PDF_COLORS.group,
  },
  stripedRow: {
    backgroundColor: PDF_COLORS.rowStripe,
  },
  cell: {
    padding: 4,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: PDF_COLORS.border,
  },
  cellCenter: {
    textAlign: 'center',
  },
  cellRight: {
    textAlign: 'right',
  },
  cellBold: {
    fontWeight: 'bold',
  },
  itemNameEn: {
    fontWeight: 'bold',
  },
  note: {
    marginTop: 6,
    lineHeight: 1.3,
  },
  bankDetails: {
    marginTop: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
  },
  signatureRow: {
    flexDirection: 'row',
    marginTop: 14,
  },
  signatureBlock: {
    flex: 1,
    minHeight: 92,
    paddingRight: 18,
  },
  signatureBlockRight: {
    flex: 1,
    minHeight: 92,
    paddingLeft: 18,
  },
  signatureImage: {
    width: 110,
    height: 42,
    objectFit: 'contain',
    marginTop: 6,
    marginBottom: 4,
  },
  stampImage: {
    width: 86,
    height: 86,
    objectFit: 'contain',
    marginTop: 2,
  },
  smallText: {
    fontSize: 7,
  },
})

export const tableWidths = {
  no: { width: '5%' },
  item: { width: '45%' },
  measurement: { width: '12%' },
  quantity: { width: '10%' },
  price: { width: '14%' },
  total: { width: '14%' },
  netWeight: { width: '14%' },
  packingType: { width: '16%' },
  places: { width: '8%' },
}
