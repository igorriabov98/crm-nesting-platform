import { UserRole } from '@/lib/types'

export const ROLES: Record<UserRole, { label: string; color: string }> = {
  financial_director: { label: 'Финансовый директор', color: 'red' },
  commercial_director: { label: 'Коммерческий директор', color: 'red' },
  planning_director: { label: 'Директор планирования', color: 'red' },
  sales_manager: { label: 'Менеджер продаж', color: 'yellow' },
  engineer: { label: 'Инженер', color: 'blue' },
  technologist: { label: 'Технолог', color: 'blue' },
  supply_manager: { label: 'Менеджер снабжения', color: 'blue' },
  production_manager: { label: 'Начальник производства', color: 'blue' },
  procurement_head: { label: 'Начальник заготовки', color: 'blue' },
  painting_head: { label: 'Начальник малярки', color: 'blue' },
}

export const DIRECTOR_ROLES: UserRole[] = [
  'financial_director',
  'commercial_director',
  'planning_director',
]

export const INVOICE_VISIBLE_ROLES: UserRole[] = [
  ...DIRECTOR_ROLES,
  'sales_manager',
]

export const FINANCE_VISIBLE_ROLES: UserRole[] = [
  ...DIRECTOR_ROLES,
  'supply_manager',
]

export const INVOICE_EDIT_ROLES: UserRole[] = [
  'financial_director',
  'sales_manager',
  'planning_director',
]

export const USER_ADMIN_ROLE: UserRole = 'planning_director'
