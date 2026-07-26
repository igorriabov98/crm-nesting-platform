import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Inbox,
  Search,
  Send,
  UserRound,
} from 'lucide-react'
import { CreateDepartmentRequestForm } from '@/components/features/department-requests/CreateDepartmentRequestForm'
import { RequestActionSubmit } from '@/components/features/department-requests/RequestActionSubmit'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateDepartmentRequest, type DepartmentRequestWorkspace } from '@/lib/actions/department-requests'
import {
  DEPARTMENT_REQUEST_PRIORITY_LABELS,
  DEPARTMENT_REQUEST_STATUS_LABELS,
  DEPARTMENT_REQUEST_TARGETS,
  type DepartmentRequestPriority,
  type DepartmentRequestStatus,
} from '@/lib/department-requests'
import { cn } from '@/lib/utils'

const priorityStyles: Record<DepartmentRequestPriority, string> = {
  low: 'border-slate-200 bg-slate-50 text-slate-600',
  normal: 'border-blue-200 bg-blue-50 text-blue-700',
  high: 'border-amber-200 bg-amber-50 text-amber-800',
  urgent: 'border-red-200 bg-red-50 text-red-700',
}

const statusStyles: Record<DepartmentRequestStatus, string> = {
  new: 'border-blue-200 bg-blue-50 text-blue-700',
  in_progress: 'border-violet-200 bg-violet-50 text-violet-700',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function queryHref(route: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const suffix = query.toString()
  return suffix ? `${route}?${suffix}` : route
}

export function DepartmentRequestsPage({
  workspace,
  search,
  factoryId,
}: {
  workspace: DepartmentRequestWorkspace
  search: string
  factoryId?: string
}) {
  const config = DEPARTMENT_REQUEST_TARGETS[workspace.target]
  const activeCount = workspace.requests.filter((request) => ['new', 'in_progress'].includes(request.status)).length
  const urgentCount = workspace.requests.filter((request) => request.priority === 'urgent' && !['done', 'rejected', 'cancelled'].includes(request.status)).length
  const doneCount = workspace.requests.filter((request) => request.status === 'done').length

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-6 pb-10">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[#F7F9FC]">
        <div className="grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[1fr_auto] lg:items-end lg:px-9 lg:py-8">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1B3A6B]">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1B3A6B] text-white">
                <Inbox className="h-4 w-4" />
              </span>
              Рабочие запросы
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Запросы · {config.label}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              {config.description}. Ваши исходящие запросы доступны только вам и сотрудникам адресного отдела.
            </p>
            <Link
              href="#new-request"
              className={cn(buttonVariants({ variant: 'default' }), 'mt-5 min-h-11 bg-[#1B3A6B] px-4 text-white hover:bg-[#152f59]')}
            >
              <Send className="h-4 w-4" />
              Создать запрос
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: 'Активные', value: activeCount, icon: Clock3, tone: 'text-blue-700 bg-blue-100' },
              { label: 'Срочные', value: urgentCount, icon: AlertTriangle, tone: 'text-red-700 bg-red-100' },
              { label: 'Готово', value: doneCount, icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-100' },
            ].map((stat) => (
              <div key={stat.label} className="min-w-24 rounded-2xl border border-slate-200 bg-white px-3 py-3.5 sm:min-w-32 sm:px-4">
                <stat.icon className={cn('mb-3 h-7 w-7 rounded-lg p-1.5', stat.tone)} />
                <div className="text-2xl font-bold tabular-nums text-slate-950">{stat.value}</div>
                <div className="text-xs text-slate-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex w-fit rounded-xl bg-slate-100 p-1">
                <Link
                  href={queryHref(config.route, { view: 'mine', factory: factoryId })}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors',
                    workspace.view === 'mine' ? 'bg-white text-[#1B3A6B]' : 'text-slate-600 hover:text-slate-950',
                  )}
                >
                  <Send className="h-4 w-4" />
                  Мои запросы
                </Link>
                {workspace.canManageInbox && (
                  <Link
                    href={queryHref(config.route, { view: 'inbox', factory: factoryId })}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors',
                      workspace.view === 'inbox' ? 'bg-white text-[#1B3A6B]' : 'text-slate-600 hover:text-slate-950',
                    )}
                  >
                    <Inbox className="h-4 w-4" />
                    Входящие
                  </Link>
                )}
              </div>

              <form method="get" className="flex w-full gap-2 lg:max-w-sm">
                <input type="hidden" name="view" value={workspace.view} />
                {factoryId && <input type="hidden" name="factory" value={factoryId} />}
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    name="q"
                    defaultValue={search}
                    aria-label="Поиск запросов"
                    placeholder="Поиск по запросам"
                    className="h-11 pl-9"
                  />
                </div>
                <Button type="submit" variant="outline" className="h-11 px-4">Найти</Button>
              </form>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>{workspace.view === 'mine' ? 'Отправленные вами' : 'Адресованные вашему отделу'}</span>
              <span className="tabular-nums">Найдено: {workspace.total}</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {workspace.requests.length === 0 ? (
              <div className="flex min-h-80 flex-col items-center justify-center px-6 py-16 text-center">
                <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <Inbox className="h-7 w-7" />
                </span>
                <h2 className="text-lg font-semibold text-slate-900">
                  {search ? 'По вашему поиску ничего нет' : 'Запросов пока нет'}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {workspace.view === 'mine'
                    ? `Создайте первый нестандартный запрос ${config.recipientLabel} в форме справа.`
                    : 'Новые запросы сотрудников появятся здесь автоматически.'}
                </p>
              </div>
            ) : workspace.requests.map((request) => (
              <article key={request.id} id={`request-${request.id}`} className="px-4 py-5 sm:px-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusStyles[request.status])}>
                      {DEPARTMENT_REQUEST_STATUS_LABELS[request.status]}
                    </span>
                    <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', priorityStyles[request.priority])}>
                      {DEPARTMENT_REQUEST_PRIORITY_LABELS[request.priority]}
                    </span>
                    {request.due_date && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        до {formatDate(request.due_date)}
                      </span>
                    )}
                  </div>

                  <div>
                    <h2 className="text-lg font-semibold leading-6 text-slate-950">{request.title}</h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{request.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="h-3.5 w-3.5" />
                      {workspace.view === 'inbox' ? request.creator?.full_name || 'Сотрудник' : `Создан ${formatDate(request.created_at)}`}
                    </span>
                    {workspace.view === 'inbox' && <span>{formatDate(request.created_at)}</span>}
                    {request.assignee?.full_name && (
                      <span className="inline-flex items-center gap-1.5 text-violet-700">
                        <CircleDot className="h-3.5 w-3.5" />
                        Исполнитель: {request.assignee.full_name}
                      </span>
                    )}
                  </div>

                  {request.response && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ответ отдела</div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.response}</p>
                    </div>
                  )}

                  {workspace.view === 'inbox' && ['new', 'in_progress'].includes(request.status) && (
                    <form action={updateDepartmentRequest} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <input type="hidden" name="requestId" value={request.id} />
                      <label htmlFor={`response-${request.id}`} className="text-xs font-semibold text-slate-700">
                        Комментарий автору
                      </label>
                      <textarea
                        id={`response-${request.id}`}
                        name="response"
                        maxLength={2000}
                        rows={2}
                        placeholder="Необязательно"
                        className="mt-2 min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {request.status === 'new' && (
                          <RequestActionSubmit value="in_progress">Взять в работу</RequestActionSubmit>
                        )}
                        <RequestActionSubmit value="done" variant="default">Выполнено</RequestActionSubmit>
                        <RequestActionSubmit value="rejected" variant="destructive">Отклонить</RequestActionSubmit>
                      </div>
                    </form>
                  )}

                  {workspace.view === 'mine' && ['new', 'in_progress'].includes(request.status) && (
                    <form action={updateDepartmentRequest}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <RequestActionSubmit value="cancelled" variant="outline">Отменить запрос</RequestActionSubmit>
                    </form>
                  )}
                </div>
              </article>
            ))}
          </div>

          {workspace.total > workspace.pageSize && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-4 sm:px-6">
              {workspace.page === 0 ? (
                <span className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 pointer-events-none opacity-50')}>Назад</span>
              ) : (
                <Link
                  className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}
                  href={queryHref(config.route, {
                    view: workspace.view,
                    q: search,
                    page: Math.max(0, workspace.page - 1),
                    factory: factoryId,
                  })}
                >
                  Назад
                </Link>
              )}
              <span className="text-sm text-slate-500">Страница {workspace.page + 1}</span>
              {(workspace.page + 1) * workspace.pageSize >= workspace.total ? (
                <span className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 pointer-events-none opacity-50')}>
                  Далее
                  <ArrowRight className="h-4 w-4" />
                </span>
              ) : (
                <Link href={queryHref(config.route, {
                  view: workspace.view,
                  q: search,
                  page: workspace.page + 1,
                  factory: factoryId,
                })} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>
                  Далее
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </section>

        <aside id="new-request" className="scroll-mt-5 rounded-[24px] border border-[#CBD7E8] bg-[#EEF4FB] p-5 xl:sticky xl:top-5">
          <div className="mb-5">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B3A6B] text-white">
              <Send className="h-4 w-4" />
            </span>
            <h2 className="mt-4 text-xl font-bold text-slate-950">Новый запрос</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">
              Запрос сразу появится у сотрудников отдела «{config.label}».
            </p>
          </div>
          <CreateDepartmentRequestForm target={workspace.target} />
        </aside>
      </div>
    </div>
  )
}
