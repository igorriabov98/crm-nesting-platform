'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, isBefore, startOfToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock3,
  Factory,
  FileText,
  PlayCircle,
  Send,
  UserCheck,
  UserRound,
  UserX,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  consumable_request_review: 'Заявка на расходники',
  consumable_request_shortage: 'Недопоставка расходника',
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
type TaskActionLayout = 'row' | 'rail'

function getTaskTone(status: TaskStatus, overdue: boolean) {
  if (overdue) {
    return {
      strip: 'before:bg-red-500',
      rowStrip: 'border-l-red-500',
      iconWrap: 'border-red-200 bg-red-50 text-red-700',
      badge: 'border-red-200 bg-red-50 text-red-700',
      date: 'text-red-700',
    }
  }

  if (status === 'completed') {
    return {
      strip: 'before:bg-emerald-500',
      rowStrip: 'border-l-emerald-500',
      iconWrap: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      date: 'text-slate-600',
    }
  }

  if (status === 'in_progress') {
    return {
      strip: 'before:bg-amber-500',
      rowStrip: 'border-l-amber-500',
      iconWrap: 'border-amber-200 bg-amber-50 text-amber-700',
      badge: 'border-amber-200 bg-amber-50 text-amber-700',
      date: 'text-slate-600',
    }
  }

  if (status === 'cancelled') {
    return {
      strip: 'before:bg-slate-400',
      rowStrip: 'border-l-slate-300',
      iconWrap: 'border-slate-200 bg-slate-50 text-slate-500',
      badge: 'border-slate-200 bg-slate-100 text-slate-500',
      date: 'text-slate-500',
    }
  }

  return {
    strip: 'before:bg-blue-500',
    rowStrip: 'border-l-blue-500',
    iconWrap: 'border-blue-200 bg-blue-50 text-blue-700',
    badge: 'border-blue-200 bg-blue-50 text-blue-700',
    date: 'text-slate-600',
  }
}

function formatTaskDate(value: string | null | undefined) {
  return value ? format(new Date(value), 'dd.MM.yyyy', { locale: ru }) : '—'
}

function getTaskTarget(task: TaskWithRelations) {
  if (task.machine) {
    return {
      href: `${ROUTES.SALES_PLAN}/${task.machine.id}`,
      label: task.machine.name,
      kind: 'Машина',
    }
  }

  if (task.product_project) {
    return {
      href: `${ROUTES.PRODUCT_PROJECTS}/${task.product_project.id}`,
      label: task.product_project.title,
      kind: 'Проект',
    }
  }

  return null
}

function isConsumableTask(taskType: TaskType) {
  return taskType === 'consumable_request_review' || taskType === 'consumable_request_shortage'
}

function getTaskTypeBadgeClass(taskType: TaskType) {
  return isConsumableTask(taskType)
    ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
    : 'border-slate-200 bg-slate-50 text-slate-700'
}

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
      <div className="flex min-h-32 items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-600">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
          <ClipboardList className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-slate-900">Рабочий список пуст</div>
          <div className="mt-1 break-words [overflow-wrap:anywhere]">
            {emptyMessage || 'Задач пока нет. Они появятся автоматически после выбора завода, типа материала и плановой даты поставки.'}
          </div>
        </div>
      </div>
    )
  }

  const renderStatusBadge = (task: TaskWithRelations, overdue: boolean) => {
    const tone = getTaskTone(task.status, overdue)
    return (
      <Badge variant="outline" className={cn('h-6 rounded-full px-2.5', tone.badge)}>
        {overdue ? 'Просрочена' : STATUS_LABELS[task.status]}
      </Badge>
    )
  }

  const renderDelegationBadge = (task: TaskWithRelations) => {
    const delegation = task.pending_delegation
    if (!delegation) return null
    const visual = DELEGATION_VISUALS[delegation.status]
    return (
      <Badge variant="outline" className={cn('h-6 rounded-full px-2.5', visual.badge)}>
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
      <div className={cn('space-y-1 rounded-lg border px-3 py-2 text-xs leading-5', visual.panel)}>
        <div className="font-medium">{directionLabel}</div>
        <div>{delegation.department?.name || 'Отдел'} · {DELEGATION_STATUS_LABELS[delegation.status]}</div>
        {delegation.note && <div className={visual.mutedText}>Комментарий: {delegation.note}</div>}
        {delegation.decline_reason && (
          <div className={cn('font-medium', visual.text)}>Причина отказа: {delegation.decline_reason}</div>
        )}
      </div>
    )
  }

  const renderActions = (
    task: TaskWithRelations,
    nextStatus: TaskStatus | null,
    actionLabel: string | null,
    actionLayout: TaskActionLayout = 'row'
  ) => {
    const pendingDelegation = task.pending_delegation
    const isPendingDelegation = pendingDelegation?.status === 'pending'
    const groupClass = actionLayout === 'rail'
      ? 'flex w-full flex-col gap-2'
      : 'flex w-full flex-wrap gap-2 sm:justify-end'
    const buttonClass = actionLayout === 'rail'
      ? 'min-h-11 w-full justify-center gap-1.5'
      : 'min-h-11 shrink-0 gap-1.5'

    if (context === 'incoming' && isPendingDelegation) {
      return (
        <div className={groupClass}>
          <Button
            size="sm"
            onClick={() => handleAcceptDelegation(task)}
            disabled={updatingId === pendingDelegation.id}
            className={buttonClass}
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
            className={cn(buttonClass, 'border-red-200 text-red-700 hover:bg-red-50')}
          >
            <UserX className="h-4 w-4" />
            Отказаться
          </Button>
        </div>
      )
    }

    if (isPendingDelegation) {
      return (
        <div className={groupClass}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleCancelDelegation(task)}
            disabled={updatingId === pendingDelegation.id}
            className={cn(buttonClass, 'border-slate-300 text-slate-700 hover:bg-slate-50')}
          >
            Отменить делегирование
          </Button>
        </div>
      )
    }

    if (context === 'outgoing' && pendingDelegation) return null

    if (
      nextStatus === 'completed'
      && (task.task_type === 'consumable_request_review' || task.task_type === 'consumable_request_shortage')
    ) {
      return null
    }

    if (!nextStatus || !actionLabel) return null

    return (
      <div className={groupClass}>
        <Button
          size="sm"
          variant={task.status === 'pending' ? 'outline' : 'default'}
          onClick={() => handleStatusChange(task.id, nextStatus)}
          disabled={updatingId === task.id}
          className={buttonClass}
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
            className={cn(buttonClass, 'border-amber-200 text-amber-700 hover:bg-amber-50')}
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
            className={cn(buttonClass, 'border-cyan-200 text-cyan-700 hover:bg-cyan-50')}
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
            className="min-h-11"
          >
            Отмена
          </Button>
          <Button
            onClick={handleCompleteWithoutRequest}
            disabled={!!updatingId || reason.trim().length < 3}
            className="min-h-11"
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
              className="min-h-11"
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={!selectedCandidate || !!updatingId || delegationLoading}
              className="min-h-11 gap-1.5"
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
            className="min-h-11"
          >
            Назад
          </Button>
          <Button
            onClick={handleDeclineDelegation}
            disabled={!!updatingId || declineReason.trim().length < 3}
            className="min-h-11 bg-red-600 hover:bg-red-700"
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
            <Button type="button" variant="outline" onClick={() => setDeliverablesTask(null)} className="min-h-11">
              Отмена
            </Button>
            <Button type="submit" disabled={!!deliverablesTask && updatingId === deliverablesTask.id} className="min-h-11">
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
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <Table className="min-w-[1240px] table-fixed">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[16%]" />
            </colgroup>
            <TableHeader className="sticky top-0 z-10 bg-slate-100/95">
              <TableRow className="border-slate-200 hover:bg-transparent">
                <TableHead className="h-11 whitespace-normal px-4 text-xs font-semibold uppercase text-slate-600">Задача</TableHead>
                <TableHead className="h-11 whitespace-normal px-3 text-xs font-semibold uppercase text-slate-600">Статус</TableHead>
                <TableHead className="h-11 whitespace-normal px-3 text-xs font-semibold uppercase text-slate-600">Исполнитель</TableHead>
                <TableHead className="h-11 whitespace-normal px-3 text-xs font-semibold uppercase text-slate-600">Сроки</TableHead>
                <TableHead className="h-11 whitespace-normal px-3 text-xs font-semibold uppercase text-slate-600">Делегирование</TableHead>
                <TableHead className="h-11 whitespace-normal px-3 text-right text-xs font-semibold uppercase text-slate-600">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const deadline = new Date(task.deadline)
                const overdue = ['pending', 'in_progress'].includes(task.status) && isBefore(deadline, today)
                const Icon = getStatusIcon(task.status, overdue)
                const nextStatus = getNextStatus(task.status)
                const actionLabel = getActionLabel(task.status)
                const tone = getTaskTone(task.status, overdue)
                const target = getTaskTarget(task)
                const TargetIcon = target?.kind === 'Машина' ? Factory : FileText
                const delegation = task.pending_delegation
                const delegationVisual = delegation ? DELEGATION_VISUALS[delegation.status] : null
                const actions = renderActions(task, nextStatus, actionLabel, 'row')

                return (
                  <TableRow
                    key={task.id}
                    className={cn(
                      'border-l-4 border-slate-200 bg-white hover:bg-slate-50',
                      tone.rowStrip,
                      task.status === 'cancelled' && 'opacity-75'
                    )}
                  >
                    <TableCell className="whitespace-normal px-4 py-3 align-top">
                      <div className="flex min-w-0 gap-3">
                        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', tone.iconWrap)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold leading-snug text-slate-950 [overflow-wrap:anywhere]">
                            {task.title}
                          </div>
                          {target && (
                            <Link
                              href={target.href}
                              className="mt-1 flex max-w-full items-start gap-1.5 text-sm font-medium text-blue-700 hover:underline"
                            >
                              <TargetIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                {target.kind}: {target.label}
                              </span>
                            </Link>
                          )}
                          {task.description && (
                            <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]">
                              {task.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 py-3 align-top">
                      <div className="flex flex-col items-start gap-2">
                        <Badge variant="outline" className={cn('h-6 rounded-full px-2.5', getTaskTypeBadgeClass(task.task_type))}>
                          {TASK_TYPE_LABELS[task.task_type]}
                        </Badge>
                        {renderStatusBadge(task, overdue)}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 py-3 align-top">
                      <div className="flex min-w-0 items-start gap-2 text-sm text-slate-700">
                        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span className="break-words leading-5 [overflow-wrap:anywhere]">
                          {task.assigned_user?.full_name || 'Не назначен'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 py-3 align-top">
                      <div className="space-y-1.5 text-xs tabular-nums">
                        <div className="flex items-center gap-2 text-slate-600">
                          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="w-14 text-slate-500">Старт</span>
                          <span>{formatTaskDate(task.start_date)}</span>
                        </div>
                        <div className={cn('flex items-center gap-2 font-medium', tone.date)}>
                          <Clock3 className="h-3.5 w-3.5 shrink-0" />
                          <span className="w-14">Дедлайн</span>
                          <span>{formatTaskDate(task.deadline)}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 py-3 align-top">
                      {delegation ? (
                        <div className={cn('rounded-lg border px-2.5 py-2 text-xs leading-5', delegationVisual?.panel)}>
                          {renderDelegationBadge(task)}
                          <div className="mt-1 font-medium">
                            {context === 'incoming'
                              ? `От: ${delegation.delegated_by_user?.full_name || 'Руководитель'}`
                              : `Кому: ${delegation.delegated_to_user?.full_name || 'Сотрудник'}`}
                          </div>
                          <div className="text-slate-600">{delegation.department?.name || 'Отдел'}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Нет</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 py-3 text-right align-top">
                      <div className="flex justify-end">
                        {actions || <span className="text-xs text-slate-400">Нет действий</span>}
                      </div>
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
      <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 2xl:grid-cols-2')}>
        {tasks.map((task) => {
          const deadline = new Date(task.deadline)
          const overdue = ['pending', 'in_progress'].includes(task.status) && isBefore(deadline, today)
          const Icon = getStatusIcon(task.status, overdue)
          const nextStatus = getNextStatus(task.status)
          const actionLabel = getActionLabel(task.status)
          const tone = getTaskTone(task.status, overdue)
          const target = getTaskTarget(task)
          const TargetIcon = target?.kind === 'Машина' ? Factory : FileText
          const actions = renderActions(task, nextStatus, actionLabel, 'rail')

          return (
            <article
              key={task.id}
              className={cn(
                'relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-colors before:absolute before:inset-y-0 before:left-0 before:w-1 hover:border-slate-300 hover:shadow-md',
                tone.strip,
                task.status === 'cancelled' && 'opacity-80'
              )}
            >
              <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_180px]">
                <div className="min-w-0 space-y-3 pl-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn('h-6 rounded-full px-2.5', getTaskTypeBadgeClass(task.task_type))}>
                      {TASK_TYPE_LABELS[task.task_type]}
                    </Badge>
                    {renderStatusBadge(task, overdue)}
                    <span
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium tabular-nums',
                        overdue ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'
                      )}
                    >
                      <CalendarDays className="h-3 w-3" />
                      {formatTaskDate(task.deadline)}
                    </span>
                    {renderDelegationBadge(task)}
                  </div>

                  <div className="flex min-w-0 gap-3">
                    <div className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', tone.iconWrap)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold leading-snug text-slate-950 [overflow-wrap:anywhere]">
                        {task.title}
                      </h3>
                      {target && (
                        <Link
                          href={target.href}
                          className="mt-1 flex max-w-full items-start gap-1.5 text-sm font-medium text-blue-700 hover:underline"
                        >
                          <TargetIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                            {target.kind}: {target.label}
                          </span>
                        </Link>
                      )}
                    </div>
                  </div>

                  {task.description && (
                    <div className="break-words rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700 [overflow-wrap:anywhere]">
                      {task.description}
                    </div>
                  )}

                  <div className="grid gap-2 text-xs sm:grid-cols-3">
                    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-1.5 font-medium text-slate-500">
                        <UserRound className="h-3.5 w-3.5" />
                        Исполнитель
                      </div>
                      <div className="mt-1 break-words text-slate-900 [overflow-wrap:anywhere]">
                        {task.assigned_user?.full_name || 'Не назначен'}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 tabular-nums">
                      <div className="flex items-center gap-1.5 font-medium text-slate-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        Старт
                      </div>
                      <div className="mt-1 text-slate-900">{formatTaskDate(task.start_date)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 tabular-nums">
                      <div className={cn('flex items-center gap-1.5 font-medium', overdue ? 'text-red-700' : 'text-slate-500')}>
                        <Clock3 className="h-3.5 w-3.5" />
                        Дедлайн
                      </div>
                      <div className={cn('mt-1 font-medium', tone.date)}>{formatTaskDate(task.deadline)}</div>
                    </div>
                  </div>

                  {renderDelegationDetails(task)}
                </div>

                <div className="flex min-w-0 flex-col gap-2 border-t border-slate-200 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <div className="text-xs font-semibold uppercase text-slate-500">Действия</div>
                  {actions || <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">Нет доступных действий</div>}
                </div>
              </div>
            </article>
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
