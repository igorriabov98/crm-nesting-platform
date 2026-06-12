'use client'

// Хук для проверки прав доступа текущего пользователя
// Основан на роли из useUser, предоставляет удобные boolean-геттеры
import { useUser } from './useUser'
import {
  canEditField as checkCanEditField,
  isDirector,
  canViewInvoices,
  canManageUsers,
  canCreateMachines,
} from '@/lib/utils/permissions'
import type { UserRole } from '@/lib/types'

/**
 * Хук для проверки прав и роли текущего пользователя.
 * Все значения мемоизированы от роли — пересчёт только при смене пользователя.
 */
export function useRole() {
  const { user, loading } = useUser()

  const role = user?.role as UserRole | undefined

  return {
    role,
    loading,

    // Является ли пользователь директором (любым из трёх)
    isDirector: role ? isDirector(role) : false,

    // Может ли управлять пользователями системы (только planning_director)
    canManageUsers: role ? canManageUsers(role) : false,

    // Может ли видеть раздел инвойсов
    canViewInvoices: role ? canViewInvoices(role) : false,

    // Может ли создавать новые машины (контракты)
    canCreateMachines: role ? canCreateMachines(role) : false,

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
