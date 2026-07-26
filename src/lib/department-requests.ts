import { ROUTES } from '@/lib/constants/routes'
import type { UserRole } from '@/lib/types'

export const DEPARTMENT_REQUEST_TARGETS = {
  technologist: {
    label: 'Технолог',
    recipientLabel: 'технологу',
    description: 'Нестандартные расчёты, документация и технические решения',
    route: ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS,
    departmentKeywords: ['техническ', 'технолог'],
    roles: ['engineer', 'technologist'] as UserRole[],
  },
  supply: {
    label: 'Снабжение',
    recipientLabel: 'снабжению',
    description: 'Закупки, поиск позиций, поставщики и организационные вопросы',
    route: ROUTES.SUPPLY_DEPARTMENT_REQUESTS,
    departmentKeywords: ['снабжен', 'закуп'],
    roles: ['supply_manager', 'procurement_head'] as UserRole[],
  },
  production: {
    label: 'Производство',
    recipientLabel: 'производству',
    description: 'Нестандартные работы, проверки и действия на производстве',
    route: ROUTES.PRODUCTION_DEPARTMENT_REQUESTS,
    departmentKeywords: ['производств', 'цех'],
    roles: ['production_manager', 'painting_head'] as UserRole[],
  },
} as const

export type DepartmentRequestTarget = keyof typeof DEPARTMENT_REQUEST_TARGETS
export type DepartmentRequestStatus = 'new' | 'in_progress' | 'done' | 'rejected' | 'cancelled'
export type DepartmentRequestAttachmentPhase = 'source' | 'resolution'
export type DepartmentRequestDeadlineFilter = 'all' | 'overdue' | 'with_date' | 'without_date'
export type DepartmentRequestOrderFilter = 'all' | 'with_order' | 'without_order' | string
export type DepartmentRequestAssigneeFilter = 'all' | 'unassigned' | 'mine' | string
export type DepartmentRequestFilters = {
  query: string
  status: DepartmentRequestStatus | 'all'
  target: DepartmentRequestTarget | 'all'
  deadline: DepartmentRequestDeadlineFilter
  order: string
  assignee: string
  page: number
}

const DIRECTOR_ROLES: UserRole[] = [
  'financial_director',
  'commercial_director',
  'planning_director',
]

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
    page: Number.isFinite(parsedPage) ? Math.max(0, Math.floor(parsedPage)) : 0,
  }
}

export function canManageDepartmentRequestTarget(input: {
  target: DepartmentRequestTarget
  role: UserRole
  memberships: Array<{ departmentName: string | null }>
}) {
  if (DIRECTOR_ROLES.includes(input.role)) return true
  const config = DEPARTMENT_REQUEST_TARGETS[input.target]
  if ((config.roles as readonly UserRole[]).includes(input.role)) return true

  return input.memberships.some(({ departmentName }) => {
    const normalized = departmentName?.trim().toLocaleLowerCase('ru') || ''
    return config.departmentKeywords.some((keyword) => normalized.includes(keyword))
  })
}

export const DEPARTMENT_REQUEST_STATUS_LABELS: Record<DepartmentRequestStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Решён',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
}
