import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { PeoplePlanningWorkspace } from '@/lib/people-planning/types'
import { PDF_FONT_FAMILY, registerPdfFonts } from './fonts'

registerPdfFonts()

const TABLE_WIDTH = 730
const columns = { date: 68, half: 54, section: 120, employee: 130, machine: 150, kg: 66, status: 68, signature: 74 }
const styles = StyleSheet.create({
  page: { padding: 42, fontFamily: PDF_FONT_FAMILY, fontSize: 8, color: '#111827', backgroundColor: '#fff' },
  title: { fontSize: 15, fontWeight: 'bold', color: '#1B3A6B' },
  meta: { marginTop: 6, marginBottom: 18, color: '#4B5563', fontSize: 9 },
  table: { width: TABLE_WIDTH, alignSelf: 'center', borderTopWidth: 0.7, borderLeftWidth: 0.7, borderColor: '#1F2937' },
  row: { flexDirection: 'row', minHeight: 24 },
  headerRow: { flexDirection: 'row', minHeight: 30, backgroundColor: '#EAF0F8' },
  cell: { borderRightWidth: 0.7, borderBottomWidth: 0.7, borderColor: '#1F2937', padding: 4, justifyContent: 'center' },
  headerText: { fontWeight: 'bold', color: '#1B3A6B', textAlign: 'center' },
  center: { textAlign: 'center' },
  sectionLabel: { marginTop: 12, marginBottom: 5, fontSize: 9, fontWeight: 'bold', color: '#1B3A6B' },
  footer: { width: TABLE_WIDTH, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  sign: { width: 250, flexDirection: 'row', alignItems: 'flex-end' },
  signLabel: { fontWeight: 'bold', marginRight: 8 },
  line: { flex: 1, borderBottomWidth: 0.7, borderColor: '#111827', height: 14 },
  empty: { padding: 28, textAlign: 'center', color: '#6B7280' },
})

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function Cell({ width, children, center = false }: { width: number; children: string; center?: boolean }) {
  return <View style={[styles.cell, { width }]}><Text style={center ? styles.center : undefined}>{children}</Text></View>
}

export function PeopleWorkOrderDocument({ data }: { data: PeoplePlanningWorkspace }) {
  const employeeById = new Map(data.employees.map((employee) => [employee.id, employee]))
  const machineById = new Map(data.machines.map((machine) => [machine.id, machine]))
  const factoryName = data.factories.find((factory) => factory.id === data.selectedFactoryId)?.name || '—'
  const grouped = new Map<string, typeof data.assignments>()
  for (const assignment of data.assignments) {
    const list = grouped.get(assignment.section_id) || []
    list.push(assignment)
    grouped.set(assignment.section_id, list)
  }

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Наряд на производство — планирование людей</Text>
        <Text style={styles.meta}>Завод: {factoryName} · Период: {data.dates.map((date) => dateFormatter.format(new Date(`${date}T00:00:00Z`))).join(' — ')}</Text>
        {data.assignments.length === 0 && <Text style={styles.empty}>На выбранный период назначений нет.</Text>}
        {data.sections.filter((section) => grouped.has(section.id)).map((section) => (
          <View key={section.id} wrap={false}>
            <Text style={styles.sectionLabel}>{section.displayName}</Text>
            <View style={styles.table}>
              <View style={styles.headerRow} fixed>
                <Cell width={columns.date} center>Дата</Cell><Cell width={columns.half} center>Полдня</Cell><Cell width={columns.section} center>Участок</Cell><Cell width={columns.employee} center>Сотрудник</Cell><Cell width={columns.machine} center>Машина</Cell><Cell width={columns.kg} center>План, кг</Cell><Cell width={columns.status} center>Статус</Cell><Cell width={columns.signature} center>Подпись</Cell>
              </View>
              {(grouped.get(section.id) || []).sort((a, b) => (employeeById.get(a.employee_id)?.full_name || '').localeCompare(employeeById.get(b.employee_id)?.full_name || '', 'ru') || a.work_date.localeCompare(b.work_date) || a.half - b.half).map((assignment) => (
                <View key={assignment.id} style={styles.row} wrap={false}>
                  <Cell width={columns.date} center>{dateFormatter.format(new Date(`${assignment.work_date}T00:00:00Z`))}</Cell>
                  <Cell width={columns.half} center>{assignment.half === 1 ? '1-я' : '2-я'}</Cell>
                  <Cell width={columns.section}>{section.name}</Cell>
                  <Cell width={columns.employee}>{employeeById.get(assignment.employee_id)?.full_name || '—'}</Cell>
                  <Cell width={columns.machine}>{machineById.get(assignment.machine_id)?.name || '—'}</Cell>
                  <Cell width={columns.kg} center>{numberFormatter.format(assignment.kg_planned)}</Cell>
                  <Cell width={columns.status} center>{assignment.status === 'confirmed' ? 'Подтверждён' : 'Предложение'}</Cell>
                  <Cell width={columns.signature}> </Cell>
                </View>
              ))}
            </View>
          </View>
        ))}
        <View style={styles.footer} wrap={false}>
          <View style={styles.sign}><Text style={styles.signLabel}>Дата</Text><View style={styles.line} /></View>
          <View style={styles.sign}><Text style={styles.signLabel}>Ответственный</Text><View style={styles.line} /></View>
        </View>
      </Page>
    </Document>
  )
}
