import { headers } from 'next/headers'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { PermissionProvider } from '@/components/providers/PermissionProvider'
import { canCurrentUserAccessPath, getCurrentUserPermissions } from '@/lib/permissions/server'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await getCurrentUserContextOrRedirect()
  const headerList = await headers()
  const pathname = headerList.get('x-current-pathname') || ''

  const { user: currentUser } = context
  const permissionDetails = await getCurrentUserPermissions(currentUser.id)
  const permissions = permissionDetails.permissions
  const canAccessCurrentPath = await canCurrentUserAccessPath(permissions, pathname)

  return (
    <PermissionProvider permissions={permissions}>
      <div className="fixed inset-0 flex overflow-hidden bg-[#F4F6F9]">
        <Sidebar user={currentUser} permissions={permissions} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header user={currentUser} permissions={permissions} />
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
            {canAccessCurrentPath ? children : <AccessDenied />}
          </main>
        </div>
      </div>
    </PermissionProvider>
  )
}
