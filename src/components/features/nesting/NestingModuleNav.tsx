'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants/routes'
import {
  hasPermission,
  type PermissionMap,
  type ResourceKey,
} from '@/lib/permissions/resources'
import { cn } from '@/lib/utils'

const items = [
  { href: ROUTES.NESTING, label: 'Проекты', resourceKey: 'nesting' },
  { href: ROUTES.NESTING_CATALOG, label: 'Справочники', resourceKey: 'nesting_catalog' },
  { href: ROUTES.NESTING_SETTINGS, label: 'Настройки AI', resourceKey: 'nesting_settings' },
] satisfies Array<{
  href: string
  label: string
  resourceKey: ResourceKey
}>

export function NestingModuleNav({
  permissions,
}: {
  permissions: PermissionMap
}) {
  const pathname = usePathname()
  const visibleItems = items.filter((item) =>
    hasPermission(permissions, item.resourceKey, 'view')
  )

  return (
    <nav className="flex gap-2" aria-label="Навигация модуля раскладки">
      {visibleItems.map((item) => {
        const active = item.href === ROUTES.NESTING
          ? pathname === item.href
          : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              buttonVariants({ variant: active ? 'default' : 'outline', size: 'sm' }),
              'min-w-24'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
