'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, isBefore, startOfToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CheckCircle2, Circle, Clock3, PlayCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/constants/routes'
import { completeTechnologistTaskWithoutRequest, updateTaskStatus, type TaskWithRelations } from '@/lib/actions/tasks'
import type { TaskStatus, TaskType } from '@/lib/types'

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

interface TaskCardsProps {
  tasks: TaskWithRelations[]
  compact?: boolean
  layout?: 'cards' | 'list'
}

export function TaskCards({ tasks, compact = false, layout = 'cards' }: TaskCardsProps) {
  const router = useRouter()
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [reasonTask, setReasonTask] = useState<TaskWithRelations | null>(null)
  const [reason, setReason] = useState('')
  const today = useMemo(() => startOfToday(), [])

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    setUpdatingId(taskId)
    try {
      const result = await updateTaskStatus(taskId, status)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить задачу')
      toast.success('Статус задачи обновлён')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить задачу')
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
        Задач пока нет. Они появятся автоматически после выбора завода, типа материала и плановой даты поставки.
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

  const renderActions = (task: TaskWithRelations, nextStatus: TaskStatus | null, actionLabel: string | null) => {
    if (!nextStatus || !actionLabel) return null

    return (
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        <Button
          size="sm"
          variant={task.status === 'pending' ? 'outline' : 'default'}
          onClick={() => handleStatusChange(task.id, nextStatus)}
          disabled={updatingId === task.id}
          className="shrink-0"
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
            className="shrink-0 border-amber-200 text-amber-700 hover:bg-amber-50"
          >
            Завершить без заявки
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
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Например: машина отменена, материалы не требуются, заявка будет создана позже..."
          rows={5}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setReasonTask(null)
              setReason('')
            }}
            disabled={!!updatingId}
          >
            Отмена
          </Button>
          <Button onClick={handleCompleteWithoutRequest} disabled={!!updatingId || reason.trim().length < 3}>
            Завершить и создать задачу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (layout === 'list') {
    return (
      <>
        <div className="rounded-lg border border-[#E8ECF0] bg-white">
          <Table className="min-w-[1280px] table-fixed">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
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

                return (
                  <TableRow
                    key={task.id}
                    className={cn(
                      'border-[#E8ECF0] hover:bg-[#F8F9FA]',
                      task.status === 'completed' && 'bg-emerald-50/40',
                      task.status === 'cancelled' && 'bg-slate-50 opacity-80',
                      overdue && 'bg-red-50/60'
                    )}
                  >
                    <TableCell className="whitespace-normal px-4 align-top">
                      <div className="min-w-0 space-y-1">
                        <div className="break-words [overflow-wrap:anywhere] font-medium leading-snug text-slate-900">{task.title}</div>
                        {task.machine && (
                          <Link
                            href={`${ROUTES.SALES_PLAN}/${task.machine.id}`}
                            className="inline-block max-w-full break-words [overflow-wrap:anywhere] text-sm text-blue-700 hover:underline"
                          >
                            {task.machine.name}
                          </Link>
                        )}
                        {task.description && (
                          <div className="line-clamp-3 break-words [overflow-wrap:anywhere] text-xs leading-snug text-amber-700">{task.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top">
                      <Badge variant="outline">{TASK_TYPE_LABELS[task.task_type]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal px-3 align-top">{renderStatusBadge(task, overdue)}</TableCell>
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

          return (
            <Card
              key={task.id}
              className={cn(
                'border-slate-200 shadow-sm',
                task.status === 'completed' && 'border-emerald-200 bg-emerald-50/50',
                task.status === 'in_progress' && 'border-amber-200 bg-amber-50/50',
                task.status === 'cancelled' && 'border-slate-200 bg-slate-50 opacity-70',
                overdue && 'border-red-200 bg-red-50/60'
              )}
            >
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-start gap-2">
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        task.status === 'completed' && 'text-emerald-600',
                        task.status === 'in_progress' && 'text-amber-600',
                        task.status === 'cancelled' && 'text-slate-400',
                        overdue && 'text-red-600',
                        task.status === 'pending' && !overdue && 'text-blue-600'
                      )}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{task.title}</div>
                      {task.machine && (
                        <Link
                          href={`${ROUTES.SALES_PLAN}/${task.machine.id}`}
                          className="text-sm text-blue-700 hover:underline"
                        >
                          {task.machine.name}
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge variant="outline">{TASK_TYPE_LABELS[task.task_type]}</Badge>
                    {renderStatusBadge(task, overdue)}
                    <span>Исполнитель: {task.assigned_user?.full_name || 'Не назначен'}</span>
                    {startDate && <span>Начать: {format(startDate, 'dd.MM.yyyy', { locale: ru })}</span>}
                    <span>Дедлайн: {format(deadline, 'dd.MM.yyyy', { locale: ru })}</span>
                  </div>

                  {task.description && (
                    <div className="text-xs text-amber-700">{task.description}</div>
                  )}
                </div>

                {renderActions(task, nextStatus, actionLabel)}
              </CardContent>
            </Card>
          )
        })}
      </div>
      {reasonDialog}
    </>
  )
}
