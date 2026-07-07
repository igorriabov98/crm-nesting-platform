'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Inbox, LayoutGrid, List, Send, TimerReset, type LucideIcon } from 'lucide-react'
import { isBefore, startOfToday } from 'date-fns'
import { Button } from '@/components/ui/button'
import { TaskCards } from './TaskCards'
import type { TaskDelegationWithTask, TaskWithRelations } from '@/lib/actions/tasks'

type TaskTab = 'acceptance' | 'active' | 'completed' | 'all'
type TaskViewMode = 'cards' | 'list'

interface MyTasksViewProps {
  tasks: TaskWithRelations[]
  incomingDelegations?: TaskDelegationWithTask[]
  outgoingDelegations?: TaskDelegationWithTask[]
  resultLimit?: number
}

function tasksFromDelegations(delegations: TaskDelegationWithTask[]) {
  const tasks: TaskWithRelations[] = []
  for (const delegation of delegations) {
    if (!delegation.task) continue
    tasks.push({ ...delegation.task, pending_delegation: delegation })
  }
  return tasks
}

export function MyTasksView({
  tasks,
  incomingDelegations = [],
  outgoingDelegations = [],
  resultLimit,
}: MyTasksViewProps) {
  const today = useMemo(() => startOfToday(), [])
  const [localTasks, setLocalTasks] = useState(tasks)
  const incomingTasks = useMemo(() => tasksFromDelegations(incomingDelegations), [incomingDelegations])
  const outgoingTasks = useMemo(() => tasksFromDelegations(outgoingDelegations), [outgoingDelegations])
  const [tab, setTab] = useState<TaskTab>(incomingTasks.length > 0 ? 'acceptance' : 'active')
  const [viewMode, setViewMode] = useState<TaskViewMode>('cards')

  useEffect(() => {
    setLocalTasks(tasks)
  }, [tasks])

  function handleTaskStatusChange(taskId: string, status: TaskWithRelations['status'], completedAt: string | null) {
    setLocalTasks((current) => current.map((task) => (
      task.id === taskId
        ? { ...task, status, completed_at: completedAt, updated_at: new Date().toISOString() }
        : task
    )))
  }

  const activeTasks = useMemo(
    () => localTasks.filter((task) => ['pending', 'in_progress'].includes(task.status)),
    [localTasks],
  )
  const completedTasks = useMemo(
    () => localTasks.filter((task) => task.status === 'completed'),
    [localTasks],
  )
  const overdueTasks = useMemo(
    () => activeTasks.filter((task) => isBefore(new Date(task.deadline), today)),
    [activeTasks, today],
  )
  const inProgressCount = useMemo(
    () => activeTasks.filter((task) => task.status === 'in_progress').length,
    [activeTasks],
  )
  const pendingOutgoingCount = useMemo(
    () => outgoingDelegations.filter((delegation) => delegation.status === 'pending').length,
    [outgoingDelegations],
  )

  const filteredTasks = useMemo(() => {
    if (tab === 'acceptance') return incomingTasks
    if (tab === 'active') return activeTasks
    if (tab === 'completed') return completedTasks
    return localTasks
  }, [activeTasks, completedTasks, incomingTasks, tab, localTasks])

  const tabs: { value: TaskTab; label: string; count: number }[] = [
    { value: 'acceptance', label: 'На принятие', count: incomingTasks.length },
    { value: 'active', label: 'Активные', count: activeTasks.length },
    { value: 'completed', label: 'Завершенные', count: completedTasks.length },
    { value: 'all', label: 'Все', count: localTasks.length },
  ]

  const viewModes: { value: TaskViewMode; label: string; icon: LucideIcon }[] = [
    { value: 'cards', label: 'Карточки', icon: LayoutGrid },
    { value: 'list', label: 'Список', icon: List },
  ]

  const metrics = [
    {
      label: 'Активные',
      value: activeTasks.length,
      description: `В работе: ${inProgressCount}`,
      icon: ClipboardList,
      className: 'border-blue-100 bg-blue-50/70 text-blue-700',
    },
    {
      label: 'Просроченные',
      value: overdueTasks.length,
      description: overdueTasks.length > 0 ? 'Требуют реакции' : 'Сроки в норме',
      icon: AlertTriangle,
      className: overdueTasks.length > 0
        ? 'border-red-100 bg-red-50/80 text-red-700'
        : 'border-slate-200 bg-slate-50 text-slate-600',
    },
    {
      label: 'На принятие',
      value: incomingTasks.length,
      description: incomingTasks.length > 0 ? 'Ждут вашего ответа' : 'Очередь пуста',
      icon: Inbox,
      className: 'border-cyan-100 bg-cyan-50/70 text-cyan-700',
    },
    {
      label: 'Делегированные мной',
      value: outgoingDelegations.length,
      description: pendingOutgoingCount > 0 ? `Ожидают: ${pendingOutgoingCount}` : 'Нет ожидающих',
      icon: Send,
      className: 'border-emerald-100 bg-emerald-50/70 text-emerald-700',
    },
  ]

  const taskContext = tab === 'acceptance' ? 'incoming' : 'standard'

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <TimerReset className="h-4 w-4 text-blue-600" />
              Рабочая очередь
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
              Мои задачи
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Активные задачи, принятие делегирования и история ваших запросов в одном рабочем списке.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Завершено: {completedTasks.length}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <div
                key={metric.label}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase text-slate-500">{metric.label}</div>
                    <div className="mt-2 text-3xl font-semibold tabular-nums text-slate-950">{metric.value}</div>
                    <div className="mt-1 text-sm text-slate-500">{metric.description}</div>
                  </div>
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${metric.className}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => {
            const isSelected = tab === item.value
            return (
              <Button
                key={item.value}
                type="button"
                variant={isSelected ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTab(item.value)}
                className="min-h-10 gap-2 px-3"
              >
                {item.label}
                <span className={isSelected ? 'rounded-full bg-white/20 px-2 text-xs' : 'rounded-full bg-slate-100 px-2 text-xs text-slate-600'}>
                  {item.count}
                </span>
              </Button>
            )
          })}
        </div>

        <div className="flex w-full rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto">
          {viewModes.map((item) => {
            const Icon = item.icon
            return (
              <Button
                key={item.value}
                type="button"
                variant={viewMode === item.value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode(item.value)}
                className="min-h-10 flex-1 gap-2 px-3 sm:flex-none"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Button>
            )
          })}
        </div>
      </div>

      {resultLimit && activeTasks.length >= resultLimit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Показаны ближайшие {resultLimit} активных задач по дедлайну.
        </div>
      )}

      <TaskCards
        tasks={filteredTasks}
        layout={viewMode}
        context={taskContext}
        emptyMessage={tab === 'acceptance' ? 'Нет задач, ожидающих принятия.' : undefined}
        onTaskStatusChange={handleTaskStatusChange}
      />

      {tab === 'active' && outgoingTasks.length > 0 && (
        <section className="space-y-3 border-t border-slate-200 pt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Делегированные мной</h2>
              <p className="text-sm text-slate-500">Последние запросы делегирования и ответы сотрудников.</p>
            </div>
          </div>
          <TaskCards
            tasks={outgoingTasks}
            layout={viewMode}
            context="outgoing"
            compact
            emptyMessage="Нет делегированных задач."
          />
        </section>
      )}
    </div>
  )
}
