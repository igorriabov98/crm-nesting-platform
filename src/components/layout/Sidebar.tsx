'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  ListChecks,
  Factory as FactoryIcon,
  Package,
  ShoppingCart,
  Calendar,
  Receipt,
  Landmark,
  Bell,
  Users,
  Truck,
  Boxes,
  Warehouse,
  Settings,
  Shapes,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  Building2,
  ShieldCheck,
  PackagePlus,
  History,
  Tags,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getSidebarResources,
  type PermissionMap,
  type PermissionResource,
  type SidebarIconKey,
} from '@/lib/permissions/resources'
import { Button } from '@/components/ui/button'
import type { CurrentUser } from '@/lib/types'

interface SidebarProps {
  user: CurrentUser
  permissions: PermissionMap
  isMobile?: boolean
  onNavigate?: () => void
}

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
}

const iconMap: Record<SidebarIconKey, React.ElementType> = {
  dashboard: LayoutDashboard,
  salesPlan: ClipboardList,
  prices: Tags,
  products: Boxes,
  projects: ClipboardList,
  clients: Users,
  contracts: FileText,
  invoices: Receipt,
  finance: Landmark,
  tasks: ListChecks,
  production: FactoryIcon,
  consumableRequests: ClipboardList,
  consumables: Warehouse,
  orders: ShoppingCart,
  inventory: Warehouse,
  history: History,
  receiving: PackagePlus,
  suppliers: Truck,
  materials: Boxes,
  nesting: Shapes,
  meetings: Calendar,
  agenda: ListChecks,
  notifications: Bell,
  settings: Settings,
  access: ShieldCheck,
  departments: Building2,
}

function toNavItem(resource: PermissionResource): NavItem | null {
  if (!resource.defaultHref || !resource.sidebar) return null
  return {
    href: resource.defaultHref,
    label: resource.key === 'admin_settings' ? 'Все настройки' : resource.label,
    icon: iconMap[resource.sidebar.icon],
    exact: resource.key === 'production' || resource.key === 'inventory',
  }
}

function sectionItems(user: CurrentUser, permissions: PermissionMap, section: Parameters<typeof getSidebarResources>[2]) {
  return getSidebarResources(user.role, permissions, section)
    .map(toNavItem)
    .filter((item): item is NavItem => Boolean(item))
}

export function Sidebar({ user, permissions, isMobile = false, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentFactory = searchParams.get('factory')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isSalesMenuOpen, setIsSalesMenuOpen] = useState(false)
  const [isFinanceMenuOpen, setIsFinanceMenuOpen] = useState(false)
  const [isProductionMenuOpen, setIsProductionMenuOpen] = useState(false)
  const [isSupplyMenuOpen, setIsSupplyMenuOpen] = useState(false)
  const [isInventoryMenuOpen, setIsInventoryMenuOpen] = useState(false)
  const [isMeetingsMenuOpen, setIsMeetingsMenuOpen] = useState(false)
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false)

  const collapsed = isMobile ? false : isCollapsed
  const profileLabel = (user.department_memberships || [])
    .map((membership) => membership.position?.name || membership.department?.name || null)
    .filter(Boolean)[0] || 'Профиль CRM'

  const primaryItems = sectionItems(user, permissions, 'primary')
  const salesItems = sectionItems(user, permissions, 'sales')
  const financeItems = sectionItems(user, permissions, 'finance')
  const workflowItems = sectionItems(user, permissions, 'workflow')
  const productionItems = sectionItems(user, permissions, 'production')
  const supplyItems = sectionItems(user, permissions, 'supply')
  const inventoryItems = sectionItems(user, permissions, 'inventory')
  const meetingItems = sectionItems(user, permissions, 'meetings')
  const toolsItems = sectionItems(user, permissions, 'tools')
  const settingsItems = sectionItems(user, permissions, 'settings')

  function navHref(item: NavItem) {
    return currentFactory ? `${item.href}?factory=${currentFactory}` : item.href
  }

  function isActiveItem(item: NavItem) {
    return pathname === item.href || (!item.exact && pathname.startsWith(item.href + '/'))
  }

  const isSalesActive = salesItems.some(isActiveItem)
  const isSalesExpanded = !collapsed && (isSalesMenuOpen || isSalesActive)
  const isFinanceActive = financeItems.some(isActiveItem)
  const isFinanceExpanded = !collapsed && (isFinanceMenuOpen || isFinanceActive)
  const isProductionActive = productionItems.some(isActiveItem)
  const isProductionExpanded = !collapsed && (isProductionMenuOpen || isProductionActive)
  const isSupplyActive = supplyItems.some(isActiveItem)
  const isSupplyExpanded = !collapsed && (isSupplyMenuOpen || isSupplyActive)
  const isInventoryActive = inventoryItems.some(isActiveItem)
  const isInventoryExpanded = !collapsed && (isInventoryMenuOpen || isInventoryActive)
  const isMeetingsActive = meetingItems.some(isActiveItem)
  const isMeetingsExpanded = !collapsed && (isMeetingsMenuOpen || isMeetingsActive)
  const isSettingsActive = settingsItems.some(isActiveItem)
  const isSettingsExpanded = !collapsed && (isSettingsMenuOpen || isSettingsActive)

  function renderNavItem(item: NavItem, nested = false) {
    const Icon = item.icon
    const isActive = isActiveItem(item)

    return (
      <Link
        key={item.href}
        href={navHref(item)}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={cn(
          'group flex items-center rounded-lg transition-all',
          collapsed ? 'justify-center px-0 py-2.5' : nested ? 'gap-2 px-3 py-2 pl-5 text-sm' : 'gap-3 px-3 py-2.5',
          isActive
            ? 'bg-[#1B3A6B] text-white font-medium'
            : 'text-[#6B7280] hover:bg-[#F4F6F9] hover:text-[#1B3A6B] font-medium'
        )}
      >
        <Icon className={cn(nested ? 'h-4 w-4 shrink-0' : 'h-5 w-5 shrink-0', isActive ? 'text-white' : 'text-[#9CA3AF] group-hover:text-[#1B3A6B]')} />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {isActive && !nested && <ChevronRight className="h-4 w-4 text-white/70" />}
          </>
        )}
      </Link>
    )
  }

  function renderMenu({
    items,
    label,
    collapsedTitle,
    isActive,
    isExpanded,
    toggle,
    icon: Icon,
  }: {
    items: NavItem[]
    label: string
    collapsedTitle: string
    isActive: boolean
    isExpanded: boolean
    toggle: () => void
    icon: React.ElementType
  }) {
    if (items.length === 0) return null

    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? collapsedTitle : undefined}
          aria-expanded={isExpanded}
          className={cn(
            'group flex w-full items-center rounded-lg transition-all',
            collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
            isActive
              ? 'bg-[#F4F6F9] text-[#1B3A6B] font-semibold'
              : 'text-[#6B7280] hover:bg-[#F4F6F9] hover:text-[#1B3A6B] font-medium'
          )}
        >
          <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-[#1B3A6B]' : 'text-[#9CA3AF] group-hover:text-[#1B3A6B]')} />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">{label}</span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-[#9CA3AF] transition-transform group-hover:text-[#1B3A6B]',
                  isExpanded && 'rotate-180',
                  isActive && 'text-[#1B3A6B]'
                )}
              />
            </>
          )}
        </button>
        {isExpanded && (
          <div className="space-y-1">
            {items.map((item) => renderNavItem(item, true))}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-[#E8ECF0] bg-white transition-all duration-300',
        isMobile ? 'w-full h-full' : (collapsed ? 'w-[72px]' : 'w-[220px]'),
        !isMobile && 'hidden lg:flex h-full'
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#E8ECF0] px-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1B3A6B]">
            <FactoryIcon className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#1B3A6B]">CRM Завода</p>
              <p className="truncate text-xs text-[#9CA3AF]">{user.factory?.name ?? '-'}</p>
            </div>
          )}
        </div>

        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="h-8 w-8 shrink-0 text-[#9CA3AF] hover:text-[#1B3A6B] hover:bg-[#F4F6F9]"
            onClick={() => setIsCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-hide">
        {primaryItems.map((item) => renderNavItem(item))}

        {renderMenu({
          items: salesItems,
          label: 'Sales',
          collapsedTitle: 'Sales',
          isActive: isSalesActive,
          isExpanded: isSalesExpanded,
          toggle: () => setIsSalesMenuOpen((current) => !current),
          icon: ShoppingCart,
        })}

        {renderMenu({
          items: financeItems,
          label: 'Финансы',
          collapsedTitle: 'Финансы',
          isActive: isFinanceActive,
          isExpanded: isFinanceExpanded,
          toggle: () => setIsFinanceMenuOpen((current) => !current),
          icon: Landmark,
        })}

        {workflowItems.map((item) => renderNavItem(item))}

        {renderMenu({
          items: productionItems,
          label: 'Производство',
          collapsedTitle: 'Производство',
          isActive: isProductionActive,
          isExpanded: isProductionExpanded,
          toggle: () => setIsProductionMenuOpen((current) => !current),
          icon: FactoryIcon,
        })}

        {renderMenu({
          items: supplyItems,
          label: 'Снабжение',
          collapsedTitle: 'Снабжение',
          isActive: isSupplyActive,
          isExpanded: isSupplyExpanded,
          toggle: () => setIsSupplyMenuOpen((current) => !current),
          icon: Package,
        })}

        {renderMenu({
          items: inventoryItems,
          label: 'Склад',
          collapsedTitle: 'Склад',
          isActive: isInventoryActive,
          isExpanded: isInventoryExpanded,
          toggle: () => setIsInventoryMenuOpen((current) => !current),
          icon: Warehouse,
        })}

        {renderMenu({
          items: meetingItems,
          label: 'Совещания',
          collapsedTitle: 'Совещания',
          isActive: isMeetingsActive,
          isExpanded: isMeetingsExpanded,
          toggle: () => setIsMeetingsMenuOpen((current) => !current),
          icon: Calendar,
        })}

        {toolsItems.map((item) => renderNavItem(item))}

        {renderMenu({
          items: settingsItems,
          label: 'Настройки',
          collapsedTitle: 'Настройки',
          isActive: isSettingsActive,
          isExpanded: isSettingsExpanded,
          toggle: () => setIsSettingsMenuOpen((current) => !current),
          icon: Settings,
        })}
      </nav>

      <div className="border-t border-[#E8ECF0] p-4">
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1B3A6B] text-sm font-semibold text-white">
            {user.full_name?.charAt(0)?.toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#1B3A6B]">{user.full_name}</p>
              <p className="truncate text-xs text-[#9CA3AF]">{profileLabel}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
