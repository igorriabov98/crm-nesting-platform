import type { Metadata } from 'next'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { DepartmentsPage } from '@/components/features/departments/DepartmentsPage'
import { getActiveUsers, getDepartments, getPositions } from './actions'
import { getRolePermissionMap, requirePermission } from '@/lib/permissions/server'

export const metadata: Metadata = {
  title: 'Отделы и структура — CRM Завода',
}

export default async function DepartmentsRoute() {
  let context: Awaited<ReturnType<typeof requirePermission>>

  try {
    context = await requirePermission('departments', 'view')
  } catch {
    return <AccessDenied />
  }

  const [permissions, departmentsResult, positionsResult, usersResult, factoriesResult] = await Promise.all([
    getRolePermissionMap(context.role),
    getDepartments(),
    getPositions(),
    getActiveUsers(),
    context.supabase.from('factories').select('id, name').order('name', { ascending: true }),
  ])

  const errors = [
    departmentsResult.error,
    positionsResult.error,
    usersResult.error,
    factoriesResult.error?.message,
  ].filter(
    (error): error is string => Boolean(error)
  )

  if (
    errors.length > 0
    || !departmentsResult.data
    || !positionsResult.data
    || !usersResult.data
    || !factoriesResult.data
  ) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">
          Ошибка загрузки организационной структуры: {errors.join('; ') || 'данные недоступны'}
        </div>
      </div>
    )
  }

  return (
    <DepartmentsPage
      departments={departmentsResult.data}
      positions={positionsResult.data}
      users={usersResult.data}
      factories={factoriesResult.data as { id: string; name: string }[]}
      currentUser={{ id: context.user.id, role: context.role }}
      canManage={permissions.departments?.canManage === true}
    />
  )
}
