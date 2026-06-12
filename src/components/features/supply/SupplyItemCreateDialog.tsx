"use client"

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
import { createSupplyItem } from '@/lib/actions/supply'
import { useRole } from '@/lib/hooks/useRole'
import { Plus, Loader2 } from 'lucide-react'

export function SupplyItemCreateDialog({ machineId }: { machineId: string }) {
  const { isTechnologist, isSupplyManager, isDirector } = useRole()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const [nomenclature, setNomenclature] = useState('')
  const [unit, setUnit] = useState('шт')
  const [quantity, setQuantity] = useState('1')
  const [supplier, setSupplier] = useState('')
  const [price, setPrice] = useState('0')
  const [date, setDate] = useState<Date | undefined>()
  const [comment, setComment] = useState('')

  const canCreate = isTechnologist || isSupplyManager || isDirector
  if (!canCreate) return null

  const handleSave = async () => {
    if (!nomenclature.trim()) return alert('Введите наименование позиции')
    
    setLoading(true)
    const payload = {
      nomenclature: nomenclature.trim(),
      unit: unit.trim(),
      quantity: parseFloat(quantity) || 1,
      supplier: supplier.trim() || undefined,
      price_per_unit: parseFloat(price) || 0,
      planned_delivery_date: date ? date.toISOString() : undefined,
      comment: comment.trim() || undefined,
    }

    const { success, error } = await createSupplyItem(machineId, payload)
    setLoading(false)

    if (success) {
      setOpen(false)
      // reset
      setNomenclature('')
      setUnit('шт')
      setQuantity('1')
      setSupplier('')
      setPrice('0')
      setDate(undefined)
      setComment('')
    } else {
      alert(`Ошибка: ${error}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" className="bg-[#1B3A6B] hover:bg-[#152D54] text-white gap-2">
          <Plus className="w-4 h-4" />
          Добавить позицию
        </Button>
      } />
      <DialogContent className="bg-white border-[#E8ECF0] text-[#1B3A6B] sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Новая позиция снабжения</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-1.5">
            <Label className="text-[#374151]">Номенклатура *</Label>
            <Input value={nomenclature} onChange={e => setNomenclature(e.target.value)} className="bg-[#F8F9FA] border-[#E8ECF0]" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[#374151]">Количество *</Label>
              <Input type="number" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} className="bg-[#F8F9FA] border-[#E8ECF0]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#374151]">Ед. измерения</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} className="bg-[#F8F9FA] border-[#E8ECF0]" />
            </div>
          </div>

          {(isSupplyManager || isDirector) && (
            <>
              <div className="grid grid-cols-2 gap-4 border-t border-[#E8ECF0] pt-4">
                <div className="space-y-1.5">
                  <Label className="text-[#374151]">Поставщик</Label>
                  <Input value={supplier} onChange={e => setSupplier(e.target.value)} className="bg-[#F8F9FA] border-[#E8ECF0]" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[#374151]">Цена за единицу</Label>
                  <Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} className="bg-[#F8F9FA] border-[#E8ECF0]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[#374151]">План. дата доставки</Label>
                <DatePicker value={date} onChange={setDate} placeholder="Установить дату" />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#374151]">Комментарий</Label>
            <Textarea value={comment} onChange={e => setComment(e.target.value)} className="bg-[#F8F9FA] border-[#E8ECF0] resize-none h-20" />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={loading || !nomenclature.trim()} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white w-full">
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Сохранить позицию
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
