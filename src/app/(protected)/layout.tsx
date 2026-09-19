import { unstable_rethrow } from 'next/navigation'
import { AccessUnavailable } from '@/components/ui/AccessUnavailable'
import { Suspense } from 'react'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner'
import { PermissionProvider, RouteAccessBoundary } from '@/components/providers/PermissionProvider'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { getImpersonationContext } from '@/lib/auth/impersonation'
import { FocusTargetScroller } from '@/components/ui/FocusTargetScroller'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let context, permissionDetails, impersonation
  try {
    context = await getCurrentUserContextOrRedirect()
    permissionDetails = await getCurrentUserPermissions(context.user.id)
    impersonation = await getImpersonationContext(context.user.id)
  } catch (error) {
    unstable_rethrow(error)
    return <AccessUnavailable />
  }
  const { user: currentUser } = context
  const permissions = permissionDetails.permissions

  return (
    <PermissionProvider permissions={permissions} isAdminPosition={permissionDetails.isAdminPosition} userId={currentUser.id} version={permissionDetails.version}>
      <Suspense fallback={null}><FocusTargetScroller /></Suspense>
      {/* Keep the fixed shell non-scrollable; the sidebar nav and main own their scrolling. */}
      <div className="fixed inset-0 flex flex-col overflow-clip bg-[#F4F6F9]">
        {impersonation && (
          <ImpersonationBanner
            auditId={impersonation.auditId}
            adminName={impersonation.adminName}
            targetName={impersonation.targetName}
          />
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar user={currentUser} permissions={permissions} />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Header user={currentUser} permissions={permissions} isImpersonating={Boolean(impersonation)} />
            <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
              <RouteAccessBoundary>{children}</RouteAccessBoundary>
            </main>
          </div>
        </div>
      </div>
    </PermissionProvider>
  )
}
