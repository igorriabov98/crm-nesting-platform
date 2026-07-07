'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Wrench } from 'lucide-react'
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
import type { NestingPart, PartType } from '@/lib/nesting/api'

const materials = ['Сталь', 'Нержавейка', 'Алюминий']
const noSteelTypeValue = '__none__'
const partTypeOptions: Array<{ value: PartType; label: string; className: string }> = [
  { value: 'SHEET', label: 'Листовая', className: 'bg-emerald-100 text-emerald-700' },
  { value: 'PROFILE', label: 'Профиль', className: 'bg-sky-100 text-sky-700' },
  { value: 'PURCHASED', label: 'Покупная', className: 'bg-violet-100 text-violet-700' },
]

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
    case 'pdf_bom':
      return 'авто'
    case 'manual':
      return 'ручн.'
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
    case 'pdf_bom':
      return 'Авто-метка из PDF/BOM'
    case 'manual':
      return 'Ручная метка оператора'
    default:
      return ''
  }
}

function formatBBox(part: NestingPart) {
  if (!part.bboxSizeX || !part.bboxSizeY || !part.bboxSizeZ) return ''
  return `STEP bbox: ${formatDim(part.bboxSizeX)} × ${formatDim(part.bboxSizeY)} × ${formatDim(part.bboxSizeZ)} мм`
}

function formatDim(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

function formatKFactor(part: NestingPart) {
  if (part.kFactor === null || part.kFactor === undefined) return ''
  return `${part.kFactor.toFixed(2)}${part.kFactorDefaulted ? ' default' : ''}`
}

function getPartType(part: NestingPart): PartType {
  return part.partType || (part.isSheetMetal ? 'SHEET' : 'PROFILE')
}

function isSheetPart(part: NestingPart) {
  return getPartType(part) === 'SHEET'
}

function partTypeMeta(partType: PartType) {
  return partTypeOptions.find((option) => option.value === partType) ?? partTypeOptions[0]
}

function formatThickness(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} мм` : '—'
}

function inactiveReasonLabel(part: NestingPart) {
  switch (part.inactiveReason) {
    case 'HIDDEN_IN_CAD':
      return 'скрыто в CAD'
    case 'MANUAL':
      return 'выключено вручную'
    default:
      return 'неактивна'
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
    const values = Array.from(new Set(
      parts
        .filter(isSheetPart)
        .map((part) => part.thickness)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )).sort((a, b) => a - b)
    return new Map(values.map((value, index) => [value, index]))
  }, [parts])

  useEffect(() => {
    setQuantities(Object.fromEntries(parts.map((part) => [part.id, String(part.quantity)])))
    setThicknesses(Object.fromEntries(parts.map((part) => [part.id, part.thickness === null ? '' : String(part.thickness)])))
  }, [parts])

  const visibleParts = onlySheetMetal ? parts.filter(isSheetPart) : parts

  async function savePart(part: NestingPart, data: Partial<{
    material: string
    steelTypeId: string | null
    steelTypeName: string | null
    steelTypeRaw: string | null
    quantity: number
    isActive: boolean
    grainLock: boolean
    isSheetMetal: boolean
    partType: PartType
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
      setThicknesses((current) => ({ ...current, [part.id]: part.thickness === null ? '' : String(part.thickness) }))
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
              <TableHead>Активна</TableHead>
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
              const partType = getPartType(part)
              const sheetPart = partType === 'SHEET'
              const typeMeta = partTypeMeta(partType)
              const autoTyped = part.classificationMethod !== null && part.classificationMethod !== 'manual'
              const inactive = part.isActive === false
              const controlsDisabled = disabled || inactive

              return (
                <TableRow key={part.id} className={cn(!sheetPart && 'bg-slate-50/40', inactive && 'bg-slate-100/70 text-slate-500')}>
                  <TableCell>
                    <div
                      className={cn(
                        'flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-md border border-[#E8ECF0] bg-[#F8F9FA] [&_svg]:max-h-[44px] [&_svg]:max-w-[44px]',
                        inactive && 'opacity-45 grayscale'
                      )}
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
                  <TableCell>
                    <div className="flex min-w-[112px] flex-col gap-1">
                      <Switch
                        size="sm"
                        checked={!inactive}
                        disabled={disabled}
                        onCheckedChange={(checked) => savePart(part, { isActive: checked === true })}
                      />
                      {inactive ? (
                        <Badge variant="outline" className="w-fit border-slate-300 bg-slate-50 text-slate-600">
                          {inactiveReasonLabel(part)}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 font-mono text-xs">
                      <span>{Math.round(part.width)} × {Math.round(part.height)} мм</span>
                      {formatBBox(part) ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex">
                                <Info className="h-3.5 w-3.5 text-[#6B7280]" />
                              </span>
                            }
                          />
                          <TooltipContent>{formatBBox(part)}</TooltipContent>
                        </Tooltip>
                      ) : null}
                      {part.dimensionMismatch ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex">
                                <AlertTriangle className="h-3.5 w-3.5 text-[#D97706]" />
                              </span>
                            }
                          />
                          <TooltipContent>{part.mismatchNote || 'Размеры PDF расходятся с геометрией STEP'}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[150px] items-center gap-2">
                      {editingThicknessPartId === part.id && sheetPart ? (
                        <Input
                          className="h-8 w-24 bg-white"
                          type="number"
                          min={0.1}
                          max={50}
                          step={0.1}
                          autoFocus
                          value={thicknesses[part.id] ?? (part.thickness === null ? '' : String(part.thickness))}
                          disabled={controlsDisabled}
                          onChange={(event) => setThicknesses((current) => ({ ...current, [part.id]: event.target.value }))}
                          onBlur={() => commitThickness(part)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur()
                            }
                            if (event.key === 'Escape') {
                              setThicknesses((current) => ({ ...current, [part.id]: part.thickness === null ? '' : String(part.thickness) }))
                              setEditingThicknessPartId(null)
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="text-left"
                          disabled={controlsDisabled || !sheetPart}
                          onClick={() => sheetPart && setEditingThicknessPartId(part.id)}
                        >
                          <Badge
                            variant="secondary"
                            className={sheetPart ? thicknessClass(thicknessIndex.get(part.thickness ?? 0) ?? 0) : 'bg-slate-100 text-slate-600'}
                          >
                            {formatThickness(part.thickness)}
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
                                <span className="inline-flex items-center gap-1 text-[11px] text-[#1B3A6B]">
                                  <Wrench className="h-4 w-4 text-[#1B3A6B]" />
                                  {part.contourSource === 'UNFOLDED_BREP' ? `${part.bendCount} гиб.` : null}
                                </span>
                              }
                            />
                            <TooltipContent>
                              {part.contourSource === 'UNFOLDED_BREP'
                                ? `Развёртка B-Rep, K=${formatKFactor(part)}`
                                : 'Гнутая деталь'}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {sheetPart && part.classificationWarning ? (
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
                        {sheetPart && part.thicknessMismatch ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex">
                                  <AlertTriangle className="h-4 w-4 text-[#B45309]" />
                                </span>
                              }
                            />
                            <TooltipContent>{part.thicknessMismatchNote || 'Толщина BOM расходится с геометрией STEP'}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={part.material}
                      disabled={controlsDisabled}
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
                      disabled={controlsDisabled || !sheetPart || steelTypes.length === 0}
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
                      disabled={controlsDisabled}
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
                      disabled={controlsDisabled || !sheetPart}
                      onCheckedChange={(checked) => savePart(part, { grainLock: checked === true })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-[150px] flex-col gap-1">
                      <Select
                        value={partType}
                        disabled={controlsDisabled}
                        onValueChange={(value) => savePart(part, { partType: value as PartType })}
                      >
                        <SelectTrigger className="w-[150px] bg-white">
                          <SelectValue>{typeMeta.label}</SelectValue>
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {partTypeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className={typeMeta.className}>{typeMeta.label}</Badge>
                        {autoTyped ? (
                          <Badge variant="outline" className="border-[#DDE3EA] bg-white text-[#6B7280]">авто</Badge>
                        ) : null}
                      </div>
                    </div>
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
