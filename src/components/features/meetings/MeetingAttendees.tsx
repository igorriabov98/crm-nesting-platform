'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, UserCircle, UserPlus, X } from 'lucide-react'
import { ROLES } from '@/lib/constants/roles'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

import { addAttendee, removeAttendee, addExternalAttendee, removeExternalAttendee } from '@/app/(protected)/meetings/actions'
import type { MeetingAttendee, MeetingDetails, MeetingExternalAttendee, UserSummary } from '@/lib/types'

interface MeetingAttendeesProps {
  meeting: MeetingDetails
  users: UserSummary[]
  isDirector: boolean
  currentUser: unknown
}

export function MeetingAttendees({ meeting, users, isDirector }: MeetingAttendeesProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [extOpen, setExtOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [extForm, setExtForm] = useState({ full_name: '', role_description: '', phone: '', email: '' })
  const [isSaving, setIsSaving] = useState(false)

  const attendees = meeting.attendees || []
  const external = meeting.external_attendees || []
  const attendeeUserIds = attendees.map((a) => a.user?.id).filter((id): id is string => Boolean(id))

  // Пользователи, которых ещё нет в собрании
  const availableUsers = users.filter(u => !attendeeUserIds.includes(u.id))

  const handleAddInternal = async () => {
    if (!selectedUserId) return
    setIsSaving(true)
    const res = await addAttendee(meeting.id, selectedUserId)
    if (res.success) {
      toast.success('Участник добавлен')
      setAddOpen(false)
      setSelectedUserId('')
    } else toast.error(res.error)
    setIsSaving(false)
  }

  const handleRemoveInternal = async (userId: string) => {
    const res = await removeAttendee(meeting.id, userId)
    if (res.success) toast.success('Участник удалён')
    else toast.error(res.error)
  }

  const handleAddExternal = async () => {
    if (!extForm.full_name.trim()) return
    setIsSaving(true)
    const res = await addExternalAttendee(meeting.id, extForm)
    if (res.success) {
      toast.success('Участник добавлен')
      setExtOpen(false)
      setExtForm({ full_name: '', role_description: '', phone: '', email: '' })
    } else toast.error(res.error)
    setIsSaving(false)
  }

  const handleRemoveExternal = async (id: string) => {
    const res = await removeExternalAttendee(id, meeting.id)
    if (res.success) toast.success('Удалён')
    else toast.error(res.error)
  }

  return (
    <div className="space-y-6">
      
      {/* Участники из системы */}
      <Card className="p-4 border-[#E8ECF0]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[#1B3A6B] flex items-center gap-2">
            <UserCircle className="w-4 h-4" /> Участники из системы ({attendees.length})
          </h3>
          {isDirector && meeting.status === 'planned' && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Добавить
            </Button>
          )}
        </div>

        {attendees.length === 0 ? (
          <p className="text-sm text-center text-[#9CA3AF] py-4">Нет участников</p>
        ) : (
          <div className="space-y-2">
            {attendees.map((a: MeetingAttendee) => (
              <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${a.attended ? 'bg-green-100 text-green-700' : a.is_confirmed ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                    {a.user?.full_name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1B3A6B]">{a.user?.full_name}</p>
                    <p className="text-xs text-[#9CA3AF]">{ROLES[a.user?.role as keyof typeof ROLES]?.label}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {a.attended ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200 text-xs border">Присутствовал</Badge>
                  ) : a.is_confirmed ? (
                    <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs border">Подтверждён</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-[#9CA3AF]">Не подтверждён</Badge>
                  )}
                  {isDirector && meeting.status === 'planned' && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => a.user?.id && handleRemoveInternal(a.user.id)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Внешние участники */}
      <Card className="p-4 border-[#E8ECF0]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[#1B3A6B] flex items-center gap-2">
            <UserPlus className="w-4 h-4" /> Внешние участники ({external.length})
          </h3>
          {isDirector && meeting.status === 'planned' && (
            <Button size="sm" variant="outline" onClick={() => setExtOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Добавить внешнего
            </Button>
          )}
        </div>

        {external.length === 0 ? (
          <p className="text-sm text-center text-[#9CA3AF] py-4">Нет внешних участников</p>
        ) : (
          <div className="space-y-2">
            {external.map((e: MeetingExternalAttendee) => (
              <div key={e.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-sm font-bold text-orange-700">
                    {e.full_name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#374151]">{e.full_name}</p>
                    {e.role_description && <p className="text-xs text-[#9CA3AF]">{e.role_description}</p>}
                    <div className="flex gap-3 text-xs text-[#9CA3AF] mt-0.5">
                      {e.phone && <span>📞 {e.phone}</span>}
                      {e.email && <span>✉️ {e.email}</span>}
                    </div>
                  </div>
                </div>
                {isDirector && meeting.status === 'planned' && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => handleRemoveExternal(e.id)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Диалог: добавить из системы */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Добавить участника</DialogTitle>
          </DialogHeader>
          <div>
            <Select value={selectedUserId} onValueChange={(v) => setSelectedUserId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите сотрудника..." />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name} — {ROLES[u.role as keyof typeof ROLES]?.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button onClick={handleAddInternal} disabled={!selectedUserId || isSaving} className="bg-[#1B3A6B] text-white">
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог: добавить внешнего */}
      <Dialog open={extOpen} onOpenChange={setExtOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Внешний участник</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Имя *</Label>
              <Input className="mt-1.5" value={extForm.full_name} onChange={e => setExtForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Алексей Козлов" />
            </div>
            <div>
              <Label>Кто/Откуда</Label>
              <Input className="mt-1.5" value={extForm.role_description} onChange={e => setExtForm(f => ({ ...f, role_description: e.target.value }))} placeholder="Поставщик МеталлТрейд" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Телефон</Label>
                <Input className="mt-1.5" value={extForm.phone} onChange={e => setExtForm(f => ({ ...f, phone: e.target.value }))} placeholder="+380..." />
              </div>
              <div>
                <Label>Email</Label>
                <Input className="mt-1.5" type="email" value={extForm.email} onChange={e => setExtForm(f => ({ ...f, email: e.target.value }))} placeholder="alex@..." />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtOpen(false)}>Отмена</Button>
            <Button onClick={handleAddExternal} disabled={!extForm.full_name.trim() || isSaving} className="bg-[#1B3A6B] text-white">
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
