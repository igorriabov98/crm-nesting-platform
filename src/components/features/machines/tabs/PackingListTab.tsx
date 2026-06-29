"use client"

import React, { useMemo, useState, useTransition } from 'react'
import { PackageCheck, Plus, Save, Trash2, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { updateMachinePackingSettings } from '@/app/(protected)/sales-plan/actions'
import { MACHINE_DELIVERY_BASIS_OPTIONS, MACHINE_DELIVERY_BASIS_VALUES, type MachineDeliveryBasisType } from '@/lib/constants/machine-delivery-basis'
import { cn } from '@/lib/utils'
import type { MachineDetails } from '@/lib/types'

type DraftGroup = {
  id?: string
  start_item_number: string
  end_item_number: string
  packing_type_en: string
  packing_type_ua: string
  places: string
}

type ParsedDraftGroup = {
  id?: string
  start_item_number: number
  end_item_number: number
  packing_type_en: string
  packing_type_ua: string | null
  places: number
}

type MachineGoodsItem = NonNullable<MachineDetails['machine_items']>[number]

type GoodsGroup = {
  uktzed: string
  items: MachineGoodsItem[]
}

type PreviewGoodsGroup = {
  uktzed: string
  items: Array<{
    item: MachineGoodsItem
    number: number
  }>
}

interface PackingListTabProps {
  machine: MachineDetails
  canEdit: boolean
}

function initialGroups(machine: MachineDetails): DraftGroup[] {
  const groups = machine.machine_packing_groups || []

  return [...groups]
    .sort((a, b) => {
      const byOrder = (a.sort_order || 0) - (b.sort_order || 0)
      return byOrder || a.start_item_number - b.start_item_number
    })
    .map((group) => ({
      id: group.id,
      start_item_number: String(group.start_item_number),
      end_item_number: String(group.end_item_number),
      packing_type_en: group.packing_type_en || '',
      packing_type_ua: group.packing_type_ua || '',
      places: String(group.places),
    }))
}

function parseDraftGroups(groups: DraftGroup[]): ParsedDraftGroup[] {
  return groups
    .map((group) => ({
      id: group.id,
      start_item_number: Number(group.start_item_number),
      end_item_number: Number(group.end_item_number),
      packing_type_en: group.packing_type_en.trim(),
      packing_type_ua: group.packing_type_ua.trim() || null,
      places: Number(group.places),
    }))
    .filter((group) => group.packing_type_en || group.places || group.start_item_number || group.end_item_number)
}

function formatWeight(value: number) {
  const safeValue = Number.isFinite(value) ? value : 0
  return safeValue.toFixed(3).replace(/\.?0+$/, '')
}

function pluralizeEn(type: string, count: number) {
  if (!type) return count === 1 ? 'place' : 'places'
  if (count === 1 || type.endsWith('s')) return type
  if (type.endsWith('y')) return `${type.slice(0, -1)}ies`
  return `${type}s`
}

function joinSummaryParts(parts: string[], conjunction: string) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`
}

function packingSummaryFromGroups(groups: ParsedDraftGroup[], language: 'en' | 'ua') {
  const totals = new Map<string, number>()
  for (const group of groups) {
    if (!Number.isFinite(group.places) || group.places <= 0) continue
    const type = language === 'en'
      ? group.packing_type_en
      : group.packing_type_ua || group.packing_type_en
    if (!type) continue
    totals.set(type, (totals.get(type) || 0) + group.places)
  }

  const parts = Array.from(totals.entries()).map(([type, count]) => (
    language === 'en' ? `${count} ${pluralizeEn(type, count)}` : `${count} ${type}`
  ))

  return joinSummaryParts(parts, language === 'en' ? 'and' : 'та')
}

function groupGoodsByHsCode(items: MachineGoodsItem[]): GoodsGroup[] {
  const groups: GoodsGroup[] = []

  for (const item of items) {
    const uktzed = item.product_uktzed || '-'
    const current = groups.find((group) => group.uktzed === uktzed)
    if (current) {
      current.items.push(item)
    } else {
      groups.push({ uktzed, items: [item] })
    }
  }

  return groups
}

export function PackingListTab({ machine, canEdit }: PackingListTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const goodsGroups = useMemo(
    () => groupGoodsByHsCode(
      [...(machine.machine_items || [])]
        .filter((item) => !item.is_sample)
        .sort((a, b) => a.sort_order - b.sort_order),
    ),
    [machine.machine_items],
  )
  const goods = useMemo(() => goodsGroups.flatMap((group) => group.items), [goodsGroups])
  const previewGoodsGroups = useMemo<PreviewGoodsGroup[]>(() => {
    return goodsGroups.reduce<{ groups: PreviewGoodsGroup[]; nextNumber: number }>(
      (acc, group) => ({
        groups: [
          ...acc.groups,
          {
            uktzed: group.uktzed,
            items: group.items.map((item, index) => ({
              item,
              number: acc.nextNumber + index,
            })),
          },
        ],
        nextNumber: acc.nextNumber + group.items.length,
      }),
      { groups: [], nextNumber: 1 },
    ).groups
  }, [goodsGroups])
  const [groups, setGroups] = useState<DraftGroup[]>(() => initialGroups(machine))
  const [deliveryBasisType, setDeliveryBasisType] = useState<MachineDeliveryBasisType | ''>(
    () => machine.delivery_basis_type || '',
  )
  const calculated = useMemo(() => {
    const netWeight = goods.reduce(
      (sum, item) => sum + Number(item.weight || 0) * Number(item.quantity || 0),
      0,
    )
    const grossWeight = netWeight * 1.05
    const parsedGroups = parseDraftGroups(groups).filter(
      (group) => group.packing_type_en && Number.isFinite(group.places) && group.places > 0,
    )
    const totalPlaces = parsedGroups.reduce((sum, group) => sum + group.places, 0)
    const summaryEn = packingSummaryFromGroups(parsedGroups, 'en') || '-'
    const summaryUa = packingSummaryFromGroups(parsedGroups, 'ua') || summaryEn

    return {
      netWeight,
      grossWeight,
      totalPlaces,
      summaryEn,
      summaryUa,
    }
  }, [goods, groups])

  const updateGroup = (index: number, patch: Partial<DraftGroup>) => {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group))
  }

  const addGroup = () => {
    const lastEnd = groups.length > 0
      ? Number(groups[groups.length - 1].end_item_number || groups[groups.length - 1].start_item_number || 0)
      : 0
    const nextRow = Math.min(Math.max(lastEnd + 1, 1), Math.max(goods.length, 1))
    setGroups((current) => [
      ...current,
      {
        start_item_number: String(nextRow),
        end_item_number: String(nextRow),
        packing_type_en: 'Pack',
        packing_type_ua: 'пачка',
        places: '1',
      },
    ])
  }

  const removeGroup = (index: number) => {
    setGroups((current) => current.filter((_, groupIndex) => groupIndex !== index))
  }

  const save = () => {
    if (!deliveryBasisType) {
      toast.error('Выберите базис доставки')
      return
    }

    const parsedGroups = parseDraftGroups(groups)

    for (const group of parsedGroups) {
      if (!Number.isInteger(group.start_item_number) || group.start_item_number < 1) {
        toast.error('Проверьте начальный номер строки упаковки')
        return
      }
      if (!Number.isInteger(group.end_item_number) || group.end_item_number < group.start_item_number) {
        toast.error('Проверьте конечный номер строки упаковки')
        return
      }
      if (group.end_item_number > goods.length) {
        toast.error(`Диапазон упаковки не может быть больше количества товаров (${goods.length})`)
        return
      }
      if (!group.packing_type_en) {
        toast.error('Укажите тип упаковки EN')
        return
      }
      if (!Number.isInteger(group.places) || group.places < 1) {
        toast.error('Количество мест должно быть больше 0')
        return
      }
    }

    startTransition(async () => {
      const result = await updateMachinePackingSettings(machine.id, {
        delivery_basis_type: deliveryBasisType,
        groups: parsedGroups,
      })

      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить настройки машины')
        return
      }

      toast.success('Настройки машины сохранены')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700">
            <PackageCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-slate-950">Настройки машины</h2>
        </div>
        {canEdit && (
          <Button onClick={save} disabled={isPending} className="min-h-11 bg-blue-950 text-white hover:bg-blue-900">
            <Save className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
          <Truck className="h-4 w-4 text-blue-950" aria-hidden="true" />
          Базис доставки
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {MACHINE_DELIVERY_BASIS_VALUES.map((value) => {
            const option = MACHINE_DELIVERY_BASIS_OPTIONS[value]
            const active = deliveryBasisType === value

            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={!canEdit || isPending}
                onClick={() => setDeliveryBasisType(value)}
                className={cn(
                  'min-h-28 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-70',
                  active
                    ? 'border-blue-950 bg-blue-50 text-blue-950 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/60',
                )}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-2 block text-sm font-medium">{option.deliveryBasisEn}</span>
                <span className="mt-1 block text-sm">{option.deliveryBasisUa}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase text-[#6B7280]">Net weight, kg</div>
          <div className="mt-1 text-lg font-semibold text-[#1B3A6B]">{formatWeight(calculated.netWeight)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase text-[#6B7280]">Gross weight, kg (+5%)</div>
          <div className="mt-1 text-lg font-semibold text-[#1B3A6B]">{formatWeight(calculated.grossWeight)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase text-[#6B7280]">TOTAL EN</div>
          <div className="mt-1 text-sm font-medium text-[#374151]">
            TOTAL: {calculated.totalPlaces} places:{calculated.summaryEn}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase text-[#6B7280]">ВСЬОГО UA</div>
          <div className="mt-1 text-sm font-medium text-[#374151]">
            ВСЬОГО: {calculated.totalPlaces} місць:{calculated.summaryUa}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow>
              <TableHead className="w-24 text-[#6B7280]">С</TableHead>
              <TableHead className="w-24 text-[#6B7280]">По</TableHead>
              <TableHead className="text-[#6B7280]">Packing type EN</TableHead>
              <TableHead className="text-[#6B7280]">Тип упаковки UA</TableHead>
              <TableHead className="w-28 text-right text-[#6B7280]">Places</TableHead>
              {canEdit && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 6 : 5} className="h-20 text-center text-[#9CA3AF]">
                  Нет упаковочных групп
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group, index) => (
                <TableRow key={group.id || index}>
                  <TableCell>
                    <Input
                      value={group.start_item_number}
                      onChange={(event) => updateGroup(index, { start_item_number: event.target.value })}
                      disabled={!canEdit || isPending}
                      inputMode="numeric"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={group.end_item_number}
                      onChange={(event) => updateGroup(index, { end_item_number: event.target.value })}
                      disabled={!canEdit || isPending}
                      inputMode="numeric"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={group.packing_type_en}
                      onChange={(event) => updateGroup(index, { packing_type_en: event.target.value })}
                      disabled={!canEdit || isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={group.packing_type_ua}
                      onChange={(event) => updateGroup(index, { packing_type_ua: event.target.value })}
                      disabled={!canEdit || isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={group.places}
                      onChange={(event) => updateGroup(index, { places: event.target.value })}
                      disabled={!canEdit || isPending}
                      inputMode="numeric"
                      className="text-right"
                    />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeGroup(index)}
                        disabled={isPending}
                        className="text-[#DC2626] hover:bg-red-50 hover:text-[#B91C1C]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {canEdit && (
        <Button type="button" variant="outline" onClick={addGroup} disabled={isPending}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить группу
        </Button>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow>
              <TableHead className="w-14 text-center text-[#6B7280]">№</TableHead>
              <TableHead className="text-[#6B7280]">Товар</TableHead>
              <TableHead className="w-28 text-center text-[#6B7280]">Q-ty</TableHead>
              <TableHead className="w-32 text-right text-[#6B7280]">Net, kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewGoodsGroups.map((group) => (
              <React.Fragment key={group.uktzed}>
                <TableRow className="bg-slate-50">
                  <TableCell colSpan={4} className="text-center text-xs font-semibold uppercase text-[#6B7280]">
                    HS code (код УКТЗЕД) {group.uktzed}
                  </TableCell>
                </TableRow>
                {group.items.map(({ item, number }) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-center text-[#6B7280]">{number}</TableCell>
                    <TableCell>
                      <div className="font-medium text-[#111827]">{item.product_name_en || item.product_name}</div>
                      <div className="text-sm text-[#6B7280]">{item.product_name_uk || item.product_name}</div>
                    </TableCell>
                    <TableCell className="text-center">{item.quantity}</TableCell>
                    <TableCell className="text-right">{(Number(item.weight) * Number(item.quantity)).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
