import Link from 'next/link'
import { Bot, Building2, Send, Settings, ShieldCheck, Users } from 'lucide-react'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES } from '@/lib/constants/routes'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { getRolePermissionMap } from '@/lib/permissions/server'
import {
  hasResourcePermission,
  isDirectorRole,
  type PermissionMap,
  type ResourceKey,
} from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'

export const metadata = {
  title: 'Настройки - CRM Завода',
}

type SettingsCard = {
  key: string
  title: string
  description: string
  href: string
  buttonLabel: string
  icon: React.ElementType
}

function canViewResource(role: UserRole, permissions: PermissionMap, resourceKey: ResourceKey) {
  return hasResourcePermission(role, permissions, resourceKey, 'view')
}

export default async function AdminSettingsPage() {
  const { user } = await getCurrentUserContextOrRedirect()
  const permissions = await getRolePermissionMap(user.role)
  const canOpenAccessSettings = isDirectorRole(user.role)
  const canViewSettingsContent = permissions.admin_settings?.canView === true
    || permissions.admin_settings?.canManage === true

  if (!canOpenAccessSettings && !canViewSettingsContent) {
    return <AccessDenied />
  }

  const cards = [
    canOpenAccessSettings && {
      key: 'access',
      title: 'Управление доступом',
      description: 'Матрица ролей, доступных разделов, управления и журнал последних изменений.',
      href: ROUTES.ADMIN_ACCESS_SETTINGS,
      buttonLabel: 'Открыть управление доступом',
      icon: ShieldCheck,
    },
    canViewResource(user.role, permissions, 'departments') && {
      key: 'departments',
      title: 'Отделы и структура',
      description: 'Управление отделами, должностями, руководителями и подчинением сотрудников.',
      href: ROUTES.ADMIN_DEPARTMENTS,
      buttonLabel: 'Открыть отделы и структуру',
      icon: Building2,
    },
    canViewSettingsContent && canViewResource(user.role, permissions, 'nesting_settings') && {
      key: 'ai',
      title: 'Настройки AI',
      description: 'OpenRouter API ключ, модель, лимиты токенов, бюджет и история AI-запросов для анализа PDF-чертежей.',
      href: ROUTES.NESTING_SETTINGS,
      buttonLabel: 'Открыть настройки AI',
      icon: Bot,
    },
    canViewSettingsContent && canViewResource(user.role, permissions, 'admin_users') && {
      key: 'users',
      title: 'Настройка пользователей',
      description: 'Пользователи CRM, роли, фабрики, активность аккаунтов и Telegram chat ID для уведомлений.',
      href: ROUTES.ADMIN_USERS,
      buttonLabel: 'Открыть настройку пользователей',
      icon: Users,
    },
    canViewSettingsContent && canViewResource(user.role, permissions, 'telegram_settings') && {
      key: 'telegram',
      title: 'Настройки Telegram',
      description: 'Telegram bot token, подключенные пользователи и тестовые уведомления.',
      href: ROUTES.ADMIN_TELEGRAM_SETTINGS,
      buttonLabel: 'Открыть настройки Telegram',
      icon: Send,
    },
    canViewSettingsContent && canViewResource(user.role, permissions, 'company_settings') && {
      key: 'company',
      title: 'Настройки компании',
      description: 'Реквизиты компании, банк, подпись директора и печать для экспортных документов.',
      href: ROUTES.ADMIN_COMPANY_SETTINGS,
      buttonLabel: 'Открыть настройки компании',
      icon: Building2,
    },
  ].filter(Boolean) as SettingsCard[]

  return (
    <div className="space-y-5">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#1B3A6B]">
            <Settings className="h-5 w-5" />
            Настройки
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[#6B7280]">
            Выберите раздел настроек, который нужно открыть.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <SettingsLinkCard key={card.key} card={card} />
        ))}
      </div>
    </div>
  )
}

function SettingsLinkCard({ card }: { card: SettingsCard }) {
  const Icon = card.icon
  return (
    <Card className="bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#1B3A6B]">
          <Icon className="h-5 w-5" />
          {card.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[#6B7280]">{card.description}</p>
        <Link href={card.href} className={buttonVariants()}>
          {card.buttonLabel}
        </Link>
      </CardContent>
    </Card>
  )
}
