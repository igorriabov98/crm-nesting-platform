'use client'

import { useMemo, useState, useTransition } from 'react'
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
  parent_section_id: string
  section_id: string
  shift: ProductionFactShift
  comment: string
}

type MachineEntryGroup = {
  parent: ProductionFactSection | null
  sections: ProductionFactSection[]
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
  parent_section_id: '',
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

function parseDateOnly(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1))
}

function formatDateLong(value: string) {
  return parseDateOnly(value).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatWeekdayShort(value: string) {
  return parseDateOnly(value).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    weekday: 'short',
  })
}

function createMonthDays(monthStart: string) {
  const [year, month] = monthStart.split('-').map(Number)
  if (!year || !month) return []
  const daysCount = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: daysCount }, (_, index) => {
    const day = index + 1
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
}

function getClientToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Chisinau',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0))
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

  const monthDays = useMemo(() => createMonthDays(data.productionMonth), [data.productionMonth])
  const todayDate = useMemo(() => getClientToday(), [])
  const selectedDateInProductionMonth = data.selectedDate.slice(0, 7) === data.productionMonth.slice(0, 7)

  const machineFactsBySection = useMemo(() => {
    const map = new Map<string, ProductionFactMachineFactRow[]>()
    for (const fact of data.machineFacts) {
      const list = map.get(fact.section_id) || []
      list.push(fact)
      map.set(fact.section_id, list)
    }
    return map
  }, [data.machineFacts])

  const machineEntryGroups = useMemo<MachineEntryGroup[]>(() => {
    const sectionMap = new Map<string, { section: ProductionFactSection; parent: ProductionFactSection | null }>()
    for (const section of activeSubsections) {
      sectionMap.set(section.id, {
        section,
        parent: parentById.get(section.parent_id || '') || null,
      })
    }
    for (const fact of data.machineFacts) {
      const section = fact.section || sectionsById.get(fact.section_id)
      if (!section) continue
      sectionMap.set(section.id, {
        section,
        parent: fact.parentSection || parentById.get(section.parent_id || '') || null,
      })
    }

    const groupMap = new Map<string, MachineEntryGroup>()
    for (const { section, parent } of sectionMap.values()) {
      const key = parent?.id || 'without-section'
      const group = groupMap.get(key) || { parent, sections: [] }
      group.sections.push(section)
      groupMap.set(key, group)
    }

    return Array.from(groupMap.values())
      .map((group) => ({
        ...group,
        sections: group.sections.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ru')),
      }))
      .sort((a, b) => {
        if (!a.parent && b.parent) return 1
        if (a.parent && !b.parent) return -1
        return (a.parent?.sort_order || 0) - (b.parent?.sort_order || 0) || (a.parent?.name || '').localeCompare(b.parent?.name || '', 'ru')
      })
  }, [activeSubsections, data.machineFacts, parentById, sectionsById])

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

  function runAction(
    action: () => Promise<{ success: boolean; error: string | null }>,
    successMessage: string,
    onSuccess?: () => void,
  ) {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить')
        return
      }
      toast.success(successMessage)
      onSuccess?.()
      router.refresh()
    })
  }

  function updateMachineDraftForSection(
    section: ProductionFactSection,
    parent: ProductionFactSection | null,
    updates: Partial<Pick<MachineFormState, 'machine_id' | 'shift' | 'comment'>>,
  ) {
    setMachineForm((current) => {
      const sameSection = current.section_id === section.id
      return {
        id: sameSection ? current.id : null,
        machine_id: sameSection ? current.machine_id : '',
        parent_section_id: parent?.id || section.parent_id || '',
        section_id: section.id,
        shift: sameSection ? current.shift : 'day',
        comment: sameSection ? current.comment : '',
        ...updates,
      }
    })
  }

  function handleMachineSave(section: ProductionFactSection, parent: ProductionFactSection | null) {
    if (!data.selectedFactoryId) return
    const parentSectionId = parent?.id || section.parent_id || machineForm.parent_section_id
    const form = machineForm.section_id === section.id
      ? machineForm
      : {
          ...emptyMachineForm,
          parent_section_id: parentSectionId,
          section_id: section.id,
        }

    if (!form.machine_id || !parentSectionId || !section.id) {
      toast.error('Выберите машину, участок и подучасток')
      return
    }

    runAction(
      () => saveProductionMachineFact({
        id: form.id,
        factory_id: data.selectedFactoryId!,
        fact_date: data.selectedDate,
        machine_id: form.machine_id,
        section_id: section.id,
        shift: form.shift,
        comment: form.comment,
      }),
      form.id ? 'Факт обновлен' : 'Факт добавлен',
      () => setMachineForm(emptyMachineForm),
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
      parent_section_id: fact.parentSection?.id || fact.section?.parent_id || '',
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
                onChange={(event) => updateQuery({ productionMonth: event.target.value, date: event.target.value })}
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
        <div className="grid gap-4 2xl:grid-cols-[270px_minmax(0,1fr)_360px]">
          <aside className="rounded-lg border border-[#DBEAFE] bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#12315F]">Дни месяца</div>
                <div className="mt-1 text-xs text-[#64748B]">{formatDateLong(data.productionMonth)}</div>
              </div>
              <Badge variant="outline" className="border-[#DBEAFE] text-[#1E40AF]">{monthDays.length} дней</Badge>
            </div>
            {!selectedDateInProductionMonth ? (
              <div className="mt-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
                Выбранная дата вне месяца. Нажмите день ниже, чтобы открыть ввод за этот день.
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-4 lg:grid-cols-7 2xl:grid-cols-1">
              {monthDays.map((day) => {
                const isSelected = day === data.selectedDate
                const isToday = day === todayDate
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => updateQuery({ date: day })}
                    className={cn(
                      'min-h-14 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]',
                      isSelected
                        ? 'border-[#1E40AF] bg-[#EFF6FF] text-[#12315F] shadow-sm'
                        : 'border-[#DBEAFE] bg-white text-[#334155] hover:bg-[#F8FAFC]',
                      isToday && !isSelected ? 'border-[#D97706]' : '',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-lg font-semibold leading-none tabular-nums">{day.slice(8)}</span>
                      {isSelected ? <CheckCircle2 className="size-4 text-[#1E40AF]" /> : null}
                    </span>
                    <span className="mt-1 block text-xs capitalize text-[#64748B]">{formatWeekdayShort(day)}</span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#12315F]">
                    <CalendarDays className="size-4 text-[#1E40AF]" />
                    {formatDateLong(data.selectedDate)}
                  </div>
                  <div className="mt-1 text-xs text-[#64748B]">
                    {machineOptions.length} машин в месяце · {activeSubsections.length} активных подучастков · {data.machineFacts.length} записей за день
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={handleCopyYesterday} disabled={isPending || !data.canEditSelectedDate || !data.selectedFactoryId}>
                  <Copy className="size-4" />
                  Копировать вчера
                </Button>
              </div>

              {machineEntryGroups.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[#64748B]">
                  Нет активных подучастков для ввода факта.
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  {machineEntryGroups.map((group) => (
                    <div key={group.parent?.id || 'without-section'}>
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F8FAFC] px-4 py-2">
                        <div className="text-sm font-semibold text-[#12315F]">{group.parent?.name || 'Без участка'}</div>
                        <div className="text-xs text-[#64748B]">{group.sections.length} подучастков</div>
                      </div>
                      <div className="divide-y divide-[#E2E8F0]">
                        {group.sections.map((section) => {
                          const facts = machineFactsBySection.get(section.id) || []
                          const isActiveEditor = machineForm.section_id === section.id
                          const canEditRow = data.canEditSelectedDate && Boolean(data.selectedFactoryId)
                          return (
                            <div
                              key={section.id}
                              className={cn(
                                'grid gap-3 px-4 py-3 transition-colors xl:grid-cols-[minmax(170px,0.9fr)_minmax(220px,1.1fr)_minmax(210px,1fr)_120px_minmax(170px,1fr)_auto] xl:items-end',
                                isActiveEditor ? 'bg-[#EFF6FF]' : 'bg-white hover:bg-[#F8FAFC]',
                              )}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[#111827]">{section.name}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                                  <span>{group.parent?.name || 'Участок не выбран'}</span>
                                  {!isActiveSection(section) ? <Badge variant="outline">Архив</Badge> : null}
                                </div>
                              </div>

                              <div className="min-w-0">
                                <div className="text-xs font-medium uppercase text-[#64748B]">Записи</div>
                                {facts.length === 0 ? (
                                  <div className="mt-1 text-sm text-[#94A3B8]">Нет записей</div>
                                ) : (
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {facts.map((fact) => (
                                      <span key={fact.id} className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-[#DBEAFE] bg-white px-2 py-1 text-xs text-[#334155]">
                                        <span className="max-w-[160px] truncate font-medium text-[#12315F]">{fact.machine?.name || 'Машина не найдена'}</span>
                                        <span className="text-[#64748B]">{shiftLabel(fact.shift)}</span>
                                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleEditMachineFact(fact)} disabled={!fact.canEdit || isPending}>
                                          <Pencil className="size-3" />
                                          <span className="sr-only">Редактировать</span>
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleDeleteMachineFact(fact.id)} disabled={!fact.canEdit || isPending}>
                                          <Trash2 className="size-3" />
                                          <span className="sr-only">Удалить</span>
                                        </Button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <label className="space-y-1 text-sm font-medium text-[#334155]">
                                <span>Машина</span>
                                <select
                                  className={selectClassName}
                                  value={isActiveEditor ? machineForm.machine_id : ''}
                                  onChange={(event) => updateMachineDraftForSection(section, group.parent, { machine_id: event.target.value })}
                                  disabled={!canEditRow || machineOptions.length === 0}
                                  aria-label={`Машина для ${section.name}`}
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
                                <span>Смена</span>
                                <select
                                  className={selectClassName}
                                  value={isActiveEditor ? machineForm.shift : 'day'}
                                  onChange={(event) => updateMachineDraftForSection(section, group.parent, { shift: event.target.value as ProductionFactShift })}
                                  disabled={!canEditRow}
                                  aria-label={`Смена для ${section.name}`}
                                >
                                  <option value="day">День</option>
                                  <option value="night">Ночь</option>
                                </select>
                              </label>

                              <label className="space-y-1 text-sm font-medium text-[#334155]">
                                <span>Комментарий</span>
                                <Input
                                  value={isActiveEditor ? machineForm.comment : ''}
                                  onChange={(event) => updateMachineDraftForSection(section, group.parent, { comment: event.target.value })}
                                  disabled={!canEditRow}
                                  aria-label={`Комментарий для ${section.name}`}
                                />
                              </label>

                              <div className="flex gap-2">
                                <Button type="button" onClick={() => handleMachineSave(section, group.parent)} disabled={isPending || !canEditRow}>
                                  <Save className="size-4" />
                                  {isActiveEditor && machineForm.id ? 'Обновить' : 'Добавить'}
                                </Button>
                                {isActiveEditor ? (
                                  <Button type="button" variant="outline" onClick={() => setMachineForm(emptyMachineForm)}>
                                    Сброс
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div>
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
