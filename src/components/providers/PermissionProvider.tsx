'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  hasPermission,
  type PermissionMap,
  type PermissionOperation,
  type ResourceKey,
} from '@/lib/permissions/resources'

const PermissionContext = createContext<{ permissions: PermissionMap; isAdminPosition: boolean }>({ permissions: {}, isAdminPosition: false })

export function PermissionProvider({
  permissions,
  isAdminPosition = false,
  children,
}: {
  permissions: PermissionMap
  isAdminPosition?: boolean
  children: ReactNode
}) {
  return <PermissionContext.Provider value={{ permissions, isAdminPosition }}>{children}</PermissionContext.Provider>
}

export function usePermissions() {
  const { permissions, isAdminPosition } = useContext(PermissionContext)
  return {
    permissions,
    isAdminPosition,
    can: (resourceKey: ResourceKey, operation: PermissionOperation) =>
      hasPermission(permissions, resourceKey, operation),
  }
}
