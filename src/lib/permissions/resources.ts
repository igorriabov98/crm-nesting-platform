import { ROUTES } from '@/lib/constants/routes'
import type { UserRole } from '@/lib/types'

export type PermissionOperation = 'view' | 'manage'

export type ResourceKey =
  | 'dashboard'
  | 'sales_plan'
  | 'client_prices'
  | 'technologist_requests'
  | 'products'
  | 'product_projects'
  | 'clients'
  | 'contracts'
  | 'invoices'
  | 'finance_calendar'
  | 'supply_finance'
  | 'tasks'
  | 'production'
  | 'production_fact'
  | 'consumable_requests'
  | 'consumables'
  | 'supply'
  | 'supply_consumable_requests'
  | 'supply_transport'
  | 'supply_orders'
  | 'inventory'
  | 'inventory_history'
  | 'inventory_receiving'
  | 'suppliers'
  | 'materials'
  | 'nesting'
  | 'nesting_catalog'
  | 'nesting_settings'
  | 'meetings'
  | 'meetings_agenda_pool'
  | 'notifications'
  | 'admin_settings'
  | 'departments'
  | 'admin_users'
  | 'telegram_settings'
  | 'company_settings'
  | 'access_settings'

export type SidebarSection = 'primary' | 'sales' | 'finance' | 'workflow' | 'production' | 'supply' | 'inventory' | 'meetings' | 'tools' | 'settings'

export type SidebarIconKey =
  | 'dashboard'
  | 'salesPlan'
  | 'prices'
  | 'products'
  | 'projects'
  | 'clients'
  | 'contracts'
  | 'invoices'
  | 'finance'
  | 'tasks'
  | 'production'
  | 'consumableRequests'
  | 'consumables'
  | 'orders'
  | 'transport'
  | 'inventory'
  | 'history'
  | 'receiving'
  | 'suppliers'
  | 'materials'
  | 'nesting'
  | 'meetings'
  | 'agenda'
  | 'notifications'
  | 'settings'
  | 'access'
  | 'departments'

type RouteMatcher = {
  path?: string
  regex?: RegExp
  match?: 'exact' | 'prefix'
  operation: PermissionOperation
  priority?: number
}

export type PermissionResource = {
  key: ResourceKey
  label: string
  description?: string
  group: string
  defaultHref?: string
  defaultViewRoles: readonly UserRole[] | 'all'
  defaultManageRoles: readonly UserRole[] | 'all'
  routes: readonly RouteMatcher[]
  sidebar?: {
    section: SidebarSection
    icon: SidebarIconKey
    order: number
  }
  locked?: boolean
}

export type PermissionState = {
  canView: boolean
  canManage: boolean
}

export type PermissionMap = Partial<Record<ResourceKey, PermissionState>>

export const ALL_USER_ROLES = [
  'financial_director',
  'commercial_director',
  'planning_director',
  'sales_manager',
  'engineer',
  'technologist',
  'supply_manager',
  'production_manager',
  'procurement_head',
  'painting_head',
] as const satisfies readonly UserRole[]

export const DIRECTOR_ACCESS_ROLES = [
  'financial_director',
  'commercial_director',
  'planning_director',
] as const satisfies readonly UserRole[]

const DIRECTORS = DIRECTOR_ACCESS_ROLES
const ALL = ALL_USER_ROLES
const SALES_AND_DIRECTORS = ['sales_manager', ...DIRECTORS] as const satisfies readonly UserRole[]
const PRODUCT_ROLES = ['sales_manager', 'engineer', ...DIRECTORS] as const satisfies readonly UserRole[]
const FINANCE_VIEW_ROLES = ['supply_manager', ...DIRECTORS] as const satisfies readonly UserRole[]
const FINANCE_MANAGE_ROLES = ['financial_director', 'planning_director', 'supply_manager'] as const satisfies readonly UserRole[]
const SUPPLY_AND_DIRECTORS = ['supply_manager', ...DIRECTORS] as const satisfies readonly UserRole[]
const TRANSPORT_SUPPLY_ROLES = ['supply_manager', 'procurement_head', ...DIRECTORS] as const satisfies readonly UserRole[]
const INVENTORY_RECEIVING_ROLES = ['supply_manager', 'procurement_head', 'engineer', 'technologist', ...DIRECTORS] as const satisfies readonly UserRole[]
const REQUEST_VIEW_ROLES = ['engineer', 'technologist', 'supply_manager', ...DIRECTORS] as const satisfies readonly UserRole[]
const REQUEST_MANAGE_ROLES = ['technologist', ...DIRECTORS] as const satisfies readonly UserRole[]
const SUPPLY_MANAGE_ROLES = ['engineer', 'technologist', 'supply_manager', ...DIRECTORS] as const satisfies readonly UserRole[]
const NESTING_ROLES = ['technologist', ...DIRECTORS] as const satisfies readonly UserRole[]
const PRODUCTION_CONSUMABLE_ROLES = ['production_manager', ...DIRECTORS] as const satisfies readonly UserRole[]
const SUPPLY_CONSUMABLE_ROLES = ['supply_manager', 'procurement_head', ...DIRECTORS] as const satisfies readonly UserRole[]

export const PERMISSION_RESOURCES = [
  {
    key: 'dashboard',
    label: 'Дашборд',
    group: 'Основное',
    defaultHref: ROUTES.DASHBOARD,
    defaultViewRoles: ALL,
    defaultManageRoles: [],
    routes: [{ path: ROUTES.DASHBOARD, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'primary', icon: 'dashboard', order: 10 },
  },
  {
    key: 'sales_plan',
    label: 'План продаж',
    group: 'Sales',
    defaultHref: ROUTES.SALES_PLAN,
    defaultViewRoles: ALL,
    defaultManageRoles: SALES_AND_DIRECTORS,
    routes: [
      { path: ROUTES.SALES_PLAN_NEW, match: 'exact', operation: 'manage', priority: 100 },
      { regex: /^\/sales-plan\/[^/]+$/, operation: 'view', priority: 70 },
      { path: ROUTES.SALES_PLAN, match: 'exact', operation: 'view' },
    ],
    sidebar: { section: 'sales', icon: 'salesPlan', order: 10 },
  },
  {
    key: 'client_prices',
    label: 'Цены',
    group: 'Sales',
    defaultHref: ROUTES.SALES_PLAN_PRICES,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [{ path: ROUTES.SALES_PLAN_PRICES, match: 'prefix', operation: 'view', priority: 120 }],
    sidebar: { section: 'sales', icon: 'prices', order: 15 },
  },
  {
    key: 'technologist_requests',
    label: 'Заявки технолога',
    group: 'Sales',
    defaultViewRoles: REQUEST_VIEW_ROLES,
    defaultManageRoles: REQUEST_MANAGE_ROLES,
    routes: [{ regex: /^\/sales-plan\/[^/]+\/request(?:\/.*)?$/, operation: 'view', priority: 90 }],
  },
  {
    key: 'products',
    label: 'Продукция',
    group: 'Sales',
    defaultHref: ROUTES.PRODUCTS,
    defaultViewRoles: PRODUCT_ROLES,
    defaultManageRoles: PRODUCT_ROLES,
    routes: [
      { path: ROUTES.PRODUCTS_NEW, match: 'exact', operation: 'manage', priority: 100 },
      { path: ROUTES.PRODUCTS, match: 'prefix', operation: 'view' },
    ],
    sidebar: { section: 'sales', icon: 'products', order: 20 },
  },
  {
    key: 'product_projects',
    label: 'Проекты продукции',
    group: 'Sales',
    defaultHref: ROUTES.PRODUCT_PROJECTS,
    defaultViewRoles: PRODUCT_ROLES,
    defaultManageRoles: PRODUCT_ROLES,
    routes: [
      { path: ROUTES.PRODUCT_PROJECTS_NEW, match: 'exact', operation: 'manage', priority: 100 },
      { path: ROUTES.PRODUCT_PROJECTS, match: 'prefix', operation: 'view' },
    ],
    sidebar: { section: 'sales', icon: 'projects', order: 30 },
  },
  {
    key: 'clients',
    label: 'База клиентов',
    group: 'Sales',
    defaultHref: ROUTES.CLIENTS,
    defaultViewRoles: SALES_AND_DIRECTORS,
    defaultManageRoles: SALES_AND_DIRECTORS,
    routes: [{ path: ROUTES.CLIENTS, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'sales', icon: 'clients', order: 40 },
  },
  {
    key: 'contracts',
    label: 'Контракты',
    group: 'Sales',
    defaultHref: ROUTES.CONTRACTS,
    defaultViewRoles: SALES_AND_DIRECTORS,
    defaultManageRoles: SALES_AND_DIRECTORS,
    routes: [{ path: ROUTES.CONTRACTS, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'sales', icon: 'contracts', order: 50 },
  },
  {
    key: 'invoices',
    label: 'Инвойсы',
    group: 'Финансы',
    defaultHref: ROUTES.INVOICES,
    defaultViewRoles: SALES_AND_DIRECTORS,
    defaultManageRoles: ['financial_director', 'planning_director', 'sales_manager'],
    routes: [{ path: ROUTES.INVOICES, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'finance', icon: 'invoices', order: 10 },
  },
  {
    key: 'finance_calendar',
    label: 'Финансовый план',
    group: 'Финансы',
    defaultHref: ROUTES.FINANCE_CALENDAR,
    defaultViewRoles: FINANCE_VIEW_ROLES,
    defaultManageRoles: FINANCE_MANAGE_ROLES,
    routes: [{ path: ROUTES.FINANCE_CALENDAR, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'finance', icon: 'finance', order: 20 },
  },
  {
    key: 'supply_finance',
    label: 'Финансы снабжение',
    group: 'Финансы',
    defaultHref: ROUTES.SUPPLY_FINANCE,
    defaultViewRoles: FINANCE_VIEW_ROLES,
    defaultManageRoles: FINANCE_MANAGE_ROLES,
    routes: [{ path: ROUTES.SUPPLY_FINANCE, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'finance', icon: 'finance', order: 30 },
  },
  {
    key: 'tasks',
    label: 'Задачи',
    group: 'Работа',
    defaultHref: ROUTES.TASKS,
    defaultViewRoles: ALL,
    defaultManageRoles: ALL,
    routes: [{ path: ROUTES.TASKS, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'workflow', icon: 'tasks', order: 10 },
  },
  {
    key: 'production',
    label: 'План производства',
    group: 'Производство',
    defaultHref: ROUTES.PRODUCTION,
    defaultViewRoles: ALL,
    defaultManageRoles: ['production_manager', 'sales_manager', ...DIRECTORS],
    routes: [
      { path: ROUTES.GANTT, match: 'prefix', operation: 'view', priority: 80 },
      { path: ROUTES.PRODUCTION, match: 'prefix', operation: 'view' },
    ],
    sidebar: { section: 'production', icon: 'production', order: 10 },
  },
  {
    key: 'production_fact',
    label: 'Факт производства',
    group: 'Производство',
    defaultHref: ROUTES.PRODUCTION_FACT,
    defaultViewRoles: PRODUCTION_CONSUMABLE_ROLES,
    defaultManageRoles: PRODUCTION_CONSUMABLE_ROLES,
    routes: [{ path: ROUTES.PRODUCTION_FACT, match: 'prefix', operation: 'view', priority: 100 }],
    sidebar: { section: 'production', icon: 'history', order: 20 },
  },
  {
    key: 'consumable_requests',
    label: 'Заявки на расходники',
    group: 'Производство',
    defaultHref: ROUTES.PRODUCTION_CONSUMABLE_REQUESTS,
    defaultViewRoles: PRODUCTION_CONSUMABLE_ROLES,
    defaultManageRoles: PRODUCTION_CONSUMABLE_ROLES,
    routes: [{ path: ROUTES.PRODUCTION_CONSUMABLE_REQUESTS, match: 'prefix', operation: 'view', priority: 90 }],
    sidebar: { section: 'production', icon: 'consumableRequests', order: 30 },
  },
  {
    key: 'consumables',
    label: 'Расходники',
    group: 'Производство',
    defaultHref: ROUTES.PRODUCTION_CONSUMABLES,
    defaultViewRoles: PRODUCTION_CONSUMABLE_ROLES,
    defaultManageRoles: PRODUCTION_CONSUMABLE_ROLES,
    routes: [{ path: ROUTES.PRODUCTION_CONSUMABLES, match: 'prefix', operation: 'view', priority: 90 }],
    sidebar: { section: 'production', icon: 'consumables', order: 40 },
  },
  {
    key: 'supply',
    label: 'Снабжение',
    group: 'Снабжение',
    defaultHref: ROUTES.SUPPLY,
    defaultViewRoles: ALL,
    defaultManageRoles: SUPPLY_MANAGE_ROLES,
    routes: [
      { path: ROUTES.SUPPLY_REQUEST, match: 'prefix', operation: 'view', priority: 70 },
      { regex: /^\/supply\/[^/]+$/, operation: 'view', priority: 60 },
      { path: ROUTES.SUPPLY, match: 'exact', operation: 'view' },
    ],
  },
  {
    key: 'supply_orders',
    label: 'Заказы снабжения',
    group: 'Снабжение',
    defaultHref: ROUTES.SUPPLY_ORDERS,
    defaultViewRoles: SUPPLY_AND_DIRECTORS,
    defaultManageRoles: SUPPLY_AND_DIRECTORS,
    routes: [{ path: ROUTES.SUPPLY_ORDERS, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'supply', icon: 'orders', order: 10 },
  },
  {
    key: 'supply_consumable_requests',
    label: 'Заявки производства',
    group: 'Снабжение',
    defaultHref: ROUTES.SUPPLY_CONSUMABLE_REQUESTS,
    defaultViewRoles: SUPPLY_CONSUMABLE_ROLES,
    defaultManageRoles: SUPPLY_CONSUMABLE_ROLES,
    routes: [{ path: ROUTES.SUPPLY_CONSUMABLE_REQUESTS, match: 'prefix', operation: 'view', priority: 90 }],
    sidebar: { section: 'supply', icon: 'consumableRequests', order: 5 },
  },
  {
    key: 'supply_transport',
    label: 'Транспорт',
    group: 'Снабжение',
    defaultHref: ROUTES.SUPPLY_TRANSPORT,
    defaultViewRoles: TRANSPORT_SUPPLY_ROLES,
    defaultManageRoles: TRANSPORT_SUPPLY_ROLES,
    routes: [{ path: ROUTES.SUPPLY_TRANSPORT, match: 'prefix', operation: 'view', priority: 95 }],
    sidebar: { section: 'supply', icon: 'transport', order: 8 },
  },
  {
    key: 'inventory',
    label: 'Склад',
    group: 'Склад',
    defaultHref: ROUTES.INVENTORY,
    defaultViewRoles: SUPPLY_AND_DIRECTORS,
    defaultManageRoles: SUPPLY_AND_DIRECTORS,
    routes: [{ path: ROUTES.INVENTORY, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'inventory', icon: 'inventory', order: 10 },
  },
  {
    key: 'inventory_history',
    label: 'История склада',
    group: 'Склад',
    defaultHref: ROUTES.INVENTORY_HISTORY,
    defaultViewRoles: SUPPLY_AND_DIRECTORS,
    defaultManageRoles: SUPPLY_AND_DIRECTORS,
    routes: [{ path: ROUTES.INVENTORY_HISTORY, match: 'prefix', operation: 'view', priority: 110 }],
    sidebar: { section: 'inventory', icon: 'history', order: 20 },
  },
  {
    key: 'inventory_receiving',
    label: 'Прием материала',
    group: 'Склад',
    defaultHref: ROUTES.INVENTORY_RECEIVING,
    defaultViewRoles: INVENTORY_RECEIVING_ROLES,
    defaultManageRoles: INVENTORY_RECEIVING_ROLES,
    routes: [{ path: ROUTES.INVENTORY_RECEIVING, match: 'prefix', operation: 'view', priority: 100 }],
    sidebar: { section: 'inventory', icon: 'receiving', order: 30 },
  },
  {
    key: 'suppliers',
    label: 'Поставщики',
    group: 'Снабжение',
    defaultHref: ROUTES.ADMIN_SUPPLIERS,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [
      { path: ROUTES.ADMIN_SUPPLIERS_NEW, match: 'exact', operation: 'manage', priority: 100 },
      { regex: /^\/admin\/suppliers\/[^/]+$/, operation: 'manage', priority: 90 },
      { path: ROUTES.ADMIN_SUPPLIERS, match: 'exact', operation: 'view' },
    ],
    sidebar: { section: 'supply', icon: 'suppliers', order: 30 },
  },
  {
    key: 'materials',
    label: 'Справочник материалов',
    group: 'Снабжение',
    defaultHref: ROUTES.ADMIN_MATERIALS,
    defaultViewRoles: SUPPLY_AND_DIRECTORS,
    defaultManageRoles: SUPPLY_AND_DIRECTORS,
    routes: [{ path: ROUTES.ADMIN_MATERIALS, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'tools', icon: 'materials', order: 20 },
  },
  {
    key: 'nesting',
    label: 'Раскладка',
    group: 'Раскладка',
    defaultHref: ROUTES.NESTING,
    defaultViewRoles: NESTING_ROLES,
    defaultManageRoles: NESTING_ROLES,
    routes: [
      { path: '/nesting/new', match: 'prefix', operation: 'manage', priority: 100 },
      { regex: /^\/nesting\/[^/]+\/(?:parts|result)(?:\/.*)?$/, operation: 'view', priority: 70 },
      { path: ROUTES.NESTING, match: 'exact', operation: 'view' },
    ],
    sidebar: { section: 'tools', icon: 'nesting', order: 10 },
  },
  {
    key: 'nesting_catalog',
    label: 'Каталог раскладки',
    group: 'Раскладка',
    defaultHref: ROUTES.NESTING_CATALOG,
    defaultViewRoles: NESTING_ROLES,
    defaultManageRoles: NESTING_ROLES,
    routes: [{ path: ROUTES.NESTING_CATALOG, match: 'prefix', operation: 'view', priority: 90 }],
  },
  {
    key: 'nesting_settings',
    label: 'Настройки AI раскладки',
    group: 'Раскладка',
    defaultHref: ROUTES.NESTING_SETTINGS,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [{ path: ROUTES.NESTING_SETTINGS, match: 'prefix', operation: 'view', priority: 90 }],
  },
  {
    key: 'meetings',
    label: 'Собрания',
    group: 'Совещания',
    defaultHref: ROUTES.MEETINGS,
    defaultViewRoles: ALL,
    defaultManageRoles: DIRECTORS,
    routes: [
      { path: ROUTES.MEETINGS_NEW, match: 'exact', operation: 'manage', priority: 100 },
      { regex: /^\/meetings\/[^/]+$/, operation: 'view', priority: 60 },
      { path: ROUTES.MEETINGS, match: 'exact', operation: 'view' },
    ],
    sidebar: { section: 'meetings', icon: 'meetings', order: 10 },
  },
  {
    key: 'meetings_agenda_pool',
    label: 'Пул повесток',
    group: 'Совещания',
    defaultHref: ROUTES.MEETINGS_AGENDA_POOL,
    defaultViewRoles: ['planning_director'],
    defaultManageRoles: ['planning_director'],
    routes: [{ path: ROUTES.MEETINGS_AGENDA_POOL, match: 'prefix', operation: 'view', priority: 90 }],
    sidebar: { section: 'meetings', icon: 'agenda', order: 20 },
  },
  {
    key: 'notifications',
    label: 'Уведомления',
    group: 'Основное',
    defaultHref: ROUTES.NOTIFICATIONS,
    defaultViewRoles: ALL,
    defaultManageRoles: ALL,
    routes: [{ path: ROUTES.NOTIFICATIONS, match: 'prefix', operation: 'view' }],
    sidebar: { section: 'primary', icon: 'notifications', order: 20 },
  },
  {
    key: 'admin_settings',
    label: 'Настройки',
    group: 'Настройки',
    defaultHref: ROUTES.ADMIN_SETTINGS,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [{ path: ROUTES.ADMIN_SETTINGS, match: 'exact', operation: 'view' }],
    sidebar: { section: 'settings', icon: 'settings', order: 10 },
  },
  {
    key: 'departments',
    label: 'Отделы и структура',
    description: 'Управление отделами, должностями и подчинением',
    group: 'Настройки',
    defaultHref: ROUTES.ADMIN_DEPARTMENTS,
    defaultViewRoles: ALL,
    defaultManageRoles: ['financial_director', 'planning_director'],
    routes: [{ path: ROUTES.ADMIN_DEPARTMENTS, match: 'prefix', operation: 'view', priority: 90 }],
    sidebar: { section: 'settings', icon: 'departments', order: 30 },
  },
  {
    key: 'admin_users',
    label: 'Пользователи',
    group: 'Настройки',
    defaultHref: ROUTES.ADMIN_USERS,
    defaultViewRoles: ['planning_director'],
    defaultManageRoles: ['planning_director'],
    routes: [
      { path: ROUTES.ADMIN_USERS_NEW, match: 'exact', operation: 'manage', priority: 100 },
      { path: ROUTES.ADMIN_USERS, match: 'prefix', operation: 'view' },
    ],
  },
  {
    key: 'telegram_settings',
    label: 'Настройки Telegram',
    group: 'Настройки',
    defaultHref: ROUTES.ADMIN_TELEGRAM_SETTINGS,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [{ path: ROUTES.ADMIN_TELEGRAM_SETTINGS, match: 'prefix', operation: 'view', priority: 90 }],
  },
  {
    key: 'company_settings',
    label: 'Настройки компании',
    group: 'Настройки',
    defaultHref: ROUTES.ADMIN_COMPANY_SETTINGS,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [{ path: ROUTES.ADMIN_COMPANY_SETTINGS, match: 'prefix', operation: 'view', priority: 90 }],
  },
  {
    key: 'access_settings',
    label: 'Управление доступом',
    group: 'Настройки',
    defaultHref: ROUTES.ADMIN_ACCESS_SETTINGS,
    defaultViewRoles: DIRECTORS,
    defaultManageRoles: DIRECTORS,
    routes: [{ path: ROUTES.ADMIN_ACCESS_SETTINGS, match: 'prefix', operation: 'manage', priority: 120 }],
    sidebar: { section: 'settings', icon: 'access', order: 20 },
    locked: true,
  },
] as const satisfies readonly PermissionResource[]

export function isLockedResource(resource: unknown) {
  return Boolean(
    resource &&
      typeof resource === 'object' &&
      'locked' in resource &&
      (resource as { locked?: unknown }).locked === true
  )
}

export const SWITCHABLE_PERMISSION_RESOURCES = PERMISSION_RESOURCES.filter((resource) => !isLockedResource(resource))

export const RESOURCE_BY_KEY = Object.fromEntries(
  PERMISSION_RESOURCES.map((resource) => [resource.key, resource])
) as unknown as Record<ResourceKey, PermissionResource>

export function isDirectorRole(role: UserRole) {
  return (DIRECTOR_ACCESS_ROLES as readonly UserRole[]).includes(role)
}

export function getDefaultPermission(resource: PermissionResource, role: UserRole): PermissionState {
  const canManage = resource.defaultManageRoles === 'all' || resource.defaultManageRoles.includes(role)
  const canView = canManage || resource.defaultViewRoles === 'all' || resource.defaultViewRoles.includes(role)
  return { canView, canManage }
}

export function getDefaultPermissionMap(role: UserRole): PermissionMap {
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [resource.key, getDefaultPermission(resource, role)])
  ) as PermissionMap
}

export function hasResourcePermission(
  _role: UserRole | null | undefined,
  permissions: PermissionMap,
  resourceKey: ResourceKey,
  operation: PermissionOperation,
) {
  if (!(resourceKey in RESOURCE_BY_KEY)) return false
  const permission = permissions[resourceKey] || { canView: false, canManage: false }
  return operation === 'manage' ? permission.canManage : permission.canView || permission.canManage
}

export function hasPermission(
  permissions: PermissionMap,
  resourceKey: ResourceKey,
  operation: PermissionOperation,
) {
  return hasResourcePermission(null, permissions, resourceKey, operation)
}

export function getEmptyPermissionMap(): PermissionMap {
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [resource.key, { canView: false, canManage: false }])
  ) as PermissionMap
}

export function getFullPermissionMap(): PermissionMap {
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [resource.key, { canView: true, canManage: true }])
  ) as PermissionMap
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === '/') return pathname
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function routeMatches(route: RouteMatcher, pathname: string) {
  if (route.regex) return route.regex.test(pathname)
  if (!route.path) return false
  const routePath = normalizePathname(route.path)
  if (route.match === 'exact') return pathname === routePath
  return pathname === routePath || pathname.startsWith(`${routePath}/`)
}

export function getPermissionRequirementForPath(pathname: string) {
  const normalized = normalizePathname(pathname)
  const matches = PERMISSION_RESOURCES.flatMap((resource) =>
    (resource.routes as readonly RouteMatcher[])
      .filter((route) => routeMatches(route, normalized))
      .map((route) => ({
        resourceKey: resource.key,
        operation: route.operation,
        priority: route.priority || (route.regex ? 50 : route.path?.length || 0),
      }))
  )

  return matches.sort((a, b) => b.priority - a.priority)[0] || null
}

export function getSidebarResources(
  role: UserRole | null | undefined,
  permissions: PermissionMap,
  section: SidebarSection,
) {
  return (PERMISSION_RESOURCES as readonly PermissionResource[])
    .filter((resource) => resource.sidebar?.section === section && resource.defaultHref)
    .filter((resource) => hasResourcePermission(role, permissions, resource.key, 'view'))
    .sort((a, b) => (a.sidebar?.order || 0) - (b.sidebar?.order || 0))
}
