import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Download,
  FileText,
  History,
  Mail,
  Package,
  Paperclip,
  Send,
  UserRound,
} from 'lucide-react'
import { getDepartmentRequestDetail } from '@/lib/actions/department-requests'
import {
  DEPARTMENT_REQUEST_STATUS_LABELS,
  DEPARTMENT_REQUEST_TARGETS,
  type DepartmentRequestStatus,
} from '@/lib/department-requests'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { RequestActions } from '@/components/features/department-requests/RequestActions'
import { getDepartmentRequestMailLinks } from '@/lib/actions/mail'
import { LinkedMailSection } from '@/components/features/mail/LinkedMailSection'

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
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export const metadata = {
  title: 'Рабочий запрос | CRM Завода',
}

export default async function DepartmentRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ factory?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const detail = await getDepartmentRequestDetail(id)
  if (!detail) notFound()
  const mailLinks = await getDepartmentRequestMailLinks(id)

  const { request, userId, canManage } = detail
  const target = DEPARTMENT_REQUEST_TARGETS[request.target_department]
  const mode = request.created_by === userId ? 'mine' : 'inbox'
  const backRoute = mode === 'mine' ? ROUTES.REQUESTS : target.route
  const backHref = query.factory ? `${backRoute}?factory=${encodeURIComponent(query.factory)}` : backRoute
  const sourceFiles = (request.attachments || []).filter((attachment) => attachment.phase === 'source')
  const resolutionFiles = (request.attachments || []).filter((attachment) => attachment.phase === 'resolution')
  const events = [...(request.events || [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const eventLabels = {
    created: 'Запрос создан',
    claimed: 'Запрос взят в работу',
    completed: 'Запрос решён',
    rejected: 'Запрос отклонён',
    cancelled: 'Запрос отменён',
  } as const

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <Link href={backHref} className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11 w-fit gap-2 text-slate-700')}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Назад к запросам
      </Link>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
        <header className="border-b border-slate-200 bg-[#F7F9FC] px-5 py-6 sm:px-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusStyles[request.status])}>
                  {DEPARTMENT_REQUEST_STATUS_LABELS[request.status]}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {target.label}
                </span>
              </div>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{request.title}</h1>
              <p className="mt-2 text-sm text-slate-500">Создан {formatDate(request.created_at)}</p>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#1B3A6B] text-white">
              <Send className="size-5" aria-hidden="true" />
            </span>
          </div>
        </header>

        <div className="space-y-7 px-5 py-6 sm:px-7">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Описание задачи</h2>
            <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-slate-800">{request.description}</p>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <UserRound className="size-4" aria-hidden="true" />
                Автор
              </div>
              <p className="mt-2 font-semibold text-slate-900">{request.creator?.full_name || 'Сотрудник'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <CircleDot className="size-4" aria-hidden="true" />
                Взял в работу
              </div>
              <p className="mt-2 font-semibold text-slate-900">{request.assignee?.full_name || 'Пока не назначен'}</p>
            </div>
            {request.due_date && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <CalendarClock className="size-4" aria-hidden="true" />
                  Желаемый срок
                </div>
                <p className="mt-2 font-semibold text-slate-900">{formatDate(`${request.due_date}T00:00:00`)}</p>
              </div>
            )}
            {request.machine && (
              <Link href={`${ROUTES.SALES_PLAN}/${request.machine.id}`} className="rounded-2xl border border-blue-200 bg-blue-50 p-4 hover:bg-blue-100">
                <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                  <Package className="size-4" aria-hidden="true" />
                  Связанный заказ
                </div>
                <p className="mt-2 font-semibold text-blue-950">
                  {request.machine.name}
                  {request.machine.specification_number ? ` · ${request.machine.specification_number}` : ''}
                </p>
              </Link>
            )}
          </div>

          {mailLinks.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Mail className="size-4" aria-hidden="true" />
                Почтовая переписка
              </h2>
              <p className="mt-2 text-sm text-slate-500">Связанную почту видят все пользователи с доступом к запросу.</p>
              <div className="mt-3">
                <LinkedMailSection
                  target="department_request"
                  targetId={request.id}
                  links={mailLinks}
                  canUnlink={request.created_by === userId || canManage}
                />
              </div>
            </section>
          )}

          {sourceFiles.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Paperclip className="size-4" aria-hidden="true" />
                Файлы запроса
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {sourceFiles.map((file) => (
                  <a
                    key={file.id}
                    href={`/api/department-requests/files/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
                    <span className="text-xs text-slate-400">{formatFileSize(file.file_size)}</span>
                    <Download className="size-4 shrink-0" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {request.response && ['done', 'rejected'].includes(request.status) && (
            <section className={cn(
              'rounded-2xl border p-5',
              request.status === 'done' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50',
            )}>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
                {request.status === 'done'
                  ? <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
                  : <FileText className="size-4 text-red-700" aria-hidden="true" />}
                {request.status === 'done' ? 'Решение запроса' : 'Причина отклонения'}
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-base leading-7 text-slate-800">{request.response}</p>
              {request.completer?.full_name && (
                <p className="mt-4 text-sm text-slate-600">
                  Завершил: <span className="font-semibold">{request.completer.full_name}</span>
                  {request.completed_at ? ` · ${formatDate(request.completed_at)}` : ''}
                </p>
              )}
            </section>
          )}

          {resolutionFiles.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Paperclip className="size-4" aria-hidden="true" />
                Файлы решения
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {resolutionFiles.map((file) => (
                  <a
                    key={file.id}
                    href={`/api/department-requests/files/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
                    <span className="text-xs text-slate-400">{formatFileSize(file.file_size)}</span>
                    <Download className="size-4 shrink-0" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {events.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <History className="size-4" aria-hidden="true" />
                История запроса
              </h2>
              <ol className="mt-4 space-y-0">
                {events.map((event, index) => (
                  <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < events.length - 1 && (
                      <span className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-slate-200" aria-hidden="true" />
                    )}
                    <span className="relative mt-1.5 size-4 shrink-0 rounded-full border-4 border-white bg-[#1B3A6B] shadow-sm" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{eventLabels[event.event_type]}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {event.actor?.full_name || 'Система'} · {formatDate(event.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="border-t border-slate-200 pt-5">
            <RequestActions
              requestId={request.id}
              status={request.status}
              mode={mode === 'inbox' && canManage ? 'inbox' : 'mine'}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
