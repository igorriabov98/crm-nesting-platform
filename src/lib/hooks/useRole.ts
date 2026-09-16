'use client'

// Compatibility hook backed exclusively by the department access matrix.
import { usePermissions } from '@/components/providers/PermissionProvider'

export function useRole() {
  const { can, isAdminPosition } = usePermissions()

  return {
    isAdminPosition,
    canManageUsers: can('admin_users', 'manage'),
    canViewInvoices: can('invoices', 'view'),
    canCreateMachines: can('sales_plan', 'manage'),
    can,
    canManageSalesPlan: can('sales_plan', 'manage'),
    canManageProduction: can('production', 'manage'),
    canManageSupply: can('supply', 'manage'),
    canManageNesting: can('nesting', 'manage'),
  }
}
