'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Loader2, CheckCircle2, Circle, Clock, User } from 'lucide-react'

import { addActionItem, toggleActionItem } from '@/app/(protected)/meetings/actions'
import type { MeetingActionItem, MeetingDetails, UserSummary } from '@/lib/types'

interface MeetingActionItemsProps {
  meeting: MeetingDetails
  isDirector: boolean
  users: UserSummary[]
}

function parseDateOnly(value: string) {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MeetingActionItems({ meeting, isDirector, users }: MeetingActionItemsProps) {
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState<{
    title: string
    description: string
    responsible_user_id: string | null
    deadline: string
  }>({ title: '', description: '', responsible_user_id: null, deadline: '' })

  const actions = meeting.action_items || []
  const openItems = actions.filter((a) => a.status === 'open')
  const doneItems = actions.filter((a) => a.status === 'done')
  const selectedResponsible = users.find((user) => user.id === form.responsible_user_id)

  const handleAdd = async () => {
    if (!form.title.trim()) return
    if (!form.responsible_user_id) {
      toast.error('Выберите ответственного')
      return
    }
    if (!form.deadline) {
      toast.error('Выберите дедлайн')
      return
    }
    setIsSaving(true)
    const res = await addActionItem(meeting.id, {
      title: form.title,
      description: form.description || undefined,
      responsible_user_id: form.responsible_user_id,
      deadline: form.deadline,
    })
    if (res.success) {
      toast.success('Задача добавлена')
      setOpen(false)
      setForm({ title: '', description: '', responsible_user_id: null, deadline: '' })
    } else toast.error(res.error)
    setIsSaving(false)
  }

  const handleToggle = async (id: string, currentStatus: string) => {
    const res = await toggleActionItem(id, meeting.id, currentStatus)
    if (!res.success) toast.error(res.error)
  }

  const ActionItem = ({ item }: { item: MeetingActionItem }) => (
    <div key={item.id} className={`flex items-start gap-3 p-3 border rounded-lg transition ${item.status === 'done' ? 'bg-gray-50 opacity-70' : 'hover:bg-gray-50'}`}>
      <button onClick={() => handleToggle(item.id, item.status)} className="mt-0.5 shrink-0">
        {item.status === 'done'
          ? <CheckCircle2 className="w-5 h-5 text-green-600" />
          : <Circle className="w-5 h-5 text-[#9CA3AF] hover:text-[#1B3A6B]" />
        }
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${item.status === 'done' ? 'line-through text-[#9CA3AF]' : 'text-[#374151]'}`}>
          {item.title || item.description}
        </p>
        {item.title && item.description && (
          <p className={`mt-0.5 text-xs ${item.status === 'done' ? 'line-through text-[#9CA3AF]' : 'text-[#6B7280]'}`}>
            {item.description}
          </p>
        )}
        <div className="flex flex-wrap gap-3 mt-1.5">
          {item.responsible?.full_name && (
            <span className="flex items-center gap-1 text-xs text-[#6B7280]">
              <User className="w-3 h-3" /> {item.responsible.full_name}
            </span>
          )}
          {item.deadline && (
            <span className="flex items-center gap-1 text-xs text-[#6B7280]">
              <Clock className="w-3 h-3" /> до {new Date(item.deadline).toLocaleDateString('ru-RU')}
            </span>
          )}
          {item.status === 'done' && (
            <Badge className="bg-green-100 text-green-700 border-green-200 border text-xs">✅ Выполнено</Badge>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6B7280]">
          {openItems.length} открытых, {doneItems.length} выполненных
        </p>
        {isDirector && (
          <Button size="sm" onClick={() => setOpen(true)} className="bg-[#1B3A6B] text-white hover:bg-[#2C5282]">
            <Plus className="w-4 h-4 mr-2" /> Добавить задачу
          </Button>
        )}
      </div>

      {actions.length === 0 ? (
        <Card className="p-8 border-dashed border-2 border-[#E8ECF0] text-center">
          <p className="text-sm text-[#9CA3AF]">Задач ещё нет</p>
          <p className="text-xs text-[#C9CDD4] mt-1">Добавьте итоги и задачи собрания</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {openItems.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Открытые</h4>
              <div className="space-y-2">
                {openItems.map((item) => <ActionItem key={item.id} item={item} />)}
              </div>
            </div>
          )}
          {doneItems.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Выполненные</h4>
              <div className="space-y-2">
                {doneItems.map((item) => <ActionItem key={item.id} item={item} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Диалог добавления задачи */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Новая задача</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Название задачи *</Label>
              <Textarea
                className="mt-1.5 min-h-20"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Связаться с поставщиком по листу г/к..."
                rows={2}
              />
            </div>
            <div>
              <Label>Описание (опционально)</Label>
              <Textarea
                className="mt-1.5"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Дополнительные детали задачи..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <Label>Ответственный</Label>
                <Select value={form.responsible_user_id ?? ''} onValueChange={v => setForm(f => ({ ...f, responsible_user_id: v || null }))}>
                  <SelectTrigger className="mt-1.5 w-full min-w-0 overflow-hidden">
                    <SelectValue placeholder="Не назначен">
                      <span className="block min-w-0 truncate">
                        {selectedResponsible?.full_name || 'Не назначен'}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-[240px]">
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <Label>Срок выполнения</Label>
                <DatePicker
                  className="mt-1.5 w-full min-w-0"
                  value={parseDateOnly(form.deadline)}
                  onChange={(date) => setForm((current) => ({ ...current, deadline: date ? formatDateOnly(date) : '' }))}
                  placeholder="Выберите дату"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button
              onClick={handleAdd}
              disabled={!form.title.trim() || !form.responsible_user_id || !form.deadline || isSaving}
              className="bg-[#1B3A6B] text-white"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
