'use client'

import { useState } from 'react'
import { FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import type { MaterialCategory } from '@/lib/types'
import { getSupplyDateOrderOptions, MISSING_STEEL_TYPE, STEEL_TYPE_CATEGORIES } from '@/lib/reports/supply-date-order-selection'

export function SupplyDateOrderExportButton({
  dateKey,
  factoryId,
  itemCount,
  aggregates,
}: {
  dateKey: string
  factoryId: string | null
  itemCount: number
  aggregates: SupplyOrderAggregate[]
}) {
  const [isExporting, setIsExporting] = useState(false)
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState<MaterialCategory[]>([])
  const [steelTypes, setSteelTypes] = useState<Partial<Record<MaterialCategory, string[]>>>({})
  const availableOptions = getSupplyDateOrderOptions(aggregates, dateKey)
  const options = MATERIAL_CATEGORIES.map((category) => availableOptions.find((option) => option.category === category)
    || { category, count: 0, steelTypes: [] })
  const hasItems = itemCount > 0

  const toggleCategory = (category: MaterialCategory, enabled: boolean) => {
    setCategories((current) => enabled ? [...current, category] : current.filter((value) => value !== category))
    setSteelTypes((current) => ({
      ...current,
      [category]: enabled ? options.find((option) => option.category === category)?.steelTypes || [] : [],
    }))
  }
  const toggleSteelType = (category: MaterialCategory, name: string, enabled: boolean) => {
    setSteelTypes((current) => ({
      ...current,
      [category]: enabled
        ? [...(current[category] || []), name]
        : (current[category] || []).filter((value) => value !== name),
    }))
  }
  const canGenerate = categories.length > 0 && categories.every((category) => (
    !STEEL_TYPE_CATEGORIES.includes(category) || (steelTypes[category] || []).length > 0
  ))

  const download = async () => {
    if (!hasItems || isExporting || !canGenerate) return
    setIsExporting(true)
    try {
      const search = new URLSearchParams({ date: dateKey })
      if (factoryId) search.set('factory', factoryId)
      for (const category of categories) {
        search.append('category', category)
        for (const name of steelTypes[category] || []) search.append(`steel_type.${category}`, name)
      }
      const response = await fetch(`/api/reports/supply/date-order.xlsx?${search}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response))

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = responseFilename(response) || `zakaz-materialov-${dateKey}.xlsx`
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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (isExporting) return
      setOpen(nextOpen)
      if (nextOpen) {
        setCategories([])
        setSteelTypes({})
      }
    }}>
    <DialogTrigger render={<Button
      type="button"
      variant="outline"
      className="min-h-11 shrink-0 gap-2 px-3 sm:px-4"
      disabled={!hasItems || isExporting}
      aria-label={hasItems
        ? `Скачать заказ: ${itemCount} незаказанных материалов`
        : 'Нет незапланированного остатка для заказа на эту дату; приёмка проверяется отдельно'}
      title={hasItems
        ? 'Выбрать категории и скачать незаказанные материалы этой даты'
        : 'Нет незапланированного остатка для заказа на эту дату; приёмка проверяется отдельно'}
    >
      {isExporting
        ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />}
      <span>{isExporting ? 'Формирование…' : hasItems ? 'Скачать заказ' : 'Нет материалов для заказа'}</span>
      {hasItems && !isExporting && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
          {itemCount}
        </span>
      )}
    </Button>} />
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Сформировать заказ материалов</DialogTitle>
        <DialogDescription>Выберите категории и типы стали для этой даты. В файл попадут только незаказанные остатки.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <label className="flex min-h-10 items-center gap-3 rounded-lg border p-3 font-medium">
          <Checkbox checked={categories.length === availableOptions.length && availableOptions.length > 0}
            onCheckedChange={(checked) => {
              const enabled = checked === true
              setCategories(enabled ? availableOptions.map((option) => option.category) : [])
              setSteelTypes(enabled ? Object.fromEntries(availableOptions.map((option) => [option.category, option.steelTypes])) : {})
            }} />
          Выбрать все категории
        </label>
        {options.map((option) => {
          const checked = categories.includes(option.category)
          const selectedTypes = steelTypes[option.category] || []
          return <div key={option.category} className="rounded-lg border p-3">
            <label className="flex min-h-9 items-center gap-3 font-medium">
              <Checkbox checked={checked} disabled={option.count === 0}
                onCheckedChange={(value) => toggleCategory(option.category, value === true)} />
              {MATERIAL_CATEGORY_LABELS[option.category]} <span className="text-xs text-muted-foreground">{option.count}</span>
            </label>
            {checked && STEEL_TYPE_CATEGORIES.includes(option.category) && <div className="ml-7 mt-2 space-y-2 border-l pl-3">
              <label className="flex min-h-8 items-center gap-2 text-sm font-medium">
                <Checkbox checked={selectedTypes.length === option.steelTypes.length}
                  onCheckedChange={(value) => setSteelTypes((current) => ({
                    ...current, [option.category]: value === true ? option.steelTypes : [],
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
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isExporting} onClick={() => setOpen(false)}>Отмена</Button>
        <Button type="button" disabled={!canGenerate || isExporting} onClick={download}>
          {isExporting ? 'Формирование…' : 'Сформировать и скачать'}
        </Button>
      </DialogFooter>
    </DialogContent>
    </Dialog>
  )
}

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: string }
    return body.error || 'Не удалось сформировать Excel-файл'
  } catch {
    return 'Не удалось сформировать Excel-файл'
  }
}

function responseFilename(response: Response) {
  const contentDisposition = response.headers.get('Content-Disposition')
  return contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1] || null
}
