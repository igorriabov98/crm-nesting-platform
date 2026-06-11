'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { assignFactoryDirectly } from '@/app/(protected)/meetings/actions'
import { MATERIAL_TYPES } from '@/lib/constants/meetings'
import type { FactorySummary, MachineRelation, MaterialType } from '@/lib/types'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'

interface AssignFactoryDialogProps {
  machine: MachineRelation
  factories: FactorySummary[]
  meetingId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AssignFactoryDialog({ machine, factories, meetingId, open, onOpenChange }: AssignFactoryDialogProps) {
  const [selectedFactory, setSelectedFactory] = useState<string>('')
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialType>('undefined')
  const [isSaving, setIsSaving] = useState(false)

  const handleAssign = async () => {
    if (!selectedFactory) {
      toast.error('Выберите завод')
      return
    }

    setIsSaving(true)
    try {
      const res = await assignFactoryDirectly(machine.id, selectedFactory, selectedMaterial, meetingId)
      if (res.success) {
        toast.success('Завод назначен', {
          description: `Машина «${machine.name}» назначена на завод`
        })
        onOpenChange(false)
      } else {
        toast.error('Ошибка', { description: res.error })
      }
    } catch (e: unknown) {
      toast.error('Системная ошибка', { description: e instanceof Error ? e.message : 'Неизвестная ошибка' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#1B3A6B]">Назначить завод</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Машина: <strong className="text-[#374151]">{machine.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Инфо по машине */}
          <div className="grid grid-cols-3 gap-3 text-center bg-gray-50 rounded-lg p-3">
            {machine.item_count !== undefined && (
              <div>
                <p className="text-xs text-[#9CA3AF]">Товаров</p>
                <p className="font-bold text-[#1B3A6B]">{machine.item_count}</p>
              </div>
            )}
            {machine.total_weight !== undefined && (
              <div>
                <p className="text-xs text-[#9CA3AF]">Вес</p>
                <p className="font-bold text-[#1B3A6B]">{machine.total_weight.toFixed(1)} т</p>
              </div>
            )}
            {machine.total_cost !== undefined && (
              <div>
                <p className="text-xs text-[#9CA3AF]">Стоимость</p>
                <p className="font-bold text-[#1B3A6B]">€{machine.total_cost.toLocaleString()}</p>
              </div>
            )}
          </div>

          {/* Выбор завода */}
          <div>
            <Label>Завод *</Label>
            <Select value={selectedFactory} onValueChange={(v) => setSelectedFactory(v ?? '')}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Выберите завод..." />
              </SelectTrigger>
              <SelectContent>
                {factories.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Выбор типа материала */}
          <div>
            <Label>Тип материала</Label>
            <Select value={selectedMaterial} onValueChange={(v) => v && setSelectedMaterial(v as MaterialType)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MATERIAL_TYPES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleAssign} disabled={isSaving || !selectedFactory} className="bg-[#1B3A6B] text-white hover:bg-[#2C5282]">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Назначить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
