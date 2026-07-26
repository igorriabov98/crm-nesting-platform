import Form from 'next/form'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CircleDot,
  Filter,
  Inbox,
  Package,
  Paperclip,
  Search,
  Send,
  UserRound,
} from 'lucide-react'
import {
  type DepartmentRequestRow,
  type DepartmentRequestWorkspace,
} from '@/lib/actions/department-requests'
import {
  DEPARTMENT_REQUEST_STATUS_LABELS,
  DEPARTMENT_REQUEST_TARGETS,
  type DepartmentRequestStatus,
} from '@/lib/department-requests'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CreateDepartmentRequestForm } from '@/components/features/department-requests/CreateDepartmentRequestForm'
import { RequestActions } from '@/components/features/department-requests/RequestActions'

const statusStyles: Record<DepartmentRequestStatus, string> = {
  new: 'border-blue-200 bg-blue-50 text-blue-800',
  in_progress: 'border-violet-200 bg-violet-50 text-violet-800',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-800',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-700',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function queryHref(route: string, workspace: DepartmentRequestWorkspace, page: number, factoryId?: string) {
  const params = new URLSearchParams()
  const { filters } = workspace
  if (filters.query) params.set('q', filters.query)
  if (filters.status !== 'all') params.set('status', filters.status)
  if (workspace.mode === 'mine' && filters.target !== 'all') params.set('target', filters.target)
  if (filters.deadline !== 'all') params.set('deadline', filters.deadline)
  if (filters.order !== 'all') params.set('order', filters.order)
  if (workspace.mode === 'inbox' && filters.assignee !== 'all') params.set('assignee', filters.assignee)
  if (filters.tab === 'completed') params.set('tab', 'completed')
  if (page > 0) params.set('page', String(page))
  if (factoryId) params.set('factory', factoryId)
  const suffix = params.toString()
  return suffix ? `${route}?${suffix}` : route
}

function requestDetailHref(requestId: string, factoryId?: string) {
  const route = `/requests/detail/${requestId}`
  return factoryId ? `${route}?factory=${encodeURIComponent(factoryId)}` : route
}

function tabHref(
  route: string,
  workspace: DepartmentRequestWorkspace,
  tab: 'active' | 'completed',
  factoryId?: string,
) {
  const params = new URLSearchParams()
  const { filters } = workspace
  if (filters.query) params.set('q', filters.query)
  if (workspace.mode === 'mine' && filters.target !== 'all') params.set('target', filters.target)
  if (filters.deadline !== 'all') params.set('deadline', filters.deadline)
  if (filters.order !== 'all') params.set('order', filters.order)
  if (workspace.mode === 'inbox' && filters.assignee !== 'all') params.set('assignee', filters.assignee)
  if (tab === 'completed') params.set('tab', 'completed')
  if (factoryId) params.set('factory', factoryId)
  const suffix = params.toString()
  return suffix ? `${route}?${suffix}` : route
}

function RequestListItem({
  request,
  mode,
  factoryId,
}: {
  request: DepartmentRequestRow
  mode: 'mine' | 'inbox'
  factoryId?: string
}) {
  const target = DEPARTMENT_REQUEST_TARGETS[request.target_department]
  const sourceFiles = (request.attachments || []).filter((attachment) => attachment.phase === 'source').length
  const resolutionFiles = (request.attachments || []).filter((attachment) => attachment.phase === 'resolution').length
  const overdue = Boolean(
    request.due_date
      && !['done', 'rejected', 'cancelled'].includes(request.status)
      && request.due_date < new Date().toISOString().slice(0, 10),
  )
  const detailHref = requestDetailHref(request.id, factoryId)

  return (
    <article className="bg-white px-4 py-4 transition-colors hover:bg-slate-50/70 sm:px-5">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(260px,2fr)_minmax(150px,1fr)_minmax(180px,1fr)_minmax(150px,0.8fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusStyles[request.status])}>
              {DEPARTMENT_REQUEST_STATUS_LABELS[request.status]}
            </span>
            {mode === 'mine' && (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                {target.label}
              </span>
            )}
          </div>
          <Link
            href={detailHref}
            className="group mt-2 inline-flex max-w-full items-start gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <h2 className="truncate text-base font-semibold leading-6 text-slate-950 group-hover:text-[#1B3A6B]">
              {request.title}
            </h2>
            <ArrowUpRight className="mt-1 size-4 shrink-0 text-slate-400 group-hover:text-[#1B3A6B]" aria-hidden="true" />
          </Link>
          <p className="mt-1 line-clamp-1 whitespace-pre-wrap text-sm text-slate-600">{request.description}</p>
        </div>

        <div className="min-w-0 text-sm text-slate-600">
          {request.machine ? (
            <Link
              href={`${ROUTES.SALES_PLAN}/${request.machine.id}`}
              className="inline-flex min-h-10 max-w-full items-center gap-2 font-medium text-blue-900 hover:text-blue-700"
            >
              <Package className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {request.machine.name}
                {request.machine.specification_number ? ` · ${request.machine.specification_number}` : ''}
              </span>
            </Link>
          ) : (
            <span className="text-slate-400">Без заказа</span>
          )}
        </div>

        <div className="min-w-0 space-y-1 text-xs text-slate-500">
          <span className="flex min-w-0 items-center gap-1.5">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {mode === 'inbox' ? request.creator?.full_name || 'Сотрудник' : `Создан ${formatDate(request.created_at)}`}
            </span>
          </span>
          {request.assignee?.full_name && (
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-violet-700">
              <CircleDot className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Взял: {request.assignee.full_name}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 xl:block xl:space-y-1">
          <span className="block text-slate-500">
            {mode === 'inbox' ? `Создан ${formatDate(request.created_at)}` : target.label}
          </span>
          {request.due_date && (
            <span className={cn(
              'inline-flex items-center gap-1.5 font-medium xl:flex',
              overdue ? 'text-red-700' : 'text-slate-500',
            )}>
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {overdue ? 'Просрочен · ' : 'до '}{formatDate(request.due_date)}
            </span>
          )}
          {(sourceFiles > 0 || resolutionFiles > 0) && (
            <span className="inline-flex items-center gap-1.5 xl:flex">
              <Paperclip className="size-3.5" aria-hidden="true" />
              Файлов: {sourceFiles + resolutionFiles}
            </span>
          )}
        </div>

        <div className="flex min-w-max flex-wrap items-center gap-1 xl:justify-end">
          <RequestActions requestId={request.id} status={request.status} mode={mode} />
          <Link
            href={detailHref}
            aria-label={['done', 'rejected'].includes(request.status) ? 'Открыть результат' : 'Открыть запрос'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'min-h-11 min-w-11 text-[#1B3A6B]')}
          >
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}

export function DepartmentRequestsPage({
  workspace,
  factoryId,
}: {
  workspace: DepartmentRequestWorkspace
  factoryId?: string
}) {
  const config = workspace.target ? DEPARTMENT_REQUEST_TARGETS[workspace.target] : null
  const route = workspace.mode === 'mine' ? ROUTES.REQUESTS : config!.route
  const resetParams = new URLSearchParams()
  if (workspace.filters.tab === 'completed') resetParams.set('tab', 'completed')
  if (factoryId) resetParams.set('factory', factoryId)
  const resetHref = resetParams.size > 0 ? `${route}?${resetParams.toString()}` : route
  const visibleStatuses: DepartmentRequestStatus[] = workspace.filters.tab === 'completed'
    ? ['done', 'rejected', 'cancelled']
    : ['new', 'in_progress']
  const hasFilters = Boolean(
    workspace.filters.query
    || workspace.filters.status !== 'all'
    || workspace.filters.target !== 'all'
    || workspace.filters.deadline !== 'all'
    || workspace.filters.order !== 'all'
    || workspace.filters.assignee !== 'all',
  )

  return (
    <div className="mx-auto w-full max-w-[1380px] space-y-5 pb-10">
      <section className="rounded-[24px] border border-slate-200 bg-[#F7F9FC] px-5 py-6 sm:px-7 lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1B3A6B]">
              <span className="flex size-8 items-center justify-center rounded-xl bg-[#1B3A6B] text-white">
                {workspace.mode === 'mine'
                  ? <Send className="size-4" aria-hidden="true" />
                  : <Inbox className="size-4" aria-hidden="true" />}
              </span>
              {workspace.mode === 'mine' ? 'Мои рабочие запросы' : 'Входящие отдела'}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              {workspace.mode === 'mine' ? 'Запросы' : `Запросы · ${config!.label}`}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              {workspace.mode === 'mine'
                ? 'Создавайте нестандартные задачи для технологов, снабжения и производства и следите за результатом.'
                : `Здесь собраны только запросы, адресованные отделу «${config!.label}».`}
            </p>
          </div>
          {workspace.mode === 'mine' && <CreateDepartmentRequestForm />}
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
        <nav className="flex border-b border-slate-200 px-4 pt-3 sm:px-5" aria-label="Состояние запросов">
          <Link
            href={tabHref(route, workspace, 'active', factoryId)}
            className={cn(
              'flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold',
              workspace.filters.tab === 'active'
                ? 'border-[#1B3A6B] text-[#1B3A6B]'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            Активные
          </Link>
          <Link
            href={tabHref(route, workspace, 'completed', factoryId)}
            className={cn(
              'flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold',
              workspace.filters.tab === 'completed'
                ? 'border-[#1B3A6B] text-[#1B3A6B]'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            Выполненные
          </Link>
        </nav>
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <Form action={route} className="space-y-3">
            {factoryId && <input type="hidden" name="factory" value={factoryId} />}
            {workspace.filters.tab === 'completed' && <input type="hidden" name="tab" value="completed" />}
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" />
                <Input
                  name="q"
                  defaultValue={workspace.filters.query}
                  placeholder="Поиск по названию, описанию или решению"
                  aria-label="Поиск запросов"
                  className="h-11 pl-9"
                />
              </div>
              <Button type="submit" className="min-h-11 gap-2 bg-[#1B3A6B] text-white hover:bg-[#152f59]">
                <Search className="size-4" aria-hidden="true" />
                Найти
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {workspace.mode === 'mine' && (
                <label className="space-y-1 text-xs font-medium text-slate-600">
                  <span>Отдел</span>
                  <select name="target" defaultValue={workspace.filters.target} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800">
                    <option value="all">Все отделы</option>
                    {(Object.entries(DEPARTMENT_REQUEST_TARGETS)).map(([value, target]) => (
                      <option key={value} value={value}>{target.label}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="space-y-1 text-xs font-medium text-slate-600">
                <span>Статус</span>
                <select name="status" defaultValue={workspace.filters.status} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800">
                  <option value="all">Все статусы</option>
                  {visibleStatuses.map((value) => (
                    <option key={value} value={value}>{DEPARTMENT_REQUEST_STATUS_LABELS[value]}</option>
                  ))}
                </select>
              </label>

              {workspace.mode === 'inbox' && (
                <label className="space-y-1 text-xs font-medium text-slate-600">
                  <span>Исполнитель</span>
                  <select name="assignee" defaultValue={workspace.filters.assignee} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800">
                    <option value="all">Все исполнители</option>
                    <option value="unassigned">Не назначен</option>
                    <option value="mine">Взятые мной</option>
                    {workspace.assigneeOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="space-y-1 text-xs font-medium text-slate-600">
                <span>Срок</span>
                <select name="deadline" defaultValue={workspace.filters.deadline} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800">
                  <option value="all">Любой срок</option>
                  <option value="overdue">Просроченные</option>
                  <option value="with_date">С указанным сроком</option>
                  <option value="without_date">Без срока</option>
                </select>
              </label>

              <label className="space-y-1 text-xs font-medium text-slate-600">
                <span>Заказ</span>
                <select name="order" defaultValue={workspace.filters.order} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800">
                  <option value="all">Все запросы</option>
                  <option value="with_order">С заказом</option>
                  <option value="without_order">Без заказа</option>
                  {workspace.orderOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>

              <div className="flex items-end gap-2">
                <Button type="submit" variant="outline" className="min-h-11 flex-1 gap-2">
                  <Filter className="size-4" aria-hidden="true" />
                  Применить
                </Button>
                {hasFilters && (
                  <Link href={resetHref} className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}>
                    Сбросить
                  </Link>
                )}
              </div>
            </div>
          </Form>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm text-slate-500 sm:px-5">
          <span>{workspace.mode === 'mine' ? 'Отправленные вами' : 'Адресованные вашему отделу'}</span>
          <span className="tabular-nums">Найдено: {workspace.total}</span>
        </div>

        <div className="divide-y divide-slate-200">
          {workspace.requests.length === 0 ? (
            <div className="flex min-h-80 flex-col items-center justify-center bg-white px-6 py-16 text-center">
              <span className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                {hasFilters ? <Search className="size-7" aria-hidden="true" /> : <Inbox className="size-7" aria-hidden="true" />}
              </span>
              <h2 className="text-lg font-semibold text-slate-900">
                {hasFilters ? 'Подходящих запросов нет' : 'Запросов пока нет'}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                {hasFilters
                  ? 'Измените ключевые слова или сбросьте часть фильтров.'
                  : workspace.mode === 'mine'
                    ? 'Создайте первый запрос — его сразу увидит выбранный отдел.'
                    : 'Новые запросы вашему отделу появятся здесь автоматически.'}
              </p>
            </div>
          ) : workspace.requests.map((request) => (
            <RequestListItem key={request.id} request={request} mode={workspace.mode} factoryId={factoryId} />
          ))}
        </div>

        {workspace.total > workspace.pageSize && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-4 sm:px-5">
            {workspace.page === 0 ? (
              <span className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 pointer-events-none opacity-50')}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Назад
              </span>
            ) : (
              <Link className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')} href={queryHref(route, workspace, workspace.page - 1, factoryId)}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Назад
              </Link>
            )}
            <span className="text-sm text-slate-500">Страница {workspace.page + 1}</span>
            {(workspace.page + 1) * workspace.pageSize >= workspace.total ? (
              <span className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 pointer-events-none opacity-50')}>
                Далее
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            ) : (
              <Link className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')} href={queryHref(route, workspace, workspace.page + 1, factoryId)}>
                Далее
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
