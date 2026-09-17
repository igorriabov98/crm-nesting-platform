import { ROUTES } from '@/lib/constants/routes'

export const DEPARTMENT_REQUEST_TARGETS = {
  technologist: {
    label: 'Технолог',
    recipientLabel: 'технологу',
    description: 'Нестандартные расчёты, документация и технические решения',
    route: ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS,
  },
  supply: {
    label: 'Снабжение',
    recipientLabel: 'снабжению',
    description: 'Закупки, поиск позиций, поставщики и организационные вопросы',
    route: ROUTES.SUPPLY_DEPARTMENT_REQUESTS,
  },
  production: {
    label: 'Производство',
    recipientLabel: 'производству',
    description: 'Нестандартные работы, проверки и действия на производстве',
    route: ROUTES.PRODUCTION_DEPARTMENT_REQUESTS,
  },
  planning: {
    label: 'Отдел планирования',
    recipientLabel: 'начальнику отдела планирования',
    description: 'Системные согласования плановых дат и маршрутов',
    route: ROUTES.REQUESTS,
  },
  finance: {
    label: 'Финансовый отдел',
    recipientLabel: 'начальнику Финансового отдела',
    description: 'Личное согласование заявки технолога',
    route: ROUTES.REQUESTS,
  },
} as const

export type DepartmentRequestTarget = keyof typeof DEPARTMENT_REQUEST_TARGETS
export type DepartmentRequestStatus = 'new' | 'in_progress' | 'done' | 'rejected' | 'cancelled'
export type DepartmentRequestAttachmentPhase = 'source' | 'resolution'
export type DepartmentRequestDeadlineFilter = 'all' | 'overdue' | 'with_date' | 'without_date'
export type DepartmentRequestOrderFilter = 'all' | 'with_order' | 'without_order' | string
export type DepartmentRequestAssigneeFilter = 'all' | 'unassigned' | 'mine' | string
export type DepartmentRequestTab = 'active' | 'completed' | 'rejected'
export type DepartmentRequestFilters = {
  query: string
  status: DepartmentRequestStatus | 'all'
  target: DepartmentRequestTarget | 'all'
  deadline: DepartmentRequestDeadlineFilter
  order: string
  assignee: string
  tab: DepartmentRequestTab
  page: number
}

export function isDepartmentRequestTarget(value: string): value is DepartmentRequestTarget {
  return value in DEPARTMENT_REQUEST_TARGETS
}

function normalizeFilterSearch(value: string) {
  return value.trim().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').slice(0, 120)
}

export function normalizeDepartmentRequestFilters(input: {
  q?: string
  status?: string
  target?: string
  deadline?: string
  order?: string
  assignee?: string
  tab?: string
  page?: string | number
}): DepartmentRequestFilters {
  const parsedPage = Number(input.page)
  const status = ['new', 'in_progress', 'done', 'rejected', 'cancelled'].includes(input.status || '')
    ? input.status as DepartmentRequestStatus
    : 'all'
  const target = isDepartmentRequestTarget(input.target || '')
    ? input.target as DepartmentRequestTarget
    : 'all'
  const deadline = ['overdue', 'with_date', 'without_date'].includes(input.deadline || '')
    ? input.deadline as DepartmentRequestDeadlineFilter
    : 'all'

  return {
    query: normalizeFilterSearch(input.q || ''),
    status,
    target,
    deadline,
    order: (input.order || 'all').slice(0, 80),
    assignee: (input.assignee || 'all').slice(0, 80),
    tab: input.tab === 'completed' || input.tab === 'rejected' ? input.tab : 'active',
    page: Number.isFinite(parsedPage) ? Math.max(0, Math.floor(parsedPage)) : 0,
  }
}

export const DEPARTMENT_REQUEST_STATUS_LABELS: Record<DepartmentRequestStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Решён',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
}

export function getDepartmentRequestTabStatuses(tab: DepartmentRequestTab): DepartmentRequestStatus[] {
  if (tab === 'completed') return ['done', 'cancelled']
  if (tab === 'rejected') return ['rejected']
  return ['new', 'in_progress']
}
