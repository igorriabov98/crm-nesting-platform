'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import type { ElementType, FormEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Factory,
  Gauge,
  Pencil,
  Plus,
  Save,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  archiveProductionFactSection,
  copyProductionMachineFactsFromPreviousDay,
  createProductionFactSection,
  deleteProductionMachineFact,
  deleteProductionTonnageFact,
  saveProductionMachineFact,
  saveProductionTonnageFact,
  updateProductionFactSection,
  type ProductionFactMachineFactRow,
  type ProductionFactMachineOption,
  type ProductionFactTonnageFactRow,
  type ProductionFactWorkspaceData,
} from '@/lib/actions/production-fact'
import { cn } from '@/lib/utils'
import type { ProductionFactSection, ProductionFactShift } from '@/lib/types'

export type ProductionFactTab = 'machines' | 'tonnage'

type ProductionFactPageProps = {
  data: ProductionFactWorkspaceData
  activeTab: ProductionFactTab
}

type MachineFormState = {
  id: string | null
  machine_id: string
  section_id: string
  shift: ProductionFactShift
  comment: string
}

type TonnageRow = {
  section: ProductionFactSection
  parentSection: ProductionFactSection | null
  fact: ProductionFactTonnageFactRow | null
  previousTonnage: number
  deltaTonnage: number
}

const selectClassName = 'flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

const emptyMachineForm: MachineFormState = {
  id: null,
  machine_id: '',
  section_id: '',
  shift: 'day',
  comment: '',
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
}

function formatWeightKg(value: number) {
  return `${formatNumber(value, 2)} кг`
}

function shiftLabel(shift: ProductionFactShift) {
  return shift === 'day' ? 'День' : 'Ночь'
}

function createInitialTonnageDrafts(data: ProductionFactWorkspaceData) {
  const drafts: Record<string, { tonnage: string; comment: string }> = {}
  for (const section of data.sections) {
    if (section.parent_id) drafts[section.id] = { tonnage: '', comment: '' }
  }
  for (const fact of data.tonnageFacts) {
    drafts[fact.section_id] = {
      tonnage: String(Number(fact.tonnage || 0)),
      comment: fact.comment || '',
    }
  }
  return drafts
}

function isActiveSection(section: ProductionFactSection | null | undefined) {
  return Boolean(section?.is_active && !section.archived_at)
}

function SectionPath({ parent, section }: { parent: ProductionFactSection | null; section: ProductionFactSection | null }) {
  if (!section) return <span className="text-[#94A3B8]">Без участка</span>
  return (
    <span className="inline-flex min-w-0 flex-col">
      <span className="truncate font-medium text-[#111827]">{section.name}</span>
      {parent ? <span className="truncate text-xs text-[#64748B]">{parent.name}</span> : null}
    </span>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: ElementType
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-[#64748B]">
        <Icon className="size-4 text-[#1B3A6B]" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal text-[#12315F]">{value}</div>
      {note ? <div className="mt-1 text-xs text-[#64748B]">{note}</div> : null}
    </div>
  )
}

export function ProductionFactPage({ data, activeTab }: ProductionFactPageProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [machineForm, setMachineForm] = useState<MachineFormState>(emptyMachineForm)
  const [sectionName, setSectionName] = useState('')
  const [sectionOrder, setSectionOrder] = useState('100')
  const [subsectionName, setSubsectionName] = useState('')
  const [subsectionParentId, setSubsectionParentId] = useState('')
  const [subsectionOrder, setSubsectionOrder] = useState('100')
  const [tonnageDrafts, setTonnageDrafts] = useState(() => createInitialTonnageDrafts(data))

  const parentSections = useMemo(
    () => data.sections
      .filter((section) => !section.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru')),
    [data.sections],
  )

  const parentById = useMemo(
    () => new Map(parentSections.map((section) => [section.id, section])),
    [parentSections],
  )

  const sectionsById = useMemo(
    () => new Map(data.sections.map((section) => [section.id, section])),
    [data.sections],
  )

  const childSectionsByParent = useMemo(() => {
    const map = new Map<string, ProductionFactSection[]>()
    for (const section of data.sections.filter((item) => item.parent_id)) {
      const key = section.parent_id!
      const list = map.get(key) || []
      list.push(section)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru'))
    }
    return map
  }, [data.sections])

  const activeSubsections = useMemo(
    () => data.sections
      .filter((section) => section.parent_id && isActiveSection(section) && isActiveSection(parentById.get(section.parent_id)))
      .sort((a, b) => {
        const parentA = parentById.get(a.parent_id || '')?.sort_order || 0
        const parentB = parentById.get(b.parent_id || '')?.sort_order || 0
        return parentA - parentB || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru')
      }),
    [data.sections, parentById],
  )

  const machineOptions = useMemo(() => {
    const map = new Map<string, ProductionFactMachineOption>()
    for (const machine of data.machineOptions) map.set(machine.id, machine)
    for (const fact of data.machineFacts) {
      if (fact.machine) map.set(fact.machine.id, fact.machine)
    }
    return Array.from(map.values())
  }, [data.machineFacts, data.machineOptions])

  const sectionOptions = useMemo(() => {
    const map = new Map<string, ProductionFactSection>()
    for (const section of activeSubsections) map.set(section.id, section)
    if (machineForm.section_id) {
      const selected = sectionsById.get(machineForm.section_id)
      if (selected) map.set(selected.id, selected)
    }
    return Array.from(map.values())
  }, [activeSubsections, machineForm.section_id, sectionsById])

  const tonnageRows = useMemo<TonnageRow[]>(() => {
    const activeIds = new Set(activeSubsections.map((section) => section.id))
    const factsBySection = new Map(data.tonnageFacts.map((fact) => [fact.section_id, fact]))
    const rows = activeSubsections.map((section) => {
      const fact = factsBySection.get(section.id) || null
      const previousTonnage = fact?.previousTonnage ?? data.previousTonnageBySection[section.id] ?? 0
      const currentTonnage = Number(fact?.tonnage || 0)
      return {
        section,
        parentSection: parentById.get(section.parent_id || '') || null,
        fact,
        previousTonnage,
        deltaTonnage: currentTonnage - previousTonnage,
      }
    })

    for (const fact of data.tonnageFacts) {
      if (activeIds.has(fact.section_id)) continue
      const section = fact.section || sectionsById.get(fact.section_id)
      if (!section) continue
      rows.push({
        section,
        parentSection: fact.parentSection || parentById.get(section.parent_id || '') || null,
        fact,
        previousTonnage: fact.previousTonnage,
        deltaTonnage: fact.deltaTonnage,
      })
    }
    return rows
  }, [activeSubsections, data.previousTonnageBySection, data.tonnageFacts, parentById, sectionsById])

  const machineGroups = useMemo(() => {
    const map = new Map<string, { parent: ProductionFactSection | null; rows: ProductionFactMachineFactRow[] }>()
    for (const fact of data.machineFacts) {
      const key = fact.parentSection?.id || 'without-section'
      const group = map.get(key) || { parent: fact.parentSection, rows: [] }
      group.rows.push(fact)
      map.set(key, group)
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.parent && b.parent) return 1
      if (a.parent && !b.parent) return -1
      return (a.parent?.sort_order || 0) - (b.parent?.sort_order || 0) || (a.parent?.name || '').localeCompare(b.parent?.name || '', 'ru')
    })
  }, [data.machineFacts])

  const tonnageTotalsByParent = useMemo(() => {
    const map = new Map<string, { parent: ProductionFactSection | null; current: number; previous: number }>()
    for (const row of tonnageRows) {
      const key = row.parentSection?.id || 'without-section'
      const value = map.get(key) || { parent: row.parentSection, current: 0, previous: 0 }
      value.current += Number(row.fact?.tonnage || 0)
      value.previous += row.previousTonnage
      map.set(key, value)
    }
    return Array.from(map.values()).sort((a, b) => (a.parent?.sort_order || 0) - (b.parent?.sort_order || 0))
  }, [tonnageRows])

  function updateQuery(updates: Partial<Record<'factory' | 'date' | 'productionMonth' | 'tab', string | null>>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  function runAction(action: () => Promise<{ success: boolean; error: string | null }>, successMessage: string) {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить')
        return
      }
      toast.success(successMessage)
      router.refresh()
    })
  }

  function handleMachineSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data.selectedFactoryId) return
    if (!machineForm.machine_id || !machineForm.section_id) {
      toast.error('Выберите машину и подучасток')
      return
    }

    runAction(
      () => saveProductionMachineFact({
        id: machineForm.id,
        factory_id: data.selectedFactoryId!,
        fact_date: data.selectedDate,
        machine_id: machineForm.machine_id,
        section_id: machineForm.section_id,
        shift: machineForm.shift,
        comment: machineForm.comment,
      }),
      machineForm.id ? 'Факт обновлен' : 'Факт добавлен',
    )
  }

  function handleCopyYesterday() {
    if (!data.selectedFactoryId) return
    startTransition(async () => {
      const result = await copyProductionMachineFactsFromPreviousDay({
        factory_id: data.selectedFactoryId!,
        fact_date: data.selectedDate,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось скопировать')
        return
      }
      toast.success(`Скопировано: ${result.data?.inserted || 0}, пропущено: ${result.data?.skipped || 0}`)
      router.refresh()
    })
  }

  function handleAddSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data.selectedFactoryId) return
    runAction(
      () => createProductionFactSection({
        factory_id: data.selectedFactoryId!,
        name: sectionName,
        sort_order: Number(sectionOrder || 100),
      }),
      'Участок создан',
    )
    setSectionName('')
    setSectionOrder('100')
  }

  function handleAddSubsection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!data.selectedFactoryId || !subsectionParentId) {
      toast.error('Выберите участок')
      return
    }
    runAction(
      () => createProductionFactSection({
        factory_id: data.selectedFactoryId!,
        parent_id: subsectionParentId,
        name: subsectionName,
        sort_order: Number(subsectionOrder || 100),
      }),
      'Подучасток создан',
    )
    setSubsectionName('')
    setSubsectionOrder('100')
  }

  function handleRenameSection(section: ProductionFactSection) {
    const name = window.prompt('Название', section.name)
    if (!name || name.trim() === section.name) return
    runAction(
      () => updateProductionFactSection({ id: section.id, name, sort_order: section.sort_order }),
      'Название обновлено',
    )
  }

  function handleArchiveSection(section: ProductionFactSection) {
    if (!window.confirm(`Отправить в архив: ${section.name}?`)) return
    runAction(() => archiveProductionFactSection(section.id), 'Участок отправлен в архив')
  }

  function handleEditMachineFact(fact: ProductionFactMachineFactRow) {
    setMachineForm({
      id: fact.id,
      machine_id: fact.machine_id,
      section_id: fact.section_id,
      shift: fact.shift,
      comment: fact.comment || '',
    })
  }

  function handleDeleteMachineFact(id: string) {
    if (!window.confirm('Удалить запись факта?')) return
    runAction(() => deleteProductionMachineFact(id), 'Запись удалена')
  }

  function handleTonnageDraft(sectionId: string, field: 'tonnage' | 'comment', value: string) {
    setTonnageDrafts((current) => ({
      ...current,
      [sectionId]: {
        tonnage: current[sectionId]?.tonnage || '',
        comment: current[sectionId]?.comment || '',
        [field]: value,
      },
    }))
  }

  function handleSaveTonnage(row: TonnageRow) {
    if (!data.selectedFactoryId) return
    const draft = tonnageDrafts[row.section.id] || { tonnage: '', comment: '' }
    runAction(
      () => saveProductionTonnageFact({
        id: row.fact?.id,
        factory_id: data.selectedFactoryId!,
        fact_date: data.selectedDate,
        section_id: row.section.id,
        tonnage: Number(draft.tonnage || 0),
        comment: draft.comment,
      }),
      'Тоннаж сохранен',
    )
  }

  function handleDeleteTonnage(row: TonnageRow) {
    if (!row.fact?.id) return
    if (!window.confirm('Удалить тоннаж по подучастку?')) return
    runAction(() => deleteProductionTonnageFact(row.fact!.id), 'Тоннаж удален')
  }

  const selectedFactory = data.factories.find((factory) => factory.id === data.selectedFactoryId)
  const readOnlyLabel = !data.canEditSelectedDate && !data.isDirector ? 'Только просмотр: дата старше 7 дней' : null

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-[#64748B]">
              <Factory className="size-4 text-[#1B3A6B]" />
              <span>{selectedFactory?.name || 'Завод не выбран'}</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#12315F]">Факт производства</h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[720px]">
            <label className="space-y-1 text-sm font-medium text-[#334155]">
              <span>Завод</span>
              <select
                className={selectClassName}
                value={data.selectedFactoryId || ''}
                onChange={(event) => updateQuery({ factory: event.target.value })}
                disabled={data.factories.length <= 1}
              >
                {data.factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>{factory.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-[#334155]">
              <span>Дата факта</span>
              <Input
                type="date"
                value={data.selectedDate}
                onChange={(event) => updateQuery({ date: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-[#334155]">
              <span>Месяц машин</span>
              <select
                className={selectClassName}
                value={data.productionMonth}
                onChange={(event) => updateQuery({ productionMonth: event.target.value })}
              >
                {data.productionMonthOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard icon={ClipboardCheck} label="Записей машин" value={String(data.stats.machineFactCount)} note={`${data.stats.uniqueMachineCount} машин`} />
          <KpiCard icon={CalendarDays} label="Смены" value={`${data.stats.dayShiftCount} / ${data.stats.nightShiftCount}`} note="день / ночь" />
          <KpiCard icon={Gauge} label="Тоннаж" value={`${formatNumber(data.stats.totalTonnage, 3)} т`} note={`вчера ${formatNumber(data.stats.previousTotalTonnage, 3)} т`} />
          <KpiCard
            icon={data.stats.tonnageDelta >= 0 ? TrendingUp : TrendingDown}
            label="Динамика"
            value={`${data.stats.tonnageDelta >= 0 ? '+' : ''}${formatNumber(data.stats.tonnageDelta, 3)} т`}
            note="к предыдущему дню"
          />
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
            <div className="text-sm text-[#64748B]">Статус даты</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#12315F]">
              <CheckCircle2 className={cn('size-4', data.canEditSelectedDate ? 'text-[#15803D]' : 'text-[#94A3B8]')} />
              {readOnlyLabel || 'Редактирование открыто'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-[#E2E8F0] bg-white p-1 shadow-sm">
        <Button
          type="button"
          variant={activeTab === 'machines' ? 'default' : 'ghost'}
          className={cn('h-9 px-4', activeTab === 'machines' ? 'bg-[#1B3A6B]' : 'text-[#334155]')}
          onClick={() => updateQuery({ tab: 'machines' })}
        >
          <Factory className="size-4" />
          Факт машины в работе
        </Button>
        <Button
          type="button"
          variant={activeTab === 'tonnage' ? 'default' : 'ghost'}
          className={cn('h-9 px-4', activeTab === 'tonnage' ? 'bg-[#1B3A6B]' : 'text-[#334155]')}
          onClick={() => updateQuery({ tab: 'tonnage' })}
        >
          <Gauge className="size-4" />
          Факт тоннажа
        </Button>
      </div>

      {activeTab === 'machines' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <form onSubmit={handleMachineSubmit} className="rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_140px_minmax(180px,1fr)_auto] lg:items-end">
                <label className="space-y-1 text-sm font-medium text-[#334155]">
                  <span>Машина</span>
                  <select
                    className={selectClassName}
                    value={machineForm.machine_id}
                    onChange={(event) => setMachineForm((current) => ({ ...current, machine_id: event.target.value }))}
                    disabled={!data.canEditSelectedDate || machineOptions.length === 0}
                  >
                    <option value="">Выбрать</option>
                    {machineOptions.map((machine) => (
                      <option key={machine.id} value={machine.id}>
                        {machine.production_queue_number ? `${machine.production_queue_number}. ` : ''}{machine.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-[#334155]">
                  <span>Подучасток</span>
                  <select
                    className={selectClassName}
                    value={machineForm.section_id}
                    onChange={(event) => setMachineForm((current) => ({ ...current, section_id: event.target.value }))}
                    disabled={!data.canEditSelectedDate || sectionOptions.length === 0}
                  >
                    <option value="">Выбрать</option>
                    {sectionOptions.map((section) => (
                      <option key={section.id} value={section.id}>
                        {parentById.get(section.parent_id || '')?.name || 'Участок'} / {section.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-[#334155]">
                  <span>Смена</span>
                  <select
                    className={selectClassName}
                    value={machineForm.shift}
                    onChange={(event) => setMachineForm((current) => ({ ...current, shift: event.target.value as ProductionFactShift }))}
                    disabled={!data.canEditSelectedDate}
                  >
                    <option value="day">День</option>
                    <option value="night">Ночь</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-[#334155]">
                  <span>Комментарий</span>
                  <Input
                    value={machineForm.comment}
                    onChange={(event) => setMachineForm((current) => ({ ...current, comment: event.target.value }))}
                    disabled={!data.canEditSelectedDate}
                  />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" disabled={isPending || !data.canEditSelectedDate || !data.selectedFactoryId}>
                    <Save className="size-4" />
                    {machineForm.id ? 'Обновить' : 'Добавить'}
                  </Button>
                  {machineForm.id ? (
                    <Button type="button" variant="outline" onClick={() => setMachineForm(emptyMachineForm)}>
                      Сброс
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-3">
                <div className="text-sm text-[#64748B]">
                  {machineOptions.length} машин в выбранном месяце · {activeSubsections.length} активных подучастков
                </div>
                <Button type="button" variant="outline" onClick={handleCopyYesterday} disabled={isPending || !data.canEditSelectedDate || !data.selectedFactoryId}>
                  <Copy className="size-4" />
                  Копировать вчера
                </Button>
              </div>
            </form>

            <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#F8FAFC]">
                    <TableHead className="min-w-[220px]">Машина</TableHead>
                    <TableHead>Участок</TableHead>
                    <TableHead>Смена</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead>Создал</TableHead>
                    <TableHead>Изменено</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineGroups.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-[#64748B]">Записей за день нет</TableCell>
                    </TableRow>
                  ) : machineGroups.map((group) => (
                    <Fragment key={group.parent?.id || 'without-section'}>
                      <TableRow className="bg-[#F1F5F9] hover:bg-[#F1F5F9]">
                        <TableCell colSpan={7} className="py-2 text-sm font-semibold text-[#12315F]">
                          {group.parent?.name || 'Без участка'}
                        </TableCell>
                      </TableRow>
                      {group.rows.map((fact) => (
                        <TableRow key={fact.id}>
                          <TableCell>
                            <div className="font-medium text-[#111827]">{fact.machine?.name || 'Машина не найдена'}</div>
                            <div className="text-xs text-[#64748B]">{fact.machine ? formatWeightKg(fact.machine.total_weight) : '—'}</div>
                          </TableCell>
                          <TableCell>
                            <SectionPath parent={fact.parentSection} section={fact.section} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={fact.shift === 'day' ? 'secondary' : 'outline'}>{shiftLabel(fact.shift)}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[260px] whitespace-normal text-[#334155]">{fact.comment || '—'}</TableCell>
                          <TableCell>
                            <div className="text-sm text-[#334155]">{fact.createdByName || '—'}</div>
                            <div className="text-xs text-[#64748B]">{formatDateTime(fact.created_at)}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-[#334155]">{fact.updatedByName || '—'}</div>
                            <div className="text-xs text-[#64748B]">{formatDateTime(fact.updated_at)}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleEditMachineFact(fact)} disabled={!fact.canEdit || isPending}>
                                <Pencil className="size-4" />
                                <span className="sr-only">Редактировать</span>
                              </Button>
                              <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleDeleteMachineFact(fact.id)} disabled={!fact.canEdit || isPending}>
                                <Trash2 className="size-4" />
                                <span className="sr-only">Удалить</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <SectionManager
            parentSections={parentSections}
            childSectionsByParent={childSectionsByParent}
            canEdit={data.canEditSelectedDate && Boolean(data.selectedFactoryId)}
            isPending={isPending}
            sectionName={sectionName}
            sectionOrder={sectionOrder}
            subsectionName={subsectionName}
            subsectionParentId={subsectionParentId}
            subsectionOrder={subsectionOrder}
            onSectionNameChange={setSectionName}
            onSectionOrderChange={setSectionOrder}
            onSubsectionNameChange={setSubsectionName}
            onSubsectionParentChange={setSubsectionParentId}
            onSubsectionOrderChange={setSubsectionOrder}
            onAddSection={handleAddSection}
            onAddSubsection={handleAddSubsection}
            onRename={handleRenameSection}
            onArchive={handleArchiveSection}
          />
        </div>
      ) : (
        <section className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {tonnageTotalsByParent.map((total) => {
              const delta = total.current - total.previous
              return (
                <div key={total.parent?.id || 'without'} className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 shadow-sm">
                  <div className="text-sm font-medium text-[#334155]">{total.parent?.name || 'Без участка'}</div>
                  <div className="mt-2 text-2xl font-semibold text-[#12315F]">{formatNumber(total.current, 3)} т</div>
                  <div className={cn('mt-1 flex items-center gap-1 text-xs', delta >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]')}>
                    {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {delta >= 0 ? '+' : ''}{formatNumber(delta, 3)} т к предыдущему дню
                  </div>
                </div>
              )
            })}
          </div>

          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F8FAFC]">
                  <TableHead className="min-w-[240px]">Материал / участок</TableHead>
                  <TableHead className="w-[170px]">Тоннаж, т</TableHead>
                  <TableHead className="w-[150px]">Вчера</TableHead>
                  <TableHead className="w-[150px]">Динамика</TableHead>
                  <TableHead>Комментарий</TableHead>
                  <TableHead>Создал / изменил</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tonnageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-[#64748B]">Нет подучастков для ввода тоннажа</TableCell>
                  </TableRow>
                ) : tonnageRows.map((row) => {
                  const draft = tonnageDrafts[row.section.id] || { tonnage: '', comment: '' }
                  const canEdit = row.fact ? row.fact.canEdit : data.canEditSelectedDate
                  return (
                    <TableRow key={row.section.id}>
                      <TableCell>
                        <SectionPath parent={row.parentSection} section={row.section} />
                        {!isActiveSection(row.section) ? <Badge variant="outline" className="mt-1">Архив</Badge> : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          value={draft.tonnage}
                          onChange={(event) => handleTonnageDraft(row.section.id, 'tonnage', event.target.value)}
                          disabled={!canEdit || isPending}
                        />
                      </TableCell>
                      <TableCell>{formatNumber(row.previousTonnage, 3)} т</TableCell>
                      <TableCell>
                        <span className={cn('inline-flex items-center gap-1 text-sm font-medium', row.deltaTonnage >= 0 ? 'text-[#15803D]' : 'text-[#B91C1C]')}>
                          {row.deltaTonnage >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                          {row.deltaTonnage >= 0 ? '+' : ''}{formatNumber(row.deltaTonnage, 3)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.comment}
                          onChange={(event) => handleTonnageDraft(row.section.id, 'comment', event.target.value)}
                          disabled={!canEdit || isPending}
                        />
                      </TableCell>
                      <TableCell>
                        {row.fact ? (
                          <div className="text-sm text-[#334155]">
                            <div>{row.fact.createdByName || '—'} · {formatDateTime(row.fact.created_at)}</div>
                            <div className="text-xs text-[#64748B]">{row.fact.updatedByName || '—'} · {formatDateTime(row.fact.updated_at)}</div>
                          </div>
                        ) : <span className="text-[#94A3B8]">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="icon-sm" variant="ghost" onClick={() => handleSaveTonnage(row)} disabled={!canEdit || isPending}>
                            <Save className="size-4" />
                            <span className="sr-only">Сохранить</span>
                          </Button>
                          {row.fact ? (
                            <Button type="button" size="icon-sm" variant="ghost" onClick={() => handleDeleteTonnage(row)} disabled={!canEdit || isPending}>
                              <Trash2 className="size-4" />
                              <span className="sr-only">Удалить</span>
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  )
}

function SectionManager({
  parentSections,
  childSectionsByParent,
  canEdit,
  isPending,
  sectionName,
  sectionOrder,
  subsectionName,
  subsectionParentId,
  subsectionOrder,
  onSectionNameChange,
  onSectionOrderChange,
  onSubsectionNameChange,
  onSubsectionParentChange,
  onSubsectionOrderChange,
  onAddSection,
  onAddSubsection,
  onRename,
  onArchive,
}: {
  parentSections: ProductionFactSection[]
  childSectionsByParent: Map<string, ProductionFactSection[]>
  canEdit: boolean
  isPending: boolean
  sectionName: string
  sectionOrder: string
  subsectionName: string
  subsectionParentId: string
  subsectionOrder: string
  onSectionNameChange: (value: string) => void
  onSectionOrderChange: (value: string) => void
  onSubsectionNameChange: (value: string) => void
  onSubsectionParentChange: (value: string) => void
  onSubsectionOrderChange: (value: string) => void
  onAddSection: (event: FormEvent<HTMLFormElement>) => void
  onAddSubsection: (event: FormEvent<HTMLFormElement>) => void
  onRename: (section: ProductionFactSection) => void
  onArchive: (section: ProductionFactSection) => void
}) {
  const activeParents = parentSections.filter(isActiveSection)

  return (
    <aside className="space-y-4 rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[#12315F]">Участки</h2>
          <div className="text-xs text-[#64748B]">{activeParents.length} активных</div>
        </div>
        <Badge variant="outline">2 уровня</Badge>
      </div>

      <form onSubmit={onAddSection} className="space-y-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
          <Input placeholder="Участок" value={sectionName} onChange={(event) => onSectionNameChange(event.target.value)} disabled={!canEdit || isPending} />
          <Input type="number" value={sectionOrder} onChange={(event) => onSectionOrderChange(event.target.value)} disabled={!canEdit || isPending} />
        </div>
        <Button type="submit" variant="outline" size="sm" className="w-full" disabled={!canEdit || isPending || !sectionName.trim()}>
          <Plus className="size-4" />
          Участок
        </Button>
      </form>

      <form onSubmit={onAddSubsection} className="space-y-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
        <select className={selectClassName} value={subsectionParentId} onChange={(event) => onSubsectionParentChange(event.target.value)} disabled={!canEdit || isPending}>
          <option value="">Участок</option>
          {activeParents.map((section) => (
            <option key={section.id} value={section.id}>{section.name}</option>
          ))}
        </select>
        <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
          <Input placeholder="Подучасток" value={subsectionName} onChange={(event) => onSubsectionNameChange(event.target.value)} disabled={!canEdit || isPending} />
          <Input type="number" value={subsectionOrder} onChange={(event) => onSubsectionOrderChange(event.target.value)} disabled={!canEdit || isPending} />
        </div>
        <Button type="submit" variant="outline" size="sm" className="w-full" disabled={!canEdit || isPending || !subsectionName.trim() || !subsectionParentId}>
          <Plus className="size-4" />
          Подучасток
        </Button>
      </form>

      <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
        {parentSections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#CBD5E1] p-4 text-sm text-[#64748B]">Участков пока нет</div>
        ) : parentSections.map((section) => {
          const children = childSectionsByParent.get(section.id) || []
          return (
            <div key={section.id} className={cn('rounded-lg border p-3', isActiveSection(section) ? 'border-[#E2E8F0]' : 'border-[#E2E8F0] bg-[#F8FAFC] opacity-75')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-[#111827]">{section.name}</div>
                  <div className="text-xs text-[#64748B]">Порядок {section.sort_order}</div>
                </div>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon-xs" onClick={() => onRename(section)} disabled={!canEdit || isPending || !isActiveSection(section)}>
                    <Pencil className="size-3" />
                    <span className="sr-only">Переименовать</span>
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={() => onArchive(section)} disabled={!canEdit || isPending || !isActiveSection(section)}>
                    <Archive className="size-3" />
                    <span className="sr-only">Архив</span>
                  </Button>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {children.map((child) => (
                  <div key={child.id} className={cn('flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm', isActiveSection(child) ? 'bg-[#F8FAFC]' : 'bg-[#F1F5F9] text-[#64748B]')}>
                    <span className="truncate">{child.name}</span>
                    <div className="flex items-center gap-1">
                      {!isActiveSection(child) ? <Badge variant="outline">Архив</Badge> : null}
                      <Button type="button" variant="ghost" size="icon-xs" onClick={() => onRename(child)} disabled={!canEdit || isPending || !isActiveSection(child)}>
                        <Pencil className="size-3" />
                        <span className="sr-only">Переименовать</span>
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" onClick={() => onArchive(child)} disabled={!canEdit || isPending || !isActiveSection(child)}>
                        <Archive className="size-3" />
                        <span className="sr-only">Архив</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
