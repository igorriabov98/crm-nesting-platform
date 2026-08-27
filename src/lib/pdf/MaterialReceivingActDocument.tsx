import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { MaterialReceivingActData, MaterialReceivingActItem } from '@/lib/material-receiving-act'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'

registerPdfFonts()

const COLORS = {
  ink: '#0F172A',
  primary: '#1B3A6B',
  accent: '#2563EB',
  slate: '#475569',
  muted: '#64748B',
  surface: '#F8FAFC',
  border: '#D7DEE8',
  white: '#FFFFFF',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 26,
    paddingHorizontal: 28,
    paddingBottom: 38,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 8,
    lineHeight: 1.35,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },
  eyebrow: { fontSize: 7, fontWeight: 'bold', color: COLORS.accent, letterSpacing: 1.1, textTransform: 'uppercase' },
  titleRow: { marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 18, fontWeight: 'bold', lineHeight: 1.1, color: COLORS.primary, letterSpacing: -0.2 },
  subtitle: { marginTop: 8, fontSize: 8.5, color: COLORS.slate },
  documentMark: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 3, backgroundColor: COLORS.primary },
  documentMarkText: { fontSize: 7, fontWeight: 'bold', color: COLORS.white, letterSpacing: 0.6 },
  accentLine: { marginTop: 10, height: 2, backgroundColor: COLORS.accent },
  metaGrid: { marginTop: 10, flexDirection: 'row' },
  metaCard: { width: '32%', marginRight: '2%', padding: 8, borderRadius: 3, backgroundColor: COLORS.surface },
  metaCardLast: { width: '32%', padding: 8, borderRadius: 3, backgroundColor: COLORS.surface },
  metaLabel: { fontSize: 6.5, fontWeight: 'bold', color: COLORS.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  metaValue: { marginTop: 3, fontSize: 10, fontWeight: 'bold', color: COLORS.primary },
  metaSecondary: { marginTop: 2, fontSize: 7, color: COLORS.slate },
  sectionHeader: { marginTop: 13, marginBottom: 5, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', color: COLORS.primary },
  sectionMeta: { fontSize: 7, color: COLORS.muted },
  table: { marginTop: 1 },
  tableRow: { marginBottom: 7, padding: 8, borderWidth: 0.7, borderColor: COLORS.border, borderRadius: 4, backgroundColor: COLORS.white },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemTitle: { width: '72%' },
  itemPlan: { width: '25%', paddingLeft: 8, borderLeftWidth: 0.7, borderLeftColor: COLORS.border, textAlign: 'right' },
  itemPlanLabel: { fontSize: 6.2, fontWeight: 'bold', color: COLORS.muted, letterSpacing: 0.35, textTransform: 'uppercase' },
  itemDetailRow: { marginTop: 6, paddingTop: 6, borderTopWidth: 0.7, borderTopColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between' },
  itemCharacteristics: { width: '59%', paddingRight: 8 },
  itemMeta: { width: '41%', paddingLeft: 8, borderLeftWidth: 0.7, borderLeftColor: COLORS.border },
  bodyStrong: { fontSize: 7.6, fontWeight: 'bold', color: COLORS.ink },
  body: { fontSize: 7.2, color: COLORS.slate },
  bodySmall: { marginTop: 2, fontSize: 6.4, color: COLORS.muted },
  bodyAccent: { marginTop: 2, fontSize: 6.4, fontWeight: 'bold', color: COLORS.accent },
  tabular: { fontSize: 7.2, fontWeight: 'bold', color: COLORS.ink },
  summary: { marginTop: 12, padding: 10, borderWidth: 0.8, borderColor: COLORS.border, borderRadius: 4, backgroundColor: COLORS.surface },
  summaryTitle: { fontSize: 10, fontWeight: 'bold', color: COLORS.primary },
  orderGrid: { marginTop: 7, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  orderCard: { width: '49%', marginBottom: 6, padding: 7, borderLeftWidth: 2, borderLeftColor: COLORS.accent, backgroundColor: COLORS.white },
  orderName: { fontSize: 7.5, fontWeight: 'bold', color: COLORS.ink },
  orderMeta: { marginTop: 2, fontSize: 6.5, color: COLORS.muted },
  summaryBottom: { marginTop: 4, paddingTop: 7, borderTopWidth: 0.7, borderTopColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between' },
  summaryDate: { fontSize: 7.2, fontWeight: 'bold', color: COLORS.primary },
  signatureRow: { marginTop: 13, flexDirection: 'row', justifyContent: 'space-between' },
  signatureField: { width: '31%', flexDirection: 'row', alignItems: 'flex-end' },
  signatureLabel: { marginRight: 5, fontSize: 7, fontWeight: 'bold', color: COLORS.slate },
  signatureLine: { flex: 1, height: 10, borderBottomWidth: 0.7, borderBottomColor: COLORS.slate },
  footer: { marginTop: 'auto', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 6.2, color: COLORS.muted },
  footerPage: { width: 90, fontSize: 6.2, color: COLORS.muted, textAlign: 'right' },
})

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Kyiv',
})

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

function formatDeliveryDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`))
}

function formatNumber(value: number) {
  return numberFormatter.format(value)
}

function pluralRu(value: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(value) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 19) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

function specificationLabel(value: string | null) {
  return value ? `Спецификация № ${value}` : 'Без номера спецификации'
}

function barsLabel(item: MaterialReceivingActItem) {
  if (item.plannedBars.length === 0) return null
  return item.plannedBars.map((bar) => (
    `${formatNumber(bar.lengthMm)} мм × ${formatNumber(bar.pieceCount)} шт${bar.isNonstandard ? ' (нестандарт)' : ''}`
  )).join(' + ')
}

function MaterialRow({ item, index }: { item: MaterialReceivingActItem; index: number }) {
  const bars = barsLabel(item)
  return (
    <View style={styles.tableRow} wrap={false}>
      <View style={styles.itemTop}>
        <View style={styles.itemTitle}>
          <Text style={styles.bodyStrong}>{index + 1}. {item.materialName}</Text>
          <Text style={styles.bodySmall}>{item.categoryLabel}</Text>
          {item.isVirtualSchedule && <Text style={styles.bodyAccent}>Дата без отдельного графика</Text>}
        </View>
        <View style={styles.itemPlan}>
          <Text style={styles.itemPlanLabel}>План к приёмке</Text>
          <Text style={styles.tabular}>{formatNumber(item.plannedQuantity)} {item.unit}</Text>
          <Text style={styles.bodySmall}>
            {item.plannedWeightKg === null ? 'Вес не указан' : `${formatNumber(item.plannedWeightKg)} кг`}
          </Text>
        </View>
      </View>
      <View style={styles.itemDetailRow}>
        <View style={styles.itemCharacteristics}>
        {item.characteristics.length > 0
          ? item.characteristics.map((part) => (
              <Text key={`${item.key}:${part.label}:${part.value}`} style={styles.body}>
                <Text style={styles.bodyStrong}>{part.label}:</Text> {part.value}
              </Text>
            ))
          : <Text style={styles.bodySmall}>Характеристики не указаны</Text>}
        {bars && <Text style={styles.bodyAccent}>Заказано хлыстов: {bars}</Text>}
        </View>
        <View style={styles.itemMeta}>
          <Text style={styles.bodySmall}>Поставщик</Text>
          <Text style={styles.body}>{item.supplierName}</Text>
          <Text style={[styles.bodySmall, { marginTop: 4 }]}>Для заказа</Text>
          <Text style={styles.bodyStrong}>{item.orderName}</Text>
          <Text style={styles.bodySmall}>{specificationLabel(item.specificationNumber)}</Text>
        </View>
      </View>
    </View>
  )
}

function DocumentHeader({ data, deliveryDate }: { data: MaterialReceivingActData; deliveryDate: string }) {
  return (
    <>
      <Text style={styles.eyebrow}>CRM Завода · складской контур</Text>
      <View style={styles.titleRow} wrap={false}>
        <View>
          <Text style={styles.title}>АКТ ПРИЁМА МАТЕРИАЛА</Text>
          <Text style={styles.subtitle}>План поставки и контрольный перечень к приёмке</Text>
        </View>
        <View style={styles.documentMark}><Text style={styles.documentMarkText}>ПЛАН К ПРИЁМКЕ</Text></View>
      </View>
      <View style={styles.accentLine} />

      <View style={styles.metaGrid} wrap={false}>
        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Дата поставки</Text>
          <Text style={styles.metaValue}>{deliveryDate}</Text>
          <Text style={styles.metaSecondary}>Все позиции сгруппированы по этой дате</Text>
        </View>
        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Завод</Text>
          <Text style={styles.metaValue}>{data.factoryName}</Text>
          <Text style={styles.metaSecondary}>
            {data.items.length} {pluralRu(data.items.length, 'позиция', 'позиции', 'позиций')} ·{' '}
            {data.orders.length} {pluralRu(data.orders.length, 'заказ', 'заказа', 'заказов')}
          </Text>
        </View>
        <View style={styles.metaCardLast}>
          <Text style={styles.metaLabel}>Поставщики и вес</Text>
          <Text style={styles.metaValue}>
            {data.supplierNames.length} {pluralRu(data.supplierNames.length, 'поставщик', 'поставщика', 'поставщиков')}
          </Text>
          <Text style={styles.metaSecondary}>
            Плановый вес: {data.totalWeightKg === null ? 'не указан' : `${formatNumber(data.totalWeightKg)} кг`}
          </Text>
        </View>
      </View>
    </>
  )
}

function MaterialTable({ items, startIndex }: { items: MaterialReceivingActItem[]; startIndex: number }) {
  return (
    <View style={styles.table}>
      {items.map((item, index) => <MaterialRow key={item.key} item={item} index={startIndex + index} />)}
    </View>
  )
}

function OrdersSummary({ data, deliveryDate, orders, showClosing }: {
  data: MaterialReceivingActData
  deliveryDate: string
  orders: MaterialReceivingActData['orders']
  showClosing: boolean
}) {
  return (
    <>
      <View style={styles.summary} wrap={false}>
        <Text style={styles.summaryTitle}>Материал предназначен для заказов</Text>
        <View style={styles.orderGrid}>
          {orders.map((order) => (
            <View key={order.machineId} style={styles.orderCard} wrap={false}>
              <Text style={styles.orderName}>{order.name}</Text>
              <Text style={styles.orderMeta}>
                {specificationLabel(order.specificationNumber)} · {order.itemCount}{' '}
                {pluralRu(order.itemCount, 'позиция', 'позиции', 'позиций')}
              </Text>
            </View>
          ))}
        </View>
        {showClosing && (
          <View style={styles.summaryBottom}>
            <Text style={styles.summaryDate}>Дата поставки: {deliveryDate}</Text>
            <Text style={styles.body}>Сформировано: {dateTimeFormatter.format(new Date(data.generatedAt))}</Text>
          </View>
        )}
      </View>

      {showClosing && (
        <View style={styles.signatureRow} wrap={false}>
          {['Принял', 'Дата фактического приёма', 'Подпись'].map((label) => (
            <View key={label} style={styles.signatureField}>
              <Text style={styles.signatureLabel}>{label}</Text><View style={styles.signatureLine} />
            </View>
          ))}
        </View>
      )}
    </>
  )
}

function PageFooter({ data, pageNumber, totalPages }: {
  data: MaterialReceivingActData
  pageNumber: number
  totalPages: number
}) {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>CRM Завода · Акт приёма материала · {data.factoryName}</Text>
      <Text style={styles.footerPage}>Страница {pageNumber} из {totalPages}</Text>
    </View>
  )
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

export function MaterialReceivingActDocument({ data }: { data: MaterialReceivingActData }) {
  const deliveryDate = formatDeliveryDate(data.deliveryDate)
  const itemPages = chunks(data.items, 3)
  const lastItemPage = itemPages[itemPages.length - 1] || []
  const summaryFitsLastItemPage = lastItemPage.length <= 3 && data.orders.length <= 4
  const orderPages = summaryFitsLastItemPage ? [] : chunks(data.orders, 8)
  const totalPages = itemPages.length + orderPages.length

  return (
    <Document title={`Акт приёма материала - ${deliveryDate}`} author="CRM Завода">
      {itemPages.map((items, pageIndex) => {
        const isLastItemPage = pageIndex === itemPages.length - 1
        const startIndex = pageIndex * 3
        return (
          <Page key={`items-${pageIndex}`} size="A4" style={styles.page}>
            <DocumentHeader data={data} deliveryDate={deliveryDate} />
            <View style={styles.sectionHeader} wrap={false}>
              <Text style={styles.sectionTitle}>
                Что должно приехать{pageIndex > 0 ? ' · продолжение' : ''}
              </Text>
              <Text style={styles.sectionMeta}>
                Позиции {startIndex + 1}-{startIndex + items.length} из {data.items.length}
              </Text>
            </View>
            <MaterialTable items={items} startIndex={startIndex} />
            {isLastItemPage && summaryFitsLastItemPage && (
              <OrdersSummary data={data} deliveryDate={deliveryDate} orders={data.orders} showClosing />
            )}
            <PageFooter data={data} pageNumber={pageIndex + 1} totalPages={totalPages} />
          </Page>
        )
      })}
      {orderPages.map((orders, pageIndex) => (
        <Page key={`orders-${pageIndex}`} size="A4" style={styles.page}>
          <DocumentHeader data={data} deliveryDate={deliveryDate} />
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionTitle}>Итоговая привязка к заказам</Text>
            <Text style={styles.sectionMeta}>
              Заказы {pageIndex * 8 + 1}-{pageIndex * 8 + orders.length} из {data.orders.length}
            </Text>
          </View>
          <OrdersSummary
            data={data}
            deliveryDate={deliveryDate}
            orders={orders}
            showClosing={pageIndex === orderPages.length - 1}
          />
          <PageFooter
            data={data}
            pageNumber={itemPages.length + pageIndex + 1}
            totalPages={totalPages}
          />
        </Page>
      ))}
    </Document>
  )
}
