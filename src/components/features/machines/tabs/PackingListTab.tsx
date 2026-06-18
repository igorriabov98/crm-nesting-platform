"use client"

import React, { useMemo, useState, useTransition } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
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

export function PackingListTab({ machine, canEdit }: PackingListTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const goods = useMemo(
    () => [...(machine.machine_items || [])].filter((item) => !item.is_sample).sort((a, b) => a.sort_order - b.sort_order),
    [machine.machine_items],
  )
  const [groups, setGroups] = useState<DraftGroup[]>(() => initialGroups(machine))
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
        groups: parsedGroups,
      })

      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить упаковочный лист')
        return
      }

      toast.success('Данные packing list сохранены')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#1B3A6B]">Packing list</h2>
        {canEdit && (
          <Button onClick={save} disabled={isPending} className="bg-[#1B3A6B] text-white hover:bg-[#152D54]">
            <Save className="mr-2 h-4 w-4" />
            Сохранить
          </Button>
        )}
      </div>

      <div className="grid gap-4 rounded-lg border border-[#E8ECF0] bg-white p-4 md:grid-cols-2">
        <div className="rounded-md bg-[#F8F9FA] p-3">
          <div className="text-xs font-medium uppercase text-[#6B7280]">Net weight, kg</div>
          <div className="mt-1 text-lg font-semibold text-[#1B3A6B]">{formatWeight(calculated.netWeight)}</div>
        </div>
        <div className="rounded-md bg-[#F8F9FA] p-3">
          <div className="text-xs font-medium uppercase text-[#6B7280]">Gross weight, kg (+5%)</div>
          <div className="mt-1 text-lg font-semibold text-[#1B3A6B]">{formatWeight(calculated.grossWeight)}</div>
        </div>
        <div className="rounded-md bg-[#F8F9FA] p-3">
          <div className="text-xs font-medium uppercase text-[#6B7280]">TOTAL EN</div>
          <div className="mt-1 text-sm font-medium text-[#374151]">
            TOTAL: {calculated.totalPlaces} places:{calculated.summaryEn}
          </div>
        </div>
        <div className="rounded-md bg-[#F8F9FA] p-3">
          <div className="text-xs font-medium uppercase text-[#6B7280]">ВСЬОГО UA</div>
          <div className="mt-1 text-sm font-medium text-[#374151]">
            ВСЬОГО: {calculated.totalPlaces} місць:{calculated.summaryUa}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-[#E8ECF0] bg-white">
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

      <div className="rounded-md border border-[#E8ECF0] bg-white">
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
            {goods.map((item, index) => (
              <TableRow key={item.id}>
                <TableCell className="text-center text-[#6B7280]">{index + 1}</TableCell>
                <TableCell>
                  <div className="font-medium text-[#111827]">{item.product_name_en || item.product_name}</div>
                  <div className="text-sm text-[#6B7280]">{item.product_name_uk || item.product_name}</div>
                </TableCell>
                <TableCell className="text-center">{item.quantity}</TableCell>
                <TableCell className="text-right">{(Number(item.weight) * Number(item.quantity)).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
