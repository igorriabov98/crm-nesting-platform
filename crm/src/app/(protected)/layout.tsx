import { headers } from 'next/headers'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { canSeeAllFactories } from '@/lib/utils/permissions'
import { canCurrentRoleAccessPath, getRolePermissionMap } from '@/lib/permissions/server'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await getCurrentUserContextOrRedirect()
  const headerList = await headers()
  const pathname = headerList.get('x-current-pathname') || ''

  const { supabase, user: currentUser } = context
  const permissions = await getRolePermissionMap(currentUser.role)
  const canAccessCurrentPath = await canCurrentRoleAccessPath(currentUser.role, permissions, pathname)
  const factories = canSeeAllFactories(currentUser.role)
    ? (await supabase.from('factories').select('id, name')).data || []
    : []

  return (
    <div className="flex h-screen overflow-hidden bg-[#F4F6F9]">
      <Sidebar user={currentUser} permissions={permissions} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header user={currentUser} factories={factories} permissions={permissions} />
        <main className="flex-1 overflow-y-auto p-6">
          {canAccessCurrentPath ? children : <AccessDenied />}
        </main>
      </div>
    </div>
  )
}
