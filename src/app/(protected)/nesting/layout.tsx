import { Shapes } from 'lucide-react'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { NestingModuleNav } from '@/components/features/nesting/NestingModuleNav'
import { requirePermission } from '@/lib/permissions/server'

export default async function NestingLayout({ children }: { children: React.ReactNode }) {
  const context = await requirePermission('nesting', 'view').catch(() => null)
  if (!context) {
    return <AccessDenied />
  }
  const permissions = context.permissions

  return (
    <div className="flex min-h-full flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1B3A6B] text-white">
            <Shapes className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#1B3A6B]">Раскладка металла</h1>
            <p className="text-xs text-[#6B7280]">Модуль оптимизации листовой резки</p>
          </div>
        </div>
        <NestingModuleNav permissions={permissions} />
      </div>
      <div className="flex-1">
        {children}
      </div>
    </div>
  )
}
