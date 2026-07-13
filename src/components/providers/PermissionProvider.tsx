'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  hasPermission,
  type PermissionMap,
  type PermissionOperation,
  type ResourceKey,
} from '@/lib/permissions/resources'

const PermissionContext = createContext<PermissionMap>({})

export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: PermissionMap
  children: ReactNode
}) {
  return <PermissionContext.Provider value={permissions}>{children}</PermissionContext.Provider>
}

export function usePermissions() {
  const permissions = useContext(PermissionContext)
  return {
    permissions,
    can: (resourceKey: ResourceKey, operation: PermissionOperation) =>
      hasPermission(permissions, resourceKey, operation),
  }
}
