"use client"

import React, { useMemo, useState, useTransition } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

interface PackingListTabProps {
  machine: MachineDetails
  canEdit: boolean
}

function numberInputValue(value: number | null | undefined) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function fallbackGroups(machine: MachineDetails): DraftGroup[] {
  const goods = (machine.machine_items || []).filter((item) => !item.is_sample)
  return goods
    .map((item, index) => {
      const places = Number(item.packing_places || 0)
      if (places <= 0 || !item.packing_type?.trim()) return null
      const rowNumber = String(index + 1)
      return {
        start_item_number: rowNumber,
        end_item_number: rowNumber,
        packing_type_en: item.packing_type.trim(),
        packing_type_ua: '',
        places: String(places),
      }
    })
    .filter((group): group is DraftGroup => Boolean(group))
}

function initialGroups(machine: MachineDetails): DraftGroup[] {
  const groups = machine.machine_packing_groups || []
  if (groups.length === 0) return fallbackGroups(machine)

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

export function PackingListTab({ machine, canEdit }: PackingListTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const goods = useMemo(
    () => [...(machine.machine_items || [])].filter((item) => !item.is_sample).sort((a, b) => a.sort_order - b.sort_order),
    [machine.machine_items],
  )
  const [grossWeight, setGrossWeight] = useState(numberInputValue(machine.packing_gross_weight_kg))
  const [netWeight, setNetWeight] = useState(numberInputValue(machine.packing_net_weight_kg))
  const [summaryEn, setSummaryEn] = useState(machine.packing_summary_en || '')
  const [summaryUa, setSummaryUa] = useState(machine.packing_summary_ua || '')
  const [groups, setGroups] = useState<DraftGroup[]>(() => initialGroups(machine))

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
    const parsedGroups = groups
      .map((group) => ({
        id: group.id,
        start_item_number: Number(group.start_item_number),
        end_item_number: Number(group.end_item_number),
        packing_type_en: group.packing_type_en.trim(),
        packing_type_ua: group.packing_type_ua.trim() || null,
        places: Number(group.places),
      }))
      .filter((group) => group.packing_type_en || group.places || group.start_item_number || group.end_item_number)

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
        gross_weight_kg: parseOptionalNumber(grossWeight),
        net_weight_kg: parseOptionalNumber(netWeight),
        summary_en: summaryEn,
        summary_ua: summaryUa,
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
        <div className="space-y-2">
          <Label htmlFor="packing-gross">Gross weight, kg</Label>
          <Input
            id="packing-gross"
            value={grossWeight}
            onChange={(event) => setGrossWeight(event.target.value)}
            disabled={!canEdit || isPending}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="packing-net">Net weight, kg</Label>
          <Input
            id="packing-net"
            value={netWeight}
            onChange={(event) => setNetWeight(event.target.value)}
            disabled={!canEdit || isPending}
            inputMode="decimal"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="packing-summary-en">TOTAL EN</Label>
          <Input
            id="packing-summary-en"
            value={summaryEn}
            onChange={(event) => setSummaryEn(event.target.value)}
            disabled={!canEdit || isPending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="packing-summary-ua">ВСЬОГО UA</Label>
          <Input
            id="packing-summary-ua"
            value={summaryUa}
            onChange={(event) => setSummaryUa(event.target.value)}
            disabled={!canEdit || isPending}
          />
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
                <TableCell className="text-right">{Number(item.net_weight ?? Number(item.weight) * Number(item.quantity)).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
