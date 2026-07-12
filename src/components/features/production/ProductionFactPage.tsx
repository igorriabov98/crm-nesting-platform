'use client'

import { useMemo, useState, useTransition } from 'react'
import type { ElementType } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Factory,
  Gauge,
  PackageCheck,
  Save,
  Ship,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  deleteProductionMachineFact,
  saveUnifiedProductionFact,
  type ProductionFactMachineFactRow,
  type ProductionFactMachineOption,
  type ProductionFactWorkspaceData,
} from '@/lib/actions/production-fact'
import {
  getProductionFactStageDefinition,
  resolveProductionFactStandardStages,
  type ProductionFactStageKey,
} from '@/lib/constants/production-fact'
import { formatProductionMonth } from '@/lib/utils/production-months'
import { cn } from '@/lib/utils'
import type { ProductionFactSection, ProductionFactShift } from '@/lib/types'

const selectClassName = 'flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

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

function shiftLabel(shift: ProductionFactShift) {
  return shift === 'day' ? 'День' : 'Ночь'
}

function machineSelectionLabel(options: ProductionFactMachineOption[], selectedIds: string[]) {
  if (selectedIds.length === 0) return 'Выбрать машины'
  const names = selectedIds
    .map((id) => options.find((machine) => machine.id === id)?.name)
    .filter(Boolean)
  if (names.length === 1) return names[0] || 'Выбрано: 1'
  return `Выбрано: ${selectedIds.length}`
}

function sectionLabel(section: ProductionFactSection | null | undefined, fallback = 'Участок') {
  return section?.name || fallback
}

type DayOverviewRow = {
  key: string
  stageLabel: string
  sectionLabel: string
  facts: ProductionFactMachineFactRow[]
  tonnage: number
  tracksTonnage: boolean
}

type MachineMonthGroup = {
  key: string
  label: string
  machines: ProductionFactMachineOption[]
}

export function ProductionFactPage({ data }: { data: ProductionFactWorkspaceData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [isFilterPending, startFilterTransition] = useTransition()
  const resolvedStages = useMemo(() => resolveProductionFactStandardStages(data.sections), [data.sections])
  const availableStages = useMemo(
    () => resolvedStages.filter((stage) => stage.parent && stage.sections.some((section) => section.section)),
    [resolvedStages],
  )
  const firstStageKey = (availableStages[0]?.definition.key || 'cutting') as ProductionFactStageKey
  const [selectedStageKey, setSelectedStageKey] = useState<ProductionFactStageKey>(firstStageKey)
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([])
  const [machineDropdownOpen, setMachineDropdownOpen] = useState(false)
  const [shift, setShift] = useState<ProductionFactShift>('day')
  const [tonnageDrafts, setTonnageDrafts] = useState<Record<string, string>>({})
  const [comment, setComment] = useState('')

  const effectiveStageKey = availableStages.some((stage) => stage.definition.key === selectedStageKey)
    ? selectedStageKey
    : firstStageKey
  const selectedStage = availableStages.find((stage) => stage.definition.key === effectiveStageKey) || availableStages[0] || null
  const selectedStageDefinition = selectedStage?.definition || getProductionFactStageDefinition(effectiveStageKey)
  const isShippingStage = Boolean(selectedStageDefinition.isShipping)
  const isCuttingStage = selectedStageDefinition.key === 'cutting'
  const requiresTonnage = !isShippingStage && !isCuttingStage
  const availableSections = selectedStage?.sections.filter((section) => section.section) || []
  const effectiveSectionId = availableSections.some((section) => section.section?.id === selectedSectionId)
    ? selectedSectionId
    : availableSections[0]?.section?.id || ''
  const selectedSection = availableSections.find((section) => section.section?.id === effectiveSectionId)?.section || null
  const selectedFactory = data.factories.find((factory) => factory.id === data.selectedFactoryId)
  const selectedTonnageFact = selectedSection
    ? data.tonnageFacts.find((fact) => fact.section_id === selectedSection.id)
    : null
  const tonnageValue = selectedSection
    ? tonnageDrafts[selectedSection.id] ?? (selectedTonnageFact ? String(Number(selectedTonnageFact.tonnage || 0)) : '')
    : ''
  const canEdit = data.canEditSelectedDate && Boolean(data.selectedFactoryId)
  const readOnlyLabel = !data.canEditSelectedDate && !data.isDirector ? 'Только просмотр: дата старше 7 дней' : null
  const selectedMachineText = machineSelectionLabel(data.machineOptions, selectedMachineIds)
  const machineMonthGroups = useMemo<MachineMonthGroup[]>(() => {
    const groups = new Map<string, MachineMonthGroup>()
    for (const machine of data.machineOptions) {
      const key = machine.production_month || 'without-month'
      const group = groups.get(key)
      if (group) {
        group.machines.push(machine)
      } else {
        groups.set(key, {
          key,
          label: machine.production_month ? formatProductionMonth(machine.production_month) : 'Без месяца производства',
          machines: [machine],
        })
      }
    }
    return Array.from(groups.values())
  }, [data.machineOptions])
  const shippingMachinesForDate = data.shippingMachinesForDate
  const factsForSelectedSection = selectedSection
    ? data.machineFacts.filter((fact) => fact.section_id === selectedSection.id)
    : []
  const duplicateSelectedCount = factsForSelectedSection
    .filter((fact) => fact.shift === shift && selectedMachineIds.includes(fact.machine_id))
    .length

  const dayOverviewRows = useMemo<DayOverviewRow[]>(() => {
    const rows: DayOverviewRow[] = []
    for (const stage of resolvedStages) {
      if (stage.definition.isShipping) continue
      for (const item of stage.sections) {
        if (!item.section) continue
        const facts = data.machineFacts.filter((fact) => fact.section_id === item.section!.id)
        const tonnageFact = data.tonnageFacts.find((fact) => fact.section_id === item.section!.id)
        rows.push({
          key: item.section.id,
          stageLabel: stage.definition.label,
          sectionLabel: item.label,
          facts,
          tonnage: Number(tonnageFact?.tonnage || 0),
          tracksTonnage: stage.definition.key !== 'cutting',
        })
      }
    }
    return rows
  }, [data.machineFacts, data.tonnageFacts, resolvedStages])

  function updateQuery(
    updates: Partial<Record<'factory' | 'date', string | null>>,
    options: { replace?: boolean } = {},
  ) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('productionMonth')
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const query = params.toString()
    const href = query ? `${pathname}?${query}` : pathname
    startFilterTransition(() => {
      if (options.replace) {
        router.replace(href, { scroll: false })
      } else {
        router.push(href, { scroll: false })
      }
    })
  }

  function toggleMachine(machineId: string) {
    setSelectedMachineIds((current) => (
      current.includes(machineId)
        ? current.filter((id) => id !== machineId)
        : [...current, machineId]
    ))
  }

  function handleStageSelect(stageKey: ProductionFactStageKey) {
    setSelectedStageKey(stageKey)
    setSelectedMachineIds([])
    setMachineDropdownOpen(false)
    setComment('')
  }

  function handleSave() {
    if (!data.selectedFactoryId || !selectedSection) {
      toast.error('Выберите завод и участок')
      return
    }
    if (selectedMachineIds.length === 0) {
      toast.error('Выберите машины')
      return
    }
    if (requiresTonnage) {
      const value = Number(tonnageValue || 0)
      if (!Number.isFinite(value) || value < 0) {
        toast.error('Тоннаж должен быть числом от 0')
        return
      }
    }

    startTransition(async () => {
      const result = await saveUnifiedProductionFact({
        factory_id: data.selectedFactoryId!,
        fact_date: data.selectedDate,
        stage_key: selectedStageDefinition.key,
        section_id: selectedSection.id,
        machine_ids: selectedMachineIds,
        shift,
        tonnage: requiresTonnage ? Number(tonnageValue || 0) : null,
        comment,
      })

      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить факт производства')
        return
      }

      if (isShippingStage) {
        toast.success(`Факт отгрузки сохранён: ${result.data?.shippingUpdated || 0}`)
      } else if (isCuttingStage) {
        toast.success('Факт заготовки сохранён. Новые складские резервы обработаны')
      } else {
        toast.success(`Факт сохранён: добавлено ${result.data?.inserted || 0}, уже было ${result.data?.skipped || 0}`)
      }
      setSelectedMachineIds([])
      setMachineDropdownOpen(false)
      setComment('')
    })
  }

  function handleDeleteFact(id: string) {
    if (!window.confirm('Удалить запись факта?')) return
    startTransition(async () => {
      const result = await deleteProductionMachineFact(id)
      if (!result.success) {
        toast.error(result.error || 'Не удалось удалить запись')
        return
      }
      toast.success('Запись удалена')
    })
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-[#64748B]">
              <Factory className="size-4 text-[#1B3A6B]" />
              <span>{selectedFactory?.name || 'Завод не выбран'}</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#12315F]">Факт производства</h1>
          </div>

          <div className="w-full sm:max-w-[360px] xl:min-w-[320px]">
            <label className="space-y-1 text-sm font-medium text-[#334155]">
              <span>Завод</span>
              <select
                className={selectClassName}
                value={data.selectedFactoryId || ''}
                onChange={(event) => updateQuery({ factory: event.target.value }, { replace: true })}
                disabled={data.factories.length <= 1 || isFilterPending}
              >
                {data.factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>{factory.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard icon={Users} label="Машины в факте" value={String(data.stats.uniqueMachineCount)} note={`${data.stats.machineFactCount} записей`} />
          <KpiCard icon={Clock3} label="Смены" value={`${data.stats.dayShiftCount} / ${data.stats.nightShiftCount}`} note="день / ночь" />
          <KpiCard icon={Gauge} label="Тоннаж" value={`${formatNumber(data.stats.totalTonnage, 3)} т`} note={`вчера ${formatNumber(data.stats.previousTotalTonnage, 3)} т`} />
          <KpiCard icon={Ship} label="Отгружено" value={String(shippingMachinesForDate.length)} note="машин за дату" />
          <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
            <div className="text-sm text-[#64748B]">Статус даты</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#12315F]">
              <CheckCircle2 className={cn('size-4', data.canEditSelectedDate ? 'text-[#15803D]' : 'text-[#94A3B8]')} />
              {readOnlyLabel || 'Редактирование открыто'}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#12315F]">
              <PackageCheck className="size-4 text-[#1E40AF]" />
              Ввод за {formatDateLong(data.selectedDate)}
            </div>
            <label className="w-full space-y-1 text-sm font-medium text-[#334155] sm:w-[220px]">
              <span>Дата факта</span>
              <Input
                type="date"
                value={data.selectedDate}
                onChange={(event) => updateQuery({ date: event.target.value }, { replace: true })}
                disabled={isFilterPending}
              />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {availableStages.map((stage) => (
              <button
                key={stage.definition.key}
                type="button"
                onClick={() => handleStageSelect(stage.definition.key)}
                className={cn(
                  'min-h-10 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E40AF]',
                  selectedStageDefinition.key === stage.definition.key
                    ? 'border-[#1E40AF] bg-[#EFF6FF] text-[#12315F] shadow-sm'
                    : 'border-[#DBEAFE] bg-white text-[#334155] hover:bg-[#F8FAFC]',
                )}
              >
                {stage.definition.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(190px,0.8fr)_minmax(250px,1.4fr)_120px_minmax(130px,0.6fr)_minmax(180px,1fr)_auto] lg:items-end">
          <label className="space-y-1 text-sm font-medium text-[#334155]">
            <span>{selectedStageDefinition.key === 'assembly' ? 'Подучасток' : 'Участок'}</span>
            <select
              className={selectClassName}
              value={selectedSection?.id || ''}
              onChange={(event) => setSelectedSectionId(event.target.value)}
              disabled={availableSections.length <= 1 || !canEdit}
            >
              {availableSections.map((section) => (
                <option key={section.section!.id} value={section.section!.id}>{section.label}</option>
              ))}
            </select>
          </label>

          <div className="space-y-1 text-sm font-medium text-[#334155]">
            <div className="flex items-center justify-between gap-2">
              <span>Машины</span>
              <span className="text-xs font-normal text-[#64748B]">{selectedMachineIds.length} выбрано</span>
            </div>
            <div className="relative">
              <button
                type="button"
                disabled={!canEdit || data.machineOptions.length === 0}
                aria-expanded={machineDropdownOpen}
                aria-haspopup="listbox"
                className={cn(
                  'inline-flex h-9 w-full items-center justify-between rounded-md border border-input bg-white px-3 text-left text-sm font-normal text-[#1B3A6B] shadow-sm transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1E40AF] disabled:cursor-not-allowed disabled:opacity-50',
                  selectedMachineIds.length === 0 && 'text-[#94A3B8]',
                )}
                onClick={() => setMachineDropdownOpen((open) => !open)}
              >
                <span className="min-w-0 flex-1 truncate">{selectedMachineText}</span>
                <ChevronDown className="ml-2 size-4 shrink-0 text-[#64748B]" />
              </button>
              {machineDropdownOpen ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-[#E2E8F0] bg-white p-1 shadow-lg" role="group" aria-label="Машины">
                  {machineMonthGroups.map((group) => (
                    <div key={group.key} className="py-1 first:pt-0 last:pb-0">
                      <div className="sticky top-0 z-10 rounded-sm bg-[#F8FAFC] px-2 py-1 text-xs font-semibold uppercase text-[#64748B]">
                        {group.label}
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {group.machines.map((machine) => {
                          const checked = selectedMachineIds.includes(machine.id)
                          return (
                            <button
                              key={machine.id}
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              className={cn(
                                'flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[#334155] transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1E40AF]',
                                checked && 'bg-[#EFF6FF] text-[#12315F]',
                              )}
                              onClick={() => toggleMachine(machine.id)}
                            >
                              <span
                                className={cn(
                                  'flex size-4 shrink-0 items-center justify-center rounded border border-[#CBD5E1] bg-white text-white transition-colors',
                                  checked && 'border-[#1E40AF] bg-[#1E40AF]',
                                )}
                                aria-hidden="true"
                              >
                                {checked ? <Check className="size-3" /> : null}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {machine.production_queue_number ? `${machine.production_queue_number}. ` : ''}{machine.name}
                              </span>
                              <span className="shrink-0 text-xs text-[#64748B]">{formatNumber(machine.total_weight, 2)} т</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <label className="space-y-1 text-sm font-medium text-[#334155]">
            <span>Смена</span>
            <select
              className={selectClassName}
              value={shift}
              onChange={(event) => setShift(event.target.value as ProductionFactShift)}
              disabled={!canEdit || isShippingStage}
            >
              <option value="day">День</option>
              <option value="night">Ночь</option>
            </select>
          </label>

          {requiresTonnage ? (
            <label className="space-y-1 text-sm font-medium text-[#334155]">
              <span>Тоннаж, т</span>
              <Input
                type="number"
                min="0"
                step="0.001"
                value={tonnageValue}
                onChange={(event) => {
                  if (!selectedSection) return
                  setTonnageDrafts((current) => ({ ...current, [selectedSection.id]: event.target.value }))
                }}
                disabled={!canEdit}
              />
            </label>
          ) : (
            <div className="rounded-md border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1E3A8A]">
              Для этого участка тоннаж не нужен
            </div>
          )}

          <label className="space-y-1 text-sm font-medium text-[#334155]">
            <span>Комментарий</span>
            <Input value={comment} onChange={(event) => setComment(event.target.value)} disabled={!canEdit} />
          </label>

          <Button type="button" onClick={handleSave} disabled={!canEdit || isPending || selectedMachineIds.length === 0 || !selectedSection} className="min-w-28">
            <Save className="size-4" />
            Сохранить
          </Button>
        </div>

        {duplicateSelectedCount > 0 && isCuttingStage ? (
          <div className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-sm text-[#1E3A8A]">
            По {duplicateSelectedCount} выбранным машинам факт заготовки уже есть. Система проверит и спишет только новые складские резервы.
          </div>
        ) : duplicateSelectedCount > 0 && !isShippingStage ? (
          <div className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
            {duplicateSelectedCount} выбранных машин уже есть в этом участке и смене. При сохранении они будут пропущены.
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-sm">
          <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
            <div className="text-sm font-semibold text-[#12315F]">Записи выбранного участка</div>
            <div className="mt-1 text-xs text-[#64748B]">
              {selectedStageDefinition.label} · {sectionLabel(selectedSection, selectedStageDefinition.label)}
            </div>
          </div>

          {isShippingStage ? (
            <ShippingList machines={shippingMachinesForDate} />
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              <div className="px-4 py-3">
                <div className="text-xs font-medium uppercase text-[#64748B]">Машины</div>
                {factsForSelectedSection.length === 0 ? (
                  <div className="mt-2 text-sm text-[#94A3B8]">Записей пока нет</div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {factsForSelectedSection.map((fact) => (
                      <span key={fact.id} className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-[#DBEAFE] bg-white px-2 py-1 text-xs text-[#334155]">
                        <span className="max-w-[180px] truncate font-medium text-[#12315F]">{fact.machine?.name || 'Машина не найдена'}</span>
                        <span className="text-[#64748B]">{shiftLabel(fact.shift)}</span>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleDeleteFact(fact.id)} disabled={!fact.canEdit || isPending}>
                          <Trash2 className="size-3" />
                          <span className="sr-only">Удалить</span>
                        </Button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {isCuttingStage ? (
                <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-sm text-[#64748B]">
                  Для заготовки учитываются машины и складские списания; тоннаж участка не вводится.
                </div>
              ) : (
                <div className="grid gap-3 px-4 py-3 md:grid-cols-3">
                  <Metric label="Тоннаж участка" value={`${formatNumber(Number(selectedTonnageFact?.tonnage || 0), 3)} т`} />
                  <Metric label="Вчера" value={`${formatNumber(Number(selectedTonnageFact?.previousTonnage || 0), 3)} т`} />
                  <Metric label="Изменено" value={selectedTonnageFact ? formatDateTime(selectedTonnageFact.updated_at) : '—'} />
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-[#12315F]">Состояние дня</div>
          <div className="mt-3 space-y-2">
            {dayOverviewRows.map((row) => (
              <div key={row.key} className="rounded-md border border-[#E2E8F0] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[#111827]">{row.stageLabel}</div>
                    <div className="truncate text-xs text-[#64748B]">{row.sectionLabel}</div>
                  </div>
                  <Badge variant="outline" className="border-[#DBEAFE] text-[#1E40AF]">{row.facts.length}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[#64748B]">
                  <span>{row.tracksTonnage ? `${formatNumber(row.tonnage, 3)} т` : 'тоннаж не учитывается'}</span>
                  <span>{row.facts.filter((fact) => fact.shift === 'day').length}/{row.facts.filter((fact) => fact.shift === 'night').length}</span>
                </div>
              </div>
            ))}
            <div className="rounded-md border border-[#E2E8F0] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-[#111827]">Отгрузка</div>
                <Badge variant="outline" className="border-[#DBEAFE] text-[#1E40AF]">{shippingMachinesForDate.length}</Badge>
              </div>
              <div className="mt-2 text-xs text-[#64748B]">машин с фактом отгрузки за дату</div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, note }: { icon: ElementType; label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-[#64748B]">{label}</div>
        <Icon className="size-4 text-[#1E40AF]" />
      </div>
      <div className="mt-2 text-2xl font-semibold text-[#12315F]">{value}</div>
      <div className="mt-1 text-xs text-[#64748B]">{note}</div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
      <div className="text-xs text-[#64748B]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#12315F]">{value}</div>
    </div>
  )
}

function ShippingList({ machines }: { machines: ProductionFactMachineOption[] }) {
  if (machines.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-[#64748B]">За выбранную дату факта отгрузки пока нет</div>
  }

  return (
    <div className="divide-y divide-[#E2E8F0]">
      {machines.map((machine) => (
        <div key={machine.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#12315F]">
              {machine.production_queue_number ? `${machine.production_queue_number}. ` : ''}{machine.name}
            </div>
            <div className="mt-1 text-xs text-[#64748B]">{formatNumber(machine.total_weight, 2)} т</div>
          </div>
          <Badge variant="outline" className="border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]">Отгружена</Badge>
        </div>
      ))}
    </div>
  )
}
