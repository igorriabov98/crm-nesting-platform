'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { LogOut, User2, Menu } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/constants/routes'
import { ROLES } from '@/lib/constants/roles'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useUserStore } from '@/lib/hooks/useUser'
import { NotificationBell } from './NotificationBell'
import { Sidebar } from './Sidebar'
import { Breadcrumbs } from '@/components/features/layout/Breadcrumbs'
import { FactoryFilter } from '@/components/features/layout/FactoryFilter'
import { useNavigationProgress } from '@/lib/hooks/useNavigationProgress'
import type { PermissionMap } from '@/lib/permissions/resources'
import type { CurrentUser } from '@/lib/types'

const PAGE_TITLES: Record<string, string> = {
  [ROUTES.DASHBOARD]: 'Дашборд',
  [ROUTES.SALES_PLAN]: 'План продаж',
  [ROUTES.SALES_PLAN + '/new']: 'Новая машина',
  [ROUTES.PRODUCTS]: 'База продукции',
  [ROUTES.PRODUCTS_NEW]: 'Новый продукт',
  [ROUTES.PRODUCT_PROJECTS]: 'Проекты изделий',
  [ROUTES.PRODUCT_PROJECTS_NEW]: 'Новый проект изделия',
  [ROUTES.PRODUCTION]: 'Производство',
  [ROUTES.GANTT]: 'Гант-график',
  [ROUTES.SUPPLY]: 'Снабжение',
  [ROUTES.INVOICES]: 'Инвойсы',
  [ROUTES.FINANCE_CALENDAR]: 'Финансовый план',
  [ROUTES.ADMIN_SETTINGS]: 'Настройки',
  [ROUTES.NESTING_SETTINGS]: 'Настройки AI',
  [ROUTES.ADMIN_USERS]: 'Управление пользователями',
  [ROUTES.ADMIN_USERS_NEW]: 'Новый пользователь',
  [ROUTES.NOTIFICATIONS]: 'Уведомления',
}

interface HeaderProps {
  user: CurrentUser
  factories: { id: string; name: string }[]
  permissions: PermissionMap
}

export function Header({ user, factories, permissions }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { reset } = useUserStore()
  const { start } = useNavigationProgress()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  async function handleLogout() {
    start()
    const supabase = createClient()
    await supabase.auth.signOut()
    reset()
    toast.success('Вы вышли из системы')
    router.push(ROUTES.LOGIN)
    router.refresh()
  }

  const initials = user.full_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? '?'

  const title = PAGE_TITLES[pathname] || 'CRM Завода'

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#E8ECF0] bg-white px-4 sm:px-6">
      <div className="flex items-center gap-4">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger
            className="lg:hidden flex items-center justify-center h-9 w-9 rounded-md text-[#6B7280] hover:text-[#1B3A6B] hover:bg-[#F4F6F9] transition-colors focus:outline-none"
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px] p-0 border-r border-[#E8ECF0] bg-white">
            {/* Для доступности добавляем невидимый Title, если его нет в дизайне */}
            <SheetTitle className="sr-only">Навигация</SheetTitle>
            <Sidebar user={user} permissions={permissions} isMobile={true} onNavigate={() => setMobileMenuOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex flex-col">
          <h1 className="text-lg font-semibold text-[#1B3A6B]">{title}</h1>
          <Breadcrumbs />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <FactoryFilter user={user} factories={factories} />
        <NotificationBell userId={user.id} />

        <DropdownMenu>
          <DropdownMenuTrigger
            id="header-user-menu"
            className="flex items-center gap-2 rounded-md px-1 py-1.5 sm:px-2 text-sm text-[#6B7280] transition-colors hover:bg-[#F4F6F9] hover:text-[#1B3A6B] focus:outline-none"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-[#1B3A6B] text-xs text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden sm:block font-medium">
              {user.full_name?.split(' ')[0]}
            </span>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56 border-[#E8ECF0] bg-white">
            <DropdownMenuLabel className="text-[#6B7280]">
              <div className="font-medium text-[#1B3A6B]">{user.full_name}</div>
              <div className="text-xs font-normal text-[#9CA3AF]">
                {ROLES[user.role]?.label}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[#E8ECF0]" />
            <DropdownMenuItem
              className="cursor-pointer text-[#374151] hover:bg-[#F4F6F9] hover:text-[#1B3A6B]"
              onClick={() => {
                if (pathname !== ROUTES.ADMIN_USERS) {
                  start()
                }
                router.push(ROUTES.ADMIN_USERS)
              }}
            >
              <User2 className="mr-2 h-4 w-4" />
              Профиль
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#E8ECF0]" />
            <DropdownMenuItem
              id="header-logout-btn"
              className="cursor-pointer text-[#DC2626] focus:bg-red-50 focus:text-[#DC2626]"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
