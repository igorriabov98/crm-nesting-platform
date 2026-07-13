'use client'

// Хук для проверки прав доступа текущего пользователя
// Основан на роли из useUser, предоставляет удобные boolean-геттеры
import { useUser } from './useUser'
import { usePermissions } from '@/components/providers/PermissionProvider'
import {
  canEditField as checkCanEditField,
  isDirector,
} from '@/lib/utils/permissions'
import type { UserRole } from '@/lib/types'

/**
 * Хук для проверки прав и роли текущего пользователя.
 * Все значения мемоизированы от роли — пересчёт только при смене пользователя.
 */
export function useRole() {
  const { user, loading } = useUser()
  const { can } = usePermissions()

  const role = user?.role as UserRole | undefined

  return {
    role,
    loading,

    // Является ли пользователь директором (любым из трёх)
    isDirector: role ? isDirector(role) : false,

    // Может ли управлять пользователями системы (только planning_director)
    canManageUsers: can('admin_users', 'manage'),

    // Может ли видеть раздел инвойсов
    canViewInvoices: can('invoices', 'view'),

    // Может ли создавать новые машины (контракты)
    canCreateMachines: can('sales_plan', 'manage'),

    can,
    canManageSalesPlan: can('sales_plan', 'manage'),
    canManageProduction: can('production', 'manage'),
    canManageSupply: can('supply', 'manage'),
    canManageNesting: can('nesting', 'manage'),

    // Может ли редактировать конкретное поле конкретной таблицы
    canEditField: (table: string, field: string): boolean => {
      if (!role) return false
      return checkCanEditField(role, table, field)
    },

    // Специфичные проверки для снабжения
    isEngineer: role === 'engineer',
    isTechnologist: role === 'technologist',
    isSupplyManager: role === 'supply_manager',
    isProductionManager: role === 'production_manager',
    isSalesManager: role === 'sales_manager',
  }
}
