// Утилиты проверки прав доступа на клиенте
// Основаны на матрице доступа из docs/ROLES.md
import { UserRole } from '@/lib/types'
import {
  DIRECTOR_ROLES,
  FINANCE_VISIBLE_ROLES,
  INVOICE_EDIT_ROLES,
  INVOICE_VISIBLE_ROLES,
  USER_ADMIN_ROLE,
} from '@/lib/constants/roles'

/**
 * Проверяет, может ли пользователь с данной ролью
 * редактировать конкретное поле конкретной таблицы.
 * Логика: директора могут всё. Остальные — только своё.
 */
export function canEditField(
  role: UserRole,
  table: string,
  field: string
): boolean {
  // Директора имеют полный доступ к редактированию всего
  if (DIRECTOR_ROLES.includes(role)) return true

  switch (table) {
    case 'machines':
      // Создатель контракта (sales_manager) редактирует машины
      return role === 'sales_manager'

    case 'supply_items':
      switch (role) {
        case 'engineer':
          // Инженер — только подтверждение чертежа
          return field === 'engineer_confirmation'
        case 'technologist':
          // Технолог — номенклатура, единица измерения, количество
          return ['nomenclature', 'unit', 'quantity'].includes(field)
        case 'supply_manager':
          // Снабжение — поставщик, цена, статус, комментарий, дата
          return [
            'supplier',
            'price_per_unit',
            'status',
            'comment',
            'planned_delivery_date',
          ].includes(field)
        default:
          return false
      }

    case 'production_stages':
      // Начальник производства управляет всеми полями этапов
      return role === 'production_manager'

    case 'invoices':
      // Статус инвойса редактируют только выбранные роли
      if (field === 'status') return INVOICE_EDIT_ROLES.includes(role)
      return false

    default:
      return false
  }
}

/** Проверка: является ли роль директорской */
export function isDirector(role: UserRole): boolean {
  return DIRECTOR_ROLES.includes(role)
}

/** Проверка: может ли роль видеть инвойсы */
export function canViewInvoices(role: UserRole): boolean {
  return INVOICE_VISIBLE_ROLES.includes(role)
}

export function canViewFinanceCalendar(role: UserRole): boolean {
  return FINANCE_VISIBLE_ROLES.includes(role)
}

export function canViewNesting(role: UserRole): boolean {
  return role === 'technologist' || DIRECTOR_ROLES.includes(role)
}

export function canManageProducts(role: UserRole): boolean {
  return role === 'sales_manager' || role === 'engineer' || DIRECTOR_ROLES.includes(role)
}

export function canViewProducts(role: UserRole): boolean {
  return canManageProducts(role)
}

/** Проверка: может ли роль управлять пользователями */
export function canManageUsers(role: UserRole): boolean {
  return role === USER_ADMIN_ROLE
}

/** Проверка: может ли роль создавать машины */
export function canCreateMachines(role: UserRole): boolean {
  return role === 'sales_manager' || DIRECTOR_ROLES.includes(role)
}

/** Проверка: может ли роль просматривать план продаж */
export function canViewSalesPlan(role: UserRole): boolean {
  return true // Все роли имеют доступ к просмотру главного плана продаж
}

/** Проверка: видит ли пользователь все заводы (если нет, то только свой) */
export function canSeeAllFactories(role: UserRole): boolean {
  return role !== 'production_manager'
}

/** Проверка: может ли пользователь назначать машины на заводы */
export function canAssignFactory(role: UserRole): boolean {
  return DIRECTOR_ROLES.includes(role)
}

/** Проверка: может ли пользователь управлять (создавать) собрания */
export function canManageMeetings(role: UserRole): boolean {
  return DIRECTOR_ROLES.includes(role)
}
