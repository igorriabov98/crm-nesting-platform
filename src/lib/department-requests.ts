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
export type DepartmentRequestPriority = 'low' | 'normal' | 'high' | 'urgent'
export type DepartmentRequestStatus = 'new' | 'in_progress' | 'done' | 'rejected' | 'cancelled'
export type DepartmentRequestView = 'mine' | 'inbox'

const DIRECTOR_ROLES: UserRole[] = [
  'financial_director',
  'commercial_director',
  'planning_director',
]

export function isDepartmentRequestTarget(value: string): value is DepartmentRequestTarget {
  return value in DEPARTMENT_REQUEST_TARGETS
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

export const DEPARTMENT_REQUEST_PRIORITY_LABELS: Record<DepartmentRequestPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
}

export const DEPARTMENT_REQUEST_STATUS_LABELS: Record<DepartmentRequestStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  done: 'Выполнен',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
}
