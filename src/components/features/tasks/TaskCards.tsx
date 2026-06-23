'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, isBefore, startOfToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CheckCircle2, Circle, Clock3, PlayCircle, Send, UserCheck, UserX, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/constants/routes'
import {
  acceptTaskDelegation,
  cancelTaskDelegation,
  completeTechnologistTaskWithoutRequest,
  declineTaskDelegation,
  delegateTask,
  getDelegationCandidates,
  updateTaskStatus,
  type TaskDelegationCandidate,
  type TaskWithRelations,
} from '@/lib/actions/tasks'
import { saveProductProjectEngineeringDeliverables } from '@/lib/actions/products'
import type { TaskDelegationStatus, TaskStatus, TaskType } from '@/lib/types'

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  supply_start: 'Снабжение',
  technologist_request: 'Заявка технолога',
  engineer_confirm: 'Чертежи',
  agenda_pool_distribution: 'Пул повесток',
  meeting_unresolved_agenda: 'Повестка собрания',
  meeting_action_item: 'Задача собрания',
  machine_review: 'Ознакомление с машиной',
  technologist_request_exception: 'Причина без заявки',
  transport_cost: 'Транспорт',
  product_project_engineering: 'Проект изделия',
  product_project_sales_review: 'Согласование изделия',
}

const DELEGATION_STATUS_LABELS: Record<TaskDelegationStatus, string> = {
  pending: 'Ожидает принятия',
  accepted: 'Принято',
  declined: 'Отказано',
  cancelled: 'Отменено',
}

const DELEGATION_VISUALS: Record<TaskDelegationStatus, {
  badge: string
  panel: string
  text: string
  mutedText: string
  row: string
  card: string
  icon: string
}> = {
  pending: {
    badge: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    panel: 'border-cyan-100 bg-cyan-50/60 text-cyan-800',
    text: 'text-cyan-800',
    mutedText: 'text-cyan-700',
    row: 'bg-cyan-50/40',
    card: 'border-cyan-200 bg-cyan-50/50',
    icon: 'text-cyan-700',
  },
  accepted: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    panel: 'border-emerald-100 bg-emerald-50/60 text-emerald-800',
    text: 'text-emerald-800',
    mutedText: 'text-emerald-700',
    row: 'bg-emerald-50/40',
    card: 'border-emerald-200 bg-emerald-50/50',
    icon: 'text-emerald-700',
  },
  declined: {
    badge: 'border-red-200 bg-red-50 text-red-700',
    panel: 'border-red-100 bg-red-50/60 text-red-800',
    text: 'text-red-800',
    mutedText: 'text-red-700',
    row: 'bg-red-50/40',
    card: 'border-red-200 bg-red-50/50',
    icon: 'text-red-700',
  },
  cancelled: {
    badge: 'border-slate-200 bg-slate-100 text-slate-600',
    panel: 'border-slate-200 bg-slate-50 text-slate-700',
    text: 'text-slate-700',
    mutedText: 'text-slate-600',
    row: 'bg-slate-50/60',
    card: 'border-slate-200 bg-slate-50',
    icon: 'text-slate-500',
  },
}

type TaskCardContext = 'standard' | 'incoming' | 'outgoing'

function getStatusIcon(status: TaskStatus, overdue: boolean) {
  if (status === 'completed') return CheckCircle2
  if (status === 'cancelled') return XCircle
  if (status === 'in_progress') return PlayCircle
  return overdue ? Clock3 : Circle
}

function getNextStatus(status: TaskStatus): TaskStatus | null {
  if (status === 'pending') return 'in_progress'
  if (status === 'in_progress') return 'completed'
  return null
}

function getActionLabel(status: TaskStatus) {
  if (status === 'pending') return 'В работу'
  if (status === 'in_progress') return 'Завершить'
  return null
}

function candidateKey(candidate: TaskDelegationCandidate) {
  return `${candidate.user_id}:${candidate.department_id}`
}

interface TaskCardsProps {
  tasks: TaskWithRelations[]
  compact?: boolean
  layout?: 'cards' | 'list'
  context?: TaskCardContext
  emptyMessage?: string
}

export function TaskCards({
  tasks,
  compact = false,
  layout = 'cards',
  context = 'standard',
  emptyMessage,
}: TaskCardsProps) {
  const router = useRouter()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [reasonTask, setReasonTask] = useState<TaskWithRelations | null>(null)
  const [deliverablesTask, setDeliverablesTask] = useState<TaskWithRelations | null>(null)
  const [delegationTask, setDelegationTask] = useState<TaskWithRelations | null>(null)
  const [declineTask, setDeclineTask] = useState<TaskWithRelations | null>(null)
  const [delegationCandidates, setDelegationCandidates] = useState<TaskDelegationCandidate[]>([])
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('')
  const [delegationNote, setDelegationNote] = useState('')
  const [delegationLoading, setDelegationLoading] = useState(false)
  const [reason, setReason] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [deliverablesWeight, setDeliverablesWeight] = useState('')
  const drawingInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const today = useMemo(() => startOfToday(), [])

  const selectedCandidate = delegationCandidates.find((candidate) => candidateKey(candidate) === selectedCandidateKey) || null

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    setUpdatingId(taskId)
    try {
      const result = await updateTaskStatus(taskId, status)
      if (!result.success) {
        if (result.code === 'PROJECT_DELIVERABLES_REQUIRED') {
          const task = tasks.find((item) => item.id === taskId) || null
          setDeliverablesTask(task)
          setDeliverablesWeight('')
          throw new Error(result.error || 'Заполните данные проекта')
        }
        throw new Error(result.error || 'Не удалось обновить задачу')
      }
      toast.success('Статус задачи обновлён')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить задачу')
    } finally {
      setUpdatingId(null)
    }
  }

  const openDelegationDialog = async (task: TaskWithRelations) => {
    setDelegationTask(task)
    setDelegationCandidates([])
    setSelectedCandidateKey('')
    setDelegationNote('')
    setDelegationLoading(true)
    try {
      const result = await getDelegationCandidates(task.id)
      if (result.error) throw new Error(result.error)
      const candidates = result.data || []
      setDelegationCandidates(candidates)
      setSelectedCandidateKey(candidates[0] ? candidateKey(candidates[0]) : '')
      if (candidates.length === 0) {
        toast.error('Нет активных сотрудников в ваших отделах')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить сотрудников')
      setDelegationTask(null)
    } finally {
      setDelegationLoading(false)
    }
  }

  const handleDelegateSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!delegationTask || !selectedCandidate) return
    setUpdatingId(delegationTask.id)
    try {
      const result = await delegateTask({
        taskId: delegationTask.id,
        delegatedTo: selectedCandidate.user_id,
        departmentId: selectedCandidate.department_id,
        note: delegationNote,
      })
      if (!result.success) throw new Error(result.error || 'Не удалось делегировать задачу')
      toast.success('Задача отправлена на принятие')
      setDelegationTask(null)
      setDelegationCandidates([])
      setSelectedCandidateKey('')
      setDelegationNote('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось делегировать задачу')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleAcceptDelegation = async (task: TaskWithRelations) => {
    const delegationId = task.pending_delegation?.id
    if (!delegationId) return
    setUpdatingId(delegationId)
    try {
      const result = await acceptTaskDelegation(delegationId)
      if (!result.success) throw new Error(result.error || 'Не удалось принять задачу')
      toast.success('Задача принята')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось принять задачу')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDeclineDelegation = async () => {
    const delegationId = declineTask?.pending_delegation?.id
    if (!delegationId) return
    setUpdatingId(delegationId)
    try {
      const result = await declineTaskDelegation(delegationId, declineReason)
      if (!result.success) throw new Error(result.error || 'Не удалось отказаться от задачи')
      toast.success('Отказ отправлен руководителю')
      setDeclineTask(null)
      setDeclineReason('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отказаться от задачи')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleCancelDelegation = async (task: TaskWithRelations) => {
    const delegationId = task.pending_delegation?.id
    if (!delegationId) return
    setUpdatingId(delegationId)
    try {
      const result = await cancelTaskDelegation(delegationId)
      if (!result.success) throw new Error(result.error || 'Не удалось отменить делегирование')
      toast.success('Делегирование отменено')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отменить делегирование')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleDeliverablesSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!deliverablesTask?.product_project_id) return
    const drawing = drawingInputRef.current?.files?.[0]
    const photo = photoInputRef.current?.files?.[0]
    if (!drawing || !photo || !deliverablesWeight) {
      toast.error('Загрузите чертеж, фото и укажите вес')
      return
    }

    setUpdatingId(deliverablesTask.id)
    try {
      const formData = new FormData()
      formData.append('project_id', deliverablesTask.product_project_id)
      formData.append('drawing', drawing)
      formData.append('photo', photo)
      formData.append('unit_weight_kg', deliverablesWeight)
      const saveResult = await saveProductProjectEngineeringDeliverables(formData)
      if (!saveResult.success) throw new Error(saveResult.error || 'Не удалось сохранить данные проекта')
      const closeResult = await updateTaskStatus(deliverablesTask.id, 'completed')
      if (!closeResult.success) throw new Error(closeResult.error || 'Не удалось завершить задачу')
      toast.success('Данные проекта сохранены, задача завершена')
      setDeliverablesTask(null)
      setDeliverablesWeight('')
      if (drawingInputRef.current) drawingInputRef.current.value = ''
      if (photoInputRef.current) photoInputRef.current.value = ''
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить данные проекта')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleCompleteWithoutRequest = async () => {
    if (!reasonTask) return
    setUpdatingId(reasonTask.id)
    try {
      const result = await completeTechnologistTaskWithoutRequest(reasonTask.id, reason)
      if (!result.success) throw new Error(result.error || 'Не удалось завершить задачу без заявки')
      toast.success('Задача завершена, причина передана директору планирования')
      setReasonTask(null)
      setReason('')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось завершить задачу без заявки')
    } finally {
      setUpdatingId(null)
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        {emptyMessage || 'Задач пока нет. Они появятся автоматически после выбора завода, типа материала и плановой даты поставки.'}
      </div>
    )
  }

  const renderStatusBadge = (task: TaskWithRelations, overdue: boolean) => (
    <Badge
      variant="outline"
      className={cn(
        task.status === 'completed' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        task.status === 'in_progress' && 'border-amber-200 bg-amber-50 text-amber-700',
        task.status === 'cancelled' && 'border-slate-200 bg-slate-100 text-slate-500',
        task.status === 'pending' && !overdue && 'border-blue-200 bg-blue-50 text-blue-700',
        overdue && 'border-red-200 bg-red-50 text-red-700'
      )}
    >
      {overdue ? 'Просрочена' : STATUS_LABELS[task.status]}
    </Badge>
  )

  const renderDelegationBadge = (task: TaskWithRelations) => {
    const delegation = task.pending_delegation
    if (!delegation) return null
    const visual = DELEGATION_VISUALS[delegation.status]
    return (
      <Badge variant="outline" className={visual.badge}>
        {DELEGATION_STATUS_LABELS[delegation.status]}
      </Badge>
    )
  }

  const renderDelegationDetails = (task: TaskWithRelations) => {
    const delegation = task.pending_delegation
    if (!delegation) return null
    const visual = DELEGATION_VISUALS[delegation.status]

    const directionLabel = context === 'incoming'
      ? `От: ${delegation.delegated_by_user?.full_name || 'Руководитель'}`
      : `Кому: ${delegation.delegated_to_user?.full_name || 'Сотрудник'}`

    return (
      <div className={cn('space-y-1 rounded-md border px-3 py-2 text-xs', visual.panel)}>
        <div className="font-medium">{directionLabel}</div>
        <div>{delegation.department?.name || 'Отдел'} · {DELEGATION_STATUS_LABELS[delegation.status]}</div>
        {delegation.note && <div className={visual.mutedText}>Комментарий: {delegation.note}</div>}
        {delegation.decline_reason && (
          <div className={cn('font-medium', visual.text)}>Причина отказа: {delegation.decline_reason}</div>
        )}
      </div>
    )
  }

  const renderActions = (task: TaskWithRelations, nextStatus: TaskStatus | null, actionLabel: string | null) => {
    const pendingDelegation = task.pending_delegation
    const isPendingDelegation = pendingDelegation?.status === 'pending'

    if (context === 'incoming' && isPendingDelegation) {
      return (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button
            size="sm"
            onClick={() => handleAcceptDelegation(task)}
            disabled={updatingId === pendingDelegation.id}
            className="min-h-10 shrink-0 gap-1.5"
          >
            <UserCheck className="h-4 w-4" />
            Принять
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDeclineTask(task)
              setDeclineReason('')
            }}
            disabled={updatingId === pendingDelegation.id}
            className="min-h-10 shrink-0 gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
          >
            <UserX className="h-4 w-4" />
            Отказаться
          </Button>
        </div>
      )
    }

    if (isPendingDelegation) {
      return (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleCancelDelegation(task)}
            disabled={updatingId === pendingDelegation.id}
            className="min-h-10 shrink-0 border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Отменить делегирование
          </Button>
        </div>
      )
    }

    if (context === 'outgoing' && pendingDelegation) return null

    if (!nextStatus || !actionLabel) return null

    return (
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        <Button
          size="sm"
          variant={task.status === 'pending' ? 'outline' : 'default'}
          onClick={() => handleStatusChange(task.id, nextStatus)}
          disabled={updatingId === task.id}
          className="min-h-10 shrink-0"
        >
          {actionLabel}
        </Button>
        {task.task_type === 'technologist_request' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setReasonTask(task)
              setReason('')
            }}
            disabled={updatingId === task.id}
            className="min-h-10 shrink-0 border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            Завершить без заявки
          </Button>
        )}
        {context === 'standard' && task.can_delegate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openDelegationDialog(task)}
            disabled={updatingId === task.id}
            className="min-h-10 shrink-0 gap-1.5 border-cyan-200 text-cyan-700 hover:bg-cyan-50"
          >
            <Send className="h-4 w-4" />
            Делегировать
          </Button>
        )}
      </div>
    )
  }

  const reasonDialog = (
    <Dialog open={!!reasonTask} onOpenChange={(open) => {
      if (!open) {
        setReasonTask(null)
        setReason('')
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Причина завершения без заявки</DialogTitle>
          <DialogDescription>
            Укажите, почему заявка технолога не передаётся в снабжение. Директору планирования будет создана задача на ознакомление.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="complete_without_request_reason">Причина *</Label>
          <Textarea
            id="complete_without_request_reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Например: машина отменена, материалы не требуются, заявка будет создана позже..."
            rows={5}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setReasonTask(null)
              setReason('')
            }}
            disabled={!!updatingId}
            className="min-h-10"
          >
            Отмена
          </Button>
          <Button
            onClick={handleCompleteWithoutRequest}
            disabled={!!updatingId || reason.trim().length < 3}
            className="min-h-10"
          >
            Завершить и создать задачу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const delegationDialog = (
    <Dialog open={!!delegationTask} onOpenChange={(open) => {
      if (!open) {
        setDelegationTask(null)
        setDelegationCandidates([])
        setSelectedCandidateKey('')
        setDelegationNote('')
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Делегировать задачу</DialogTitle>
          <DialogDescription>
            Выберите активного сотрудника из вашего отдела. Задача останется за вами, пока сотрудник не нажмёт «Принять».
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleDelegateSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delegation_candidate">Сотрудник *</Label>
            <select
              id="delegation_candidate"
              value={selectedCandidateKey}
              onChange={(event) => setSelectedCandidateKey(event.target.value)}
              disabled={delegationLoading || delegationCandidates.length === 0}
              className="min-h-11 w-full rounded-md border border-[#E8ECF0] bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-60"
              required
            >
              {delegationCandidates.map((candidate) => (
                <option key={candidate.membership_id} value={candidateKey(candidate)}>
                  {candidate.full_name} · {candidate.department_name}{candidate.position_name ? ` · ${candidate.position_name}` : ''}
                </option>
              ))}
            </select>
            {delegationLoading ? (
              <p className="text-xs text-slate-500">Загружаю сотрудников отдела...</p>
            ) : delegationCandidates.length === 0 ? (
              <p className="text-xs text-red-600">Нет доступных активных сотрудников для делегирования.</p>
            ) : (
              <p className="text-xs text-slate-500">Сотрудник получит запрос на принятие задачи.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="delegation_note">Комментарий</Label>
            <Textarea
              id="delegation_note"
              value={delegationNote}
              onChange={(event) => setDelegationNote(event.target.value)}
              placeholder="Коротко поясните, что нужно сделать или на что обратить внимание."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDelegationTask(null)}
              disabled={!!updatingId}
              className="min-h-10"
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={!selectedCandidate || !!updatingId || delegationLoading}
              className="min-h-10 gap-1.5"
            >
              <Send className="h-4 w-4" />
              Отправить на принятие
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  const declineDialog = (
    <Dialog open={!!declineTask} onOpenChange={(open) => {
      if (!open) {
        setDeclineTask(null)
        setDeclineReason('')
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отказаться от задачи</DialogTitle>
          <DialogDescription>
            Укажите причину отказа. Руководитель увидит её в уведомлении и сможет выбрать другого исполнителя.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delegation_decline_reason">Причина отказа *</Label>
          <Textarea
            id="delegation_decline_reason"
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
            placeholder="Например: нет доступа к материалам, конфликт по срокам, задача не относится к моей зоне..."
            rows={5}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setDeclineTask(null)
              setDeclineReason('')
            }}
            disabled={!!updatingId}
            className="min-h-10"
          >
            Назад
          </Button>
          <Button
            onClick={handleDeclineDelegation}
            disabled={!!updatingId || declineReason.trim().length < 3}
            className="min-h-10 bg-red-600 hover:bg-red-700"
          >
            Отказаться
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  const deliverablesDialog = (
    <Dialog open={!!deliverablesTask} onOpenChange={(open) => {
      if (!open) {
        setDeliverablesTask(null)
        setDeliverablesWeight('')
        if (drawingInputRef.current) drawingInputRef.current.value = ''
        if (photoInputRef.current) photoInputRef.current.value = ''
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Данные проекта изделия</DialogTitle>
          <DialogDescription>
            Загрузите чертеж, фото изделия и укажите вес. Номер чертежа будет взят из имени файла без расширения.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleDeliverablesSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project_drawing">Чертеж *</Label>
            <Input id="project_drawing" ref={drawingInputRef} type="file" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project_photo">Фото изделия *</Label>
            <Input id="project_photo" ref={photoInputRef} type="file" accept="image/*" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project_weight">Вес изделия, кг *</Label>
            <Input
              id="project_weight"
              type="number"
              min="0"
              step="0.001"
              value={deliverablesWeight}
              onChange={(event) => setDeliverablesWeight(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeliverablesTask(null)} className="min-h-10">
              Отмена
            </Button>
            <Button type="submit" disabled={!!deliverablesTask && updatingId === deliverablesTask.id} className="min-h-10">
              Сохранить и завершить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  if (layout === 'list') {
    return (
      <>
        <div className="overflow-x-auto rounded-lg border border-[#E8ECF0] bg-white">
          <Table className="min-w-[1360px] table-fixed">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
              <col className="w-[14%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[12%]" />
            </colgroup>
            <TableHeader className="bg-[#F8F9FA]">
              <TableRow className="border-[#E8ECF0] hover:bg-transparent">
                <TableHead className="whitespace-normal px-4 text-[#6B7280]">Задача</TableHead>
                <TableHead className="whitespace-normal px-3 text-[#6B7280]">Тип</TableHead>
                <TableHead className="whitespace-normal px-3 text-[#6B7280]">Статус</TableHead>
                <TableHead className="whitespace-normal px-3 text-[#6B7280]">Исполнитель</TableHead>
                <TableHead className="whitespace-normal px-3 text-[#6B7280]">Начать</TableHead>
                <TableHead className="whitespace-normal px-3 text-[#6B7280]">Дедлайн</TableHead>
                <TableHead className="whitespace-normal px-3 text-right text-[#6B7280]">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const deadline = new Date(task.deadline)
                const startDate = task.start_date ? new Date(task.start_date) : null
                const overdue = ['pending', 'in_progress'].includes(task.status) && isBefore(deadline, today)
                const nextStatus = getNextStatus(task.status)
                const actionLabel = getActionLabel(task.status)
                const delegationVisual = task.pending_delegation
                  ? DELEGATION_VISUALS[task.pending_delegation.status]
                  : null

                return (
                  <TableRow
                    key={task.id}
                    className={cn(
                      'border-[#E8ECF0] hover:bg-[#F8F9FA]',
                      task.status === 'completed' && 'bg-emerald-50/40',
                      task.status === 'cancelled' && 'bg-slate-50 opacity-80',
                      overdue && 'bg-red-50/60',
                      delegationVisual?.row
                    )}
                  >
                    <TableCell className="whitespace-normal px-4 align-top">
                      <div className="min-w-0 space-y-2">
                        <div className="break-words [overflow-wrap:anywhere] font-medium leading-snug text-slate-900">{task.title}</div>
                        {task.machine && (
                          <Link
                            href={`${ROUTES.SALES_PLAN}/${task.machine.id}`}
                            className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-sm text-blue-700 hover:underline"
                          >
                            {task.machine.name}
                          </Link>
                        )}
                        {task.product_project && (
                          <Link
                            href={`${ROUTES.PRODUCT_PROJECTS}/${task.product_project.id}`}
                            className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-sm text-blue-700 hover:underline"
                          >
                            {task.product_project.title}
                          </Link>
                        )}
                        {task.description && (
                          <div className="line-clamp-3 break-words [overflow-wrap:anywhere] text-xs leading-snug text-amber-700">{task.description}</div>
                        )}
                        {renderDelegationDetails(task)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top">
                      <Badge variant="outline">{TASK_TYPE_LABELS[task.task_type]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top">
                      <div className="flex flex-col items-start gap-1">
                        {renderStatusBadge(task, overdue)}
                        {renderDelegationBadge(task)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top text-sm text-slate-600">
                      {task.assigned_user?.full_name || 'Не назначен'}
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top text-sm text-slate-600">
                      {startDate ? format(startDate, 'dd.MM.yyyy', { locale: ru }) : '-'}
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top text-sm text-slate-600">
                      {format(deadline, 'dd.MM.yyyy', { locale: ru })}
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 text-right align-top">
                      {renderActions(task, nextStatus, actionLabel)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {reasonDialog}
        {delegationDialog}
        {declineDialog}
        {deliverablesDialog}
      </>
    )
  }

  return (
    <>
      <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2')}>
        {tasks.map((task) => {
          const deadline = new Date(task.deadline)
          const startDate = task.start_date ? new Date(task.start_date) : null
          const overdue = ['pending', 'in_progress'].includes(task.status) && isBefore(deadline, today)
          const Icon = getStatusIcon(task.status, overdue)
          const nextStatus = getNextStatus(task.status)
          const actionLabel = getActionLabel(task.status)
          const delegationVisual = task.pending_delegation
            ? DELEGATION_VISUALS[task.pending_delegation.status]
            : null

          return (
            <Card
              key={task.id}
              className={cn(
                'border-slate-200 shadow-sm',
                task.status === 'completed' && 'border-emerald-200 bg-emerald-50/50',
                task.status === 'in_progress' && 'border-amber-200 bg-amber-50/50',
                task.status === 'cancelled' && 'border-slate-200 bg-slate-50 opacity-70',
                overdue && 'border-red-200 bg-red-50/60',
                delegationVisual?.card
              )}
            >
              <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-start gap-2">
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        task.status === 'completed' && 'text-emerald-600',
                        task.status === 'in_progress' && 'text-amber-600',
                        task.status === 'cancelled' && 'text-slate-400',
                        overdue && 'text-red-600',
                        task.status === 'pending' && !overdue && 'text-blue-600',
                        delegationVisual?.icon
                      )}
                    />
                    <div className="min-w-0">
                      <div className="break-words [overflow-wrap:anywhere] font-medium leading-snug text-slate-900">{task.title}</div>
                      {task.machine && (
                        <Link
                          href={`${ROUTES.SALES_PLAN}/${task.machine.id}`}
                          className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-sm text-blue-700 hover:underline"
                        >
                          {task.machine.name}
                        </Link>
                      )}
                      {task.product_project && (
                        <Link
                          href={`${ROUTES.PRODUCT_PROJECTS}/${task.product_project.id}`}
                          className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-sm text-blue-700 hover:underline"
                        >
                          {task.product_project.title}
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge variant="outline">{TASK_TYPE_LABELS[task.task_type]}</Badge>
                    {renderStatusBadge(task, overdue)}
                    {renderDelegationBadge(task)}
                    <span>Исполнитель: {task.assigned_user?.full_name || 'Не назначен'}</span>
                    {startDate && <span>Начать: {format(startDate, 'dd.MM.yyyy', { locale: ru })}</span>}
                    <span>Дедлайн: {format(deadline, 'dd.MM.yyyy', { locale: ru })}</span>
                  </div>

                  {task.description && (
                    <div className="break-words [overflow-wrap:anywhere] text-xs text-amber-700">{task.description}</div>
                  )}
                  {renderDelegationDetails(task)}
                </div>

                {renderActions(task, nextStatus, actionLabel)}
              </CardContent>
            </Card>
          )
        })}
      </div>
      {reasonDialog}
      {delegationDialog}
      {declineDialog}
      {deliverablesDialog}
    </>
  )
}
