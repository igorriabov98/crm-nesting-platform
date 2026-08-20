import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  formatPdfNumber,
  longStockBarComposition,
  type LongStockCuttingPlanPdfBar,
  type LongStockCuttingPlanPdfData,
} from '@/lib/long-stock-cutting-plan-pdf'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'

registerPdfFonts()

const CUT_SHADES = ['#374151', '#6b7280', '#9ca3af', '#4b5563', '#737373']
const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 30,
    paddingBottom: 58,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 8.5,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 19, fontWeight: 'bold', letterSpacing: 0.3 },
  version: { marginTop: 2, fontSize: 11, fontWeight: 'bold' },
  generated: { textAlign: 'right', fontSize: 8.5, lineHeight: 1.4 },
  metaGrid: { marginTop: 12, flexDirection: 'row', borderWidth: 0.8, borderColor: '#222222' },
  metaColumn: { width: '50%', padding: 7 },
  metaColumnRight: { width: '50%', padding: 7, borderLeftWidth: 0.8, borderColor: '#222222' },
  metaLine: { marginBottom: 3, lineHeight: 1.3 },
  label: { fontWeight: 'bold' },
  material: { marginTop: 8, borderWidth: 1, borderColor: '#111111', padding: 8 },
  materialName: { fontSize: 11, fontWeight: 'bold', marginBottom: 3 },
  sectionTitle: { marginTop: 12, marginBottom: 5, fontSize: 10, fontWeight: 'bold' },
  barBlock: { marginTop: 7, borderWidth: 0.8, borderColor: '#222222', padding: 7 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barTitle: { fontSize: 9.5, fontWeight: 'bold' },
  strip: { flexDirection: 'row', height: 27, borderWidth: 0.8, borderColor: '#111111', backgroundColor: '#eeeeee' },
  stripSegment: { justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderRightWidth: 0.8, borderRightColor: '#ffffff' },
  stripTextLight: { color: '#ffffff', fontSize: 6.5, fontWeight: 'bold' },
  stripTextDark: { color: '#111111', fontSize: 6.5, fontWeight: 'bold' },
  cuts: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap' },
  cut: { width: '25%', marginBottom: 2 },
  remainder: { marginTop: 4, fontWeight: 'bold' },
  table: { borderTopWidth: 0.8, borderLeftWidth: 0.8, borderColor: '#222222' },
  tableRow: { flexDirection: 'row', minHeight: 20 },
  tableHeader: { backgroundColor: '#e5e7eb', fontWeight: 'bold' },
  cell: { padding: 4, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: '#222222' },
  totalLength: { width: '65%' },
  totalQuantity: { width: '35%', textAlign: 'center' },
  remnantBar: { width: '22%', textAlign: 'center' },
  remnantCalculated: { width: '34%', textAlign: 'center' },
  remnantActual: { width: '44%' },
  actualLine: { marginHorizontal: 8, marginTop: 7, borderBottomWidth: 0.8, borderColor: '#111111' },
  footer: {
    position: 'absolute',
    left: 30,
    right: 30,
    bottom: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureField: { flexDirection: 'row', alignItems: 'flex-end', width: '30%' },
  signatureLabel: { marginRight: 5, fontWeight: 'bold' },
  signatureLine: { flex: 1, height: 12, borderBottomWidth: 0.8, borderColor: '#111111' },
  pageNumber: { position: 'absolute', right: 30, bottom: 7, color: '#555555', fontSize: 7 },
})

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Europe/Kyiv',
})

function barLengthShade(lengthMm: number, allLengths: number[]) {
  const unique = Array.from(new Set(allLengths)).sort((left, right) => right - left)
  return CUT_SHADES[unique.indexOf(lengthMm) % CUT_SHADES.length]
}

function widthPercent(lengthMm: number, stockLengthMm: number) {
  return `${Math.max(lengthMm, 0) / stockLengthMm * 100}%`
}

function BarStrip({ bar, kerfMm, endTrimMm, cutLengths }: {
  bar: LongStockCuttingPlanPdfBar
  kerfMm: number
  endTrimMm: number
  cutLengths: number[]
}) {
  return (
    <View style={styles.strip}>
      {endTrimMm > 0 && <View style={[styles.stripSegment, { width: widthPercent(endTrimMm, bar.stockLengthMm), backgroundColor: '#1f2937' }]} />}
      {bar.cuts.map((cut) => {
        const ratio = cut.lengthMm / bar.stockLengthMm
        return (
          <View key={cut.cutNumber} style={[styles.stripSegment, {
            width: widthPercent(cut.lengthMm, bar.stockLengthMm),
            backgroundColor: barLengthShade(cut.lengthMm, cutLengths),
          }]}>
            {ratio >= 0.09 && <Text style={styles.stripTextLight}>№{cut.cutNumber} · {formatPdfNumber(cut.lengthMm)}</Text>}
          </View>
        )
      }).flatMap((cutView, index) => [
        cutView,
        ...(kerfMm > 0 ? [<View key={`kerf-${index}`} style={{ width: widthPercent(kerfMm, bar.stockLengthMm), backgroundColor: '#000000' }} />] : []),
      ])}
      {bar.remainderMm > 0 && (
        <View style={[styles.stripSegment, { width: widthPercent(bar.remainderMm, bar.stockLengthMm), backgroundColor: '#d1d5db' }]}>
          {bar.remainderMm / bar.stockLengthMm >= 0.09 && <Text style={styles.stripTextDark}>Остаток {formatPdfNumber(bar.remainderMm)}</Text>}
        </View>
      )}
    </View>
  )
}

function BarBlock({ bar, data, cutLengths }: {
  bar: LongStockCuttingPlanPdfBar
  data: LongStockCuttingPlanPdfData
  cutLengths: number[]
}) {
  return (
    <View style={styles.barBlock} wrap={false}>
      <View style={styles.barHeader}>
        <Text style={styles.barTitle}>Хлыст №{bar.barNumber}</Text>
        <Text><Text style={styles.label}>Длина:</Text> {formatPdfNumber(bar.stockLengthMm)} мм</Text>
      </View>
      <BarStrip bar={bar} kerfMm={data.kerfMm} endTrimMm={data.endTrimMm} cutLengths={cutLengths} />
      <View style={styles.cuts}>
        {bar.cuts.map((cut) => <Text key={cut.cutNumber} style={styles.cut}>№{cut.cutNumber}: {formatPdfNumber(cut.lengthMm)} мм</Text>)}
      </View>
      <Text style={styles.remainder}>Расчётный остаток: {formatPdfNumber(bar.remainderMm)} мм</Text>
    </View>
  )
}

export function LongStockCuttingPlanDocument({ data }: { data: LongStockCuttingPlanPdfData }) {
  const barComposition = longStockBarComposition(data.bars)
  const cutLengths = data.bars.flatMap((bar) => bar.cuts.map((cut) => cut.lengthMm))
  return (
    <Document title={`Карта раскроя №${data.planNumber}, версия ${data.versionNumber}`}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.titleRow} wrap={false}>
          <View>
            <Text style={styles.title}>КАРТА РАСКРОЯ №{data.planNumber}</Text>
            <Text style={styles.version}>Версия {data.versionNumber}</Text>
          </View>
          <View>
            <Text style={styles.generated}>Сформирована</Text>
            <Text style={styles.generated}>{dateTimeFormatter.format(new Date(data.generatedAt))}</Text>
          </View>
        </View>

        <View style={styles.metaGrid} wrap={false}>
          <View style={styles.metaColumn}>
            <Text style={styles.metaLine}><Text style={styles.label}>Заявка:</Text> №{data.requestNumber}</Text>
            <Text style={styles.metaLine}><Text style={styles.label}>Завод:</Text> {data.factoryName}</Text>
            <Text><Text style={styles.label}>Технолог:</Text> {data.technologistName}</Text>
          </View>
          <View style={styles.metaColumnRight}>
            <Text style={styles.metaLine}><Text style={styles.label}>Пропил:</Text> {formatPdfNumber(data.kerfMm)} мм</Text>
            <Text style={styles.metaLine}><Text style={styles.label}>Торцовка:</Text> {formatPdfNumber(data.endTrimMm)} мм</Text>
            <Text><Text style={styles.label}>Хлысты:</Text> {barComposition.map((entry) => `${formatPdfNumber(entry.lengthMm)} × ${entry.quantity}`).join(' + ')}</Text>
          </View>
        </View>

        <View style={styles.material} wrap={false}>
          <Text style={styles.materialName}>{data.materialName}</Text>
          <Text style={styles.metaLine}><Text style={styles.label}>Вариант:</Text> {data.materialVariantLabel}</Text>
          <Text style={styles.metaLine}><Text style={styles.label}>Тип металла:</Text> {data.metalType}</Text>
          {data.knifeBevel && <Text><Text style={styles.label}>Скос:</Text> {data.knifeBevel}</Text>}
        </View>

        <Text style={styles.sectionTitle}>Раскладка по хлыстам</Text>
        {data.bars.map((bar) => <BarBlock key={bar.barNumber} bar={bar} data={data} cutLengths={cutLengths} />)}

        <View wrap={false}>
          <Text style={styles.sectionTitle}>Итого заготовок</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cell, styles.totalLength]}>Длина заготовки</Text>
              <Text style={[styles.cell, styles.totalQuantity]}>Количество</Text>
            </View>
            {data.totals.map((entry) => (
              <View key={entry.lengthMm} style={styles.tableRow}>
                <Text style={[styles.cell, styles.totalLength]}>{formatPdfNumber(entry.lengthMm)} мм</Text>
                <Text style={[styles.cell, styles.totalQuantity]}>{entry.quantity} шт.</Text>
              </View>
            ))}
          </View>
        </View>

        <View wrap={false}>
          <Text style={styles.sectionTitle}>Остатки для маркировки</Text>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cell, styles.remnantBar]}>Хлыст</Text>
              <Text style={[styles.cell, styles.remnantCalculated]}>Расчётная длина</Text>
              <Text style={[styles.cell, styles.remnantActual]}>Фактическая длина</Text>
            </View>
            {data.bars.map((bar) => (
              <View key={bar.barNumber} style={styles.tableRow}>
                <Text style={[styles.cell, styles.remnantBar]}>№{bar.barNumber}</Text>
                <Text style={[styles.cell, styles.remnantCalculated]}>{formatPdfNumber(bar.remainderMm)} мм</Text>
                <View style={[styles.cell, styles.remnantActual]}><View style={styles.actualLine} /></View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.footer} fixed>
          {['Резал', 'Дата', 'Подпись'].map((label) => (
            <View key={label} style={styles.signatureField}><Text style={styles.signatureLabel}>{label}</Text><View style={styles.signatureLine} /></View>
          ))}
        </View>
        <Text style={styles.pageNumber} fixed render={({ pageNumber, totalPages }) => `Карта №${data.planNumber} · версия ${data.versionNumber} · Страница ${pageNumber} из ${totalPages}`} />
      </Page>
    </Document>
  )
}
