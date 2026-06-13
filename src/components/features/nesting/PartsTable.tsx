'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { updateNestingPart } from '@/lib/nesting/actions'
import { cn } from '@/lib/utils'
import type { SteelType } from '@/lib/types/database'
import type { NestingPart } from '@/lib/nesting/api'

const materials = ['Сталь', 'Нержавейка', 'Алюминий']
const noSteelTypeValue = '__none__'

function sanitizeThumbnail(svg: string | null) {
  const value = svg?.trim()
  if (!value || value.length > 100_000) return ''
  if (!/^<svg[\s>]/i.test(value)) return ''

  const forbidden = /<(?:script|iframe|object|embed|foreignObject)\b|on[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["']?\s*(?:javascript:|data:)/i
  if (forbidden.test(value)) return ''

  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`
  return `<img src="${src}" alt="" class="max-h-[44px] max-w-[44px]" />`
}

function thicknessClass(index: number) {
  const classes = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-purple-100 text-purple-700',
    'bg-slate-100 text-slate-700',
  ]
  return classes[index % classes.length]
}

function classificationMethodLabel(method: string | null | undefined) {
  switch (method) {
    case 'volume_area':
      return 'V/A'
    case 'normals':
      return 'normals'
    case 'heuristic':
      return 'heuristic'
    case 'bbox':
      return 'bbox'
    default:
      return null
  }
}

function classificationMethodTitle(method: string | null | undefined) {
  switch (method) {
    case 'volume_area':
      return 'Толщина рассчитана по объему и площади'
    case 'normals':
      return 'Толщина рассчитана по нормалям граней'
    case 'heuristic':
      return 'Классификация по эвристике'
    case 'bbox':
      return 'Классификация по bounding box'
    default:
      return ''
  }
}

export function PartsTable({
  projectId,
  parts,
  steelTypes,
  onPartsChange,
}: {
  projectId: string
  parts: NestingPart[]
  steelTypes: SteelType[]
  onPartsChange: (parts: NestingPart[]) => void
}) {
  const [onlySheetMetal, setOnlySheetMetal] = useState(false)
  const [savingPartId, setSavingPartId] = useState<string | null>(null)
  const [editingThicknessPartId, setEditingThicknessPartId] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [thicknesses, setThicknesses] = useState<Record<string, string>>({})

  const thicknessIndex = useMemo(() => {
    const values = Array.from(new Set(parts.map((part) => part.thickness))).sort((a, b) => a - b)
    return new Map(values.map((value, index) => [value, index]))
  }, [parts])

  useEffect(() => {
    setQuantities(Object.fromEntries(parts.map((part) => [part.id, String(part.quantity)])))
    setThicknesses(Object.fromEntries(parts.map((part) => [part.id, String(part.thickness)])))
  }, [parts])

  const visibleParts = onlySheetMetal ? parts.filter((part) => part.isSheetMetal) : parts

  async function savePart(part: NestingPart, data: Partial<{
    material: string
    steelTypeId: string | null
    steelTypeName: string | null
    steelTypeRaw: string | null
    quantity: number
    grainLock: boolean
    isSheetMetal: boolean
    thickness: number
  }>) {
    setSavingPartId(part.id)
    try {
      const result = await updateNestingPart(projectId, part.id, data)
      onPartsChange(parts.map((item) => item.id === part.id ? result.data : item))
      toast.success('Деталь обновлена')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить деталь')
    } finally {
      setSavingPartId(null)
    }
  }

  function commitQuantity(part: NestingPart) {
    const next = Number(quantities[part.id])
    if (!Number.isInteger(next) || next < 1) {
      setQuantities((current) => ({ ...current, [part.id]: String(part.quantity) }))
      return
    }
    if (next !== part.quantity) {
      savePart(part, { quantity: next })
    }
  }

  function commitThickness(part: NestingPart) {
    const next = Number(thicknesses[part.id])
    if (!Number.isFinite(next) || next <= 0 || next > 50) {
      setThicknesses((current) => ({ ...current, [part.id]: String(part.thickness) }))
      setEditingThicknessPartId(null)
      return
    }

    const rounded = Math.round(next * 100) / 100
    setThicknesses((current) => ({ ...current, [part.id]: String(rounded) }))
    setEditingThicknessPartId(null)
    if (rounded !== part.thickness) {
      savePart(part, { thickness: rounded })
    }
  }

  function saveSteelType(part: NestingPart, steelTypeId: string | null) {
    if (!steelTypeId || steelTypeId === noSteelTypeValue) {
      savePart(part, { steelTypeId: null, steelTypeName: null, steelTypeRaw: null })
      return
    }

    const steelType = steelTypes.find((item) => item.id === steelTypeId)
    if (!steelType) return

    savePart(part, {
      steelTypeId: steelType.id,
      steelTypeName: steelType.name,
      steelTypeRaw: steelType.name,
    })
  }

  return (
    <TooltipProvider>
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setOnlySheetMetal((value) => !value)}>
          {onlySheetMetal ? 'Показать все' : 'Показать только листовые'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F8F9FA]">
              <TableHead>Превью</TableHead>
              <TableHead>Имя</TableHead>
              <TableHead>Размеры</TableHead>
              <TableHead>Толщина</TableHead>
              <TableHead>Материал</TableHead>
              <TableHead>Тип стали</TableHead>
              <TableHead>Кол.</TableHead>
              <TableHead>Прокатка</TableHead>
              <TableHead>Тип</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleParts.map((part) => {
              const disabled = savingPartId === part.id
              const methodLabel = classificationMethodLabel(part.classificationMethod)

              return (
                <TableRow key={part.id} className={cn(!part.isSheetMetal && 'opacity-50')}>
                  <TableCell>
                    <div
                      className="flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-md border border-[#E8ECF0] bg-[#F8F9FA] [&_svg]:max-h-[44px] [&_svg]:max-w-[44px]"
                      dangerouslySetInnerHTML={{ __html: sanitizeThumbnail(part.thumbnailSvg) || '<span class="text-xs text-slate-400">—</span>' }}
                    />
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="truncate font-medium text-[#1B3A6B]">{part.name}</div>
                    {part.sourceMachineName || part.sourceLabel ? (
                      <div className="mt-1 truncate text-xs text-[#6B7280]">
                        {part.sourceMachineName || part.sourceLabel}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{Math.round(part.width)} × {Math.round(part.height)} мм</TableCell>
                  <TableCell>
                    <div className="flex min-w-[150px] items-center gap-2">
                      {editingThicknessPartId === part.id ? (
                        <Input
                          className="h-8 w-24 bg-white"
                          type="number"
                          min={0.1}
                          max={50}
                          step={0.1}
                          autoFocus
                          value={thicknesses[part.id] ?? String(part.thickness)}
                          disabled={disabled}
                          onChange={(event) => setThicknesses((current) => ({ ...current, [part.id]: event.target.value }))}
                          onBlur={() => commitThickness(part)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                            if (event.key === 'Escape') {
                              setThicknesses((current) => ({ ...current, [part.id]: String(part.thickness) }))
                              setEditingThicknessPartId(null)
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="text-left"
                          disabled={disabled}
                          onClick={() => setEditingThicknessPartId(part.id)}
                        >
                          <Badge variant="secondary" className={thicknessClass(thicknessIndex.get(part.thickness) ?? 0)}>
                            {part.thickness} мм
                          </Badge>
                        </button>
                      )}
                      <div className="flex items-center gap-1">
                        {methodLabel ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="rounded border border-[#E8ECF0] px-1.5 py-0.5 text-[11px] leading-none text-[#6B7280]">
                                  {methodLabel}
                                </span>
                              }
                            />
                            <TooltipContent>{classificationMethodTitle(part.classificationMethod)}</TooltipContent>
                          </Tooltip>
                        ) : null}
                        {part.hasBends ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex">
                                  <Wrench className="h-4 w-4 text-[#1B3A6B]" />
                                </span>
                              }
                            />
                            <TooltipContent>Гнутая деталь</TooltipContent>
                          </Tooltip>
                        ) : null}
                        {part.classificationWarning ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex">
                                  <AlertTriangle className="h-4 w-4 text-[#D97706]" />
                                </span>
                              }
                            />
                            <TooltipContent>{part.classificationWarning}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={part.material}
                      disabled={disabled || !part.isSheetMetal}
                      onValueChange={(value) => value && savePart(part, { material: value })}
                    >
                      <SelectTrigger className="w-[150px] bg-white">
                        <SelectValue>{part.material}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {materials.map((material) => (
                          <SelectItem key={material} value={material}>{material}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={part.steelTypeId || noSteelTypeValue}
                      disabled={disabled || !part.isSheetMetal || steelTypes.length === 0}
                      onValueChange={(value) => saveSteelType(part, value)}
                    >
                      <SelectTrigger className="w-[150px] bg-white">
                        <SelectValue>{part.steelTypeName || 'Не выбран'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value={noSteelTypeValue}>Не выбран</SelectItem>
                        {steelTypes.map((steelType) => (
                          <SelectItem key={steelType.id} value={steelType.id}>{steelType.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {part.steelTypeRaw && !part.steelTypeName ? (
                      <p className="mt-1 max-w-[150px] truncate text-xs text-amber-700">{part.steelTypeRaw}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="w-20 bg-white"
                      type="number"
                      min={1}
                      value={quantities[part.id] ?? String(part.quantity)}
                      disabled={disabled}
                      onChange={(event) => setQuantities((current) => ({ ...current, [part.id]: event.target.value }))}
                      onBlur={() => commitQuantity(part)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="sm"
                      checked={part.grainLock}
                      disabled={disabled || !part.isSheetMetal}
                      onCheckedChange={(checked) => savePart(part, { grainLock: checked === true })}
                    />
                  </TableCell>
                  <TableCell>
                    <button type="button" disabled={disabled} onClick={() => savePart(part, { isSheetMetal: !part.isSheetMetal })}>
                      <Badge variant="secondary" className={part.isSheetMetal ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                        {part.isSheetMetal ? 'Листовая' : 'Не листовая'}
                      </Badge>
                    </button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
    </TooltipProvider>
  )
}
