'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'

import { addDecision } from '@/app/(protected)/meetings/actions'
import { MATERIAL_TYPES } from '@/lib/constants/meetings'
import type { FactorySummary, MachineRelation, MaterialType, MeetingDecision, MeetingDetails, UserSummary } from '@/lib/types'

interface MeetingDecisionsProps {
  meeting: MeetingDetails
  isDirector: boolean
  users: UserSummary[]
  factories: FactorySummary[]
}

export function MeetingDecisions({ meeting, isDirector, users, factories }: MeetingDecisionsProps) {
  const [open, setOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState<{
    decision_text: string
    machine_id: string | null
    assigned_factory_id: string | null
    assigned_material_type: MaterialType | null
    responsible_user_id: string | null
    deadline: string
  }>({
    decision_text: '',
    machine_id: null,
    assigned_factory_id: null,
    assigned_material_type: null,
    responsible_user_id: null,
    deadline: '',
  })

  const decisions = meeting.decisions || []
  const agendaMachines = (meeting.agenda || []).map((i) => i.machine).filter((machine): machine is MachineRelation => Boolean(machine))

  const handleAdd = async () => {
    if (!form.decision_text.trim()) return
    setIsSaving(true)
    const res = await addDecision(meeting.id, {
      ...form,
      machine_id: form.machine_id || undefined,
      assigned_factory_id: form.assigned_factory_id || undefined,
      assigned_material_type: form.assigned_material_type || undefined,
      responsible_user_id: form.responsible_user_id || undefined,
      deadline: form.deadline || undefined,
    })
    if (res.success) {
      toast.success('Решение добавлено')
      setOpen(false)
      setForm({ decision_text: '', machine_id: null, assigned_factory_id: null, assigned_material_type: null, responsible_user_id: null, deadline: '' })
    } else {
      toast.error(res.error)
    }
    setIsSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6B7280]">{decisions.length} решений принято</p>
        {isDirector && (
          <Button size="sm" onClick={() => setOpen(true)} className="bg-[#1B3A6B] text-white hover:bg-[#2C5282]">
            <Plus className="w-4 h-4 mr-2" /> Добавить решение
          </Button>
        )}
      </div>

      {decisions.length === 0 ? (
        <Card className="p-8 border-dashed border-2 border-[#E8ECF0] text-center">
          <p className="text-sm text-[#9CA3AF]">Решения ещё не приняты</p>
          <p className="text-xs text-[#C9CDD4] mt-1">Решения добавляются во время или после собрания</p>
        </Card>
      ) : (
        <Card className="border-[#E8ECF0] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-transparent">
                <TableHead className="font-semibold text-[#1B3A6B]">Машина</TableHead>
                <TableHead className="font-semibold text-[#1B3A6B]">Решение</TableHead>
                <TableHead className="font-semibold text-[#1B3A6B]">Завод / Материал</TableHead>
                <TableHead className="font-semibold text-[#1B3A6B]">Ответственный</TableHead>
                <TableHead className="font-semibold text-[#1B3A6B]">Срок</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decisions.map((d: MeetingDecision) => (
                <TableRow key={d.id} className="hover:bg-[#F4F6F9]">
                  <TableCell className="font-medium text-[#374151]">
                    {d.machine?.id && d.machine?.name ? (
                      <Link href={`/sales-plan/${d.machine.id}`} className="text-blue-700 hover:underline">
                        {d.machine.name}
                      </Link>
                    ) : (
                      d.machine?.name || <span className="text-[#9CA3AF] italic">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-[#374151] max-w-[200px]">
                    {d.decision_text}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {d.assigned_factory?.name && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                          🏭 {d.assigned_factory.name}
                        </Badge>
                      )}
                      {d.assigned_material_type && d.assigned_material_type !== 'undefined' && (
                        <div>
                          <Badge variant="outline" className="bg-gray-50 text-gray-700 text-xs">
                            {MATERIAL_TYPES[d.assigned_material_type as keyof typeof MATERIAL_TYPES]?.label}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-[#6B7280]">
                    {d.responsible?.full_name || '—'}
                  </TableCell>
                  <TableCell className="text-sm text-[#6B7280]">
                    {d.deadline ? new Date(d.deadline).toLocaleDateString('ru-RU') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Диалог добавления решения */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Добавить решение</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Текст решения *</Label>
              <Textarea
                className="mt-1.5"
                value={form.decision_text}
                onChange={e => setForm(f => ({ ...f, decision_text: e.target.value }))}
                placeholder="Опишите принятое решение..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Машина (если относится)</Label>
                <Select value={form.machine_id ?? ''} onValueChange={v => setForm(f => ({ ...f, machine_id: v || null }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Не выбрана" /></SelectTrigger>
                  <SelectContent>
                    {agendaMachines.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Назначить завод</Label>
                <Select value={form.assigned_factory_id ?? ''} onValueChange={v => setForm(f => ({ ...f, assigned_factory_id: v || null }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Не выбран" /></SelectTrigger>
                  <SelectContent>
                    {factories.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Тип материала</Label>
                <Select value={form.assigned_material_type ?? ''} onValueChange={v => setForm(f => ({ ...f, assigned_material_type: v ? v as MaterialType : null }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Не задан" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MATERIAL_TYPES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Ответственный</Label>
                <Select value={form.responsible_user_id ?? ''} onValueChange={v => setForm(f => ({ ...f, responsible_user_id: v || null }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Не назначен" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Срок (дедлайн)</Label>
                <Input type="date" className="mt-1.5" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>Отмена</Button>
            <Button onClick={handleAdd} disabled={isSaving || !form.decision_text.trim()} className="bg-[#1B3A6B] text-white">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
