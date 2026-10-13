'use client'

import { useState } from 'react'
import { FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import { displayMaterialCategory } from '@/lib/materials/display-category'
import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import type { MaterialCategory } from '@/lib/types'
import { getSupplyOrderExportMachines, getSupplyOrderExportOptions, MISSING_STEEL_TYPE, STEEL_TYPE_CATEGORIES, type SupplyOrderExportScope } from '@/lib/reports/supply-date-order-selection'

type ExportProps = {
  factoryId: string | null
  aggregates: SupplyOrderAggregate[]
  categoryFilter: MaterialCategory | 'all'
}

export function SupplyDateOrderExportButton({ dateKey, ...props }: ExportProps & { dateKey: string }) {
  return <SupplyOrderExportButton mode="date" dateKey={dateKey} {...props} />
}

export function SupplyOrderCustomExportButton({ mode, ...props }: ExportProps & { mode: 'period' | 'machine' }) {
  return <SupplyOrderExportButton mode={mode} {...props} />
}

function SupplyOrderExportButton({ mode, dateKey, factoryId, aggregates, categoryFilter }: ExportProps & {
  mode: 'date' | 'period' | 'machine'; dateKey?: string
}) {
  const [isExporting, setIsExporting] = useState(false)
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [machineId, setMachineId] = useState('')
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [steelTypes, setSteelTypes] = useState<Partial<Record<MaterialCategory, string[]>>>({})
  const machines = mode === 'machine' ? getSupplyOrderExportMachines(aggregates.filter((aggregate) => (
    categoryFilter === 'all' || displayMaterialCategory(aggregate.category, null, aggregate.unit) === categoryFilter
  ))) : []
  const scope: SupplyOrderExportScope | null = mode === 'date' && dateKey
    ? { kind: 'date', dateKey }
    : mode === 'period' && from && to && from <= to ? { kind: 'period', from, to }
      : mode === 'machine' && machineId ? { kind: 'machine', machineId } : null
  const availableOptions = scope ? getSupplyOrderExportOptions(aggregates, scope)
    .filter((option) => categoryFilter === 'all' || option.category === categoryFilter) : []
  const options = MATERIAL_CATEGORIES.filter((category) => categoryFilter === 'all' || category === categoryFilter)
    .map((category) => availableOptions.find((option) => option.category === category)
      || { category, count: 0, steelTypes: [] })
  const count = availableOptions.reduce((sum, option) => sum + option.count, 0)
  const selectedCategories = categories.filter((category) => availableOptions.some((option) => option.category === category))
  const selectedSteelTypes = (category: MaterialCategory) => (steelTypes[category] || []).filter((name) => (
    availableOptions.find((option) => option.category === category)?.steelTypes.includes(name)
  ))
  const canGenerate = Boolean(scope) && selectedCategories.length > 0 && selectedCategories.every((category) => (
    !STEEL_TYPE_CATEGORIES.includes(category) || selectedSteelTypes(category).length > 0
  ))

  const selectScope = (nextScope: SupplyOrderExportScope | null) => {
    const nextOptions = nextScope ? getSupplyOrderExportOptions(aggregates, nextScope)
      .filter((option) => categoryFilter === 'all' || option.category === categoryFilter) : []
    setCategories(nextOptions.map((option) => option.category))
    setSteelTypes(Object.fromEntries(nextOptions.map((option) => [option.category, option.steelTypes])))
  }
  const toggleCategory = (category: MaterialCategory, enabled: boolean) => {
    setCategories((current) => enabled ? [...new Set([...current, category])] : current.filter((value) => value !== category))
    setSteelTypes((current) => ({ ...current,
      [category]: enabled ? options.find((option) => option.category === category)?.steelTypes || [] : [],
    }))
  }
  const toggleSteelType = (category: MaterialCategory, name: string, enabled: boolean) => {
    setSteelTypes((current) => ({ ...current,
      [category]: enabled ? [...new Set([...(current[category] || []), name])]
        : (current[category] || []).filter((value) => value !== name),
    }))
  }

  const download = async () => {
    if (!scope || !count || isExporting || !canGenerate) return
    setIsExporting(true)
    try {
      const search = new URLSearchParams()
      if (scope.kind === 'date') search.set('date', scope.dateKey)
      if (scope.kind === 'period') { search.set('from', scope.from); search.set('to', scope.to) }
      if (scope.kind === 'machine') search.set('machine', scope.machineId)
      if (factoryId) search.set('factory', factoryId)
      for (const category of selectedCategories) {
        search.append('category', category)
        for (const name of selectedSteelTypes(category)) search.append(`steel_type.${category}`, name)
      }
      const response = await fetch(`/api/reports/supply/date-order.xlsx?${search}`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response))
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = responseFilename(response) || 'zakaz-materialov.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
      toast.success('Excel-файл сформирован')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сформировать Excel-файл')
    } finally {
      setIsExporting(false)
    }
  }

  const title = mode === 'date' ? 'Скачать заказ' : mode === 'period' ? 'За период' : 'По заказу клиента'
  return <Dialog open={open} onOpenChange={(nextOpen) => {
    if (isExporting) return
    setOpen(nextOpen)
    if (nextOpen) {
      setFrom(''); setTo(''); setMachineId('')
      selectScope(mode === 'date' ? scope : null)
    }
  }}>
    <DialogTrigger render={<Button type="button" variant="outline" className="min-h-11 shrink-0 gap-2 px-3 sm:px-4"
      disabled={(mode === 'date' && count === 0) || (mode === 'machine' && machines.length === 0) || isExporting}
      aria-label={mode === 'date' ? count ? `Скачать заказ: ${count} незаказанных материалов` : 'Нет материалов для заказа на эту дату' : title}>
      {isExporting ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
      <span>{isExporting ? 'Формирование…' : mode === 'date' && !count ? 'Нет материалов для заказа' : title}</span>
      {mode === 'date' && count > 0 && !isExporting && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">{count}</span>}
    </Button>} />
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Сформировать заказ материалов</DialogTitle>
        <DialogDescription>В файл попадут только остатки, которые ещё не заказаны.{mode === 'period' ? ' Одинаковые материалы за выбранные дни будут суммированы.' : ''}</DialogDescription>
      </DialogHeader>
      {mode === 'period' && <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">С даты
          <Input type="date" value={from} onChange={(event) => {
            const nextFrom = event.target.value
            setFrom(nextFrom)
            selectScope(nextFrom && to && nextFrom <= to ? { kind: 'period', from: nextFrom, to } : null)
          }} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">По дату включительно
          <Input type="date" value={to} onChange={(event) => {
            const nextTo = event.target.value
            setTo(nextTo)
            selectScope(from && nextTo && from <= nextTo ? { kind: 'period', from, to: nextTo } : null)
          }} />
        </label>
        {from && to && from > to && <p role="alert" className="text-sm text-destructive sm:col-span-2">Дата начала позже даты окончания.</p>}
      </div>}
      {mode === 'machine' && <div className="grid gap-1.5">
        <span className="text-sm font-medium">Заказ клиента</span>
        <Select value={machineId || undefined} onValueChange={(value) => {
          setMachineId(value || '')
          selectScope(value ? { kind: 'machine', machineId: value } : null)
        }}>
          <SelectTrigger className="w-full"><SelectValue>{machines.find((machine) => machine.id === machineId)?.name || 'Выберите заказ клиента'}</SelectValue></SelectTrigger>
          <SelectContent>{machines.map((machine) => <SelectItem key={machine.id} value={machine.id}>{machine.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {scope && !count && <p className="text-sm text-muted-foreground">По выбранным условиям нет материалов для заказа.</p>}
      {count > 0 && <div className="space-y-3">
        <label className="flex min-h-10 items-center gap-3 rounded-lg border p-3 font-medium">
          <Checkbox checked={selectedCategories.length === availableOptions.length && availableOptions.length > 0}
            onCheckedChange={(checked) => {
              if (checked === true) selectScope(scope)
              else { setCategories([]); setSteelTypes({}) }
            }} />
          Выбрать все категории
        </label>
        {options.map((option) => {
          const checked = selectedCategories.includes(option.category)
          const selectedTypes = selectedSteelTypes(option.category)
          return <div key={option.category} className="rounded-lg border p-3">
            <label className="flex min-h-9 items-center gap-3 font-medium">
              <Checkbox checked={checked} disabled={option.count === 0}
                onCheckedChange={(value) => toggleCategory(option.category, value === true)} />
              {MATERIAL_CATEGORY_LABELS[option.category]} <span className="text-xs text-muted-foreground">{option.count}</span>
            </label>
            {checked && STEEL_TYPE_CATEGORIES.includes(option.category) && <div className="ml-7 mt-2 space-y-2 border-l pl-3">
              <label className="flex min-h-8 items-center gap-2 text-sm font-medium">
                <Checkbox checked={selectedTypes.length === option.steelTypes.length}
                  onCheckedChange={(value) => setSteelTypes((current) => ({ ...current,
                    [option.category]: value === true ? option.steelTypes : [],
                  }))} />
                Выбрать все типы стали
              </label>
              {option.steelTypes.map((name) => <label key={name} className="flex min-h-8 items-center gap-2 text-sm">
                <Checkbox checked={selectedTypes.includes(name)}
                  onCheckedChange={(value) => toggleSteelType(option.category, name, value === true)} />
                {name === MISSING_STEEL_TYPE ? 'Не указан' : name}
              </label>)}
            </div>}
          </div>
        })}
      </div>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isExporting} onClick={() => setOpen(false)}>Отмена</Button>
        <Button type="button" disabled={!canGenerate || !count || isExporting} onClick={download}>
          {isExporting ? 'Формирование…' : 'Сформировать и скачать'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: string }
    return body.error || 'Не удалось сформировать Excel-файл'
  } catch { return 'Не удалось сформировать Excel-файл' }
}

function responseFilename(response: Response) {
  const contentDisposition = response.headers.get('Content-Disposition')
  return contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1] || null
}
