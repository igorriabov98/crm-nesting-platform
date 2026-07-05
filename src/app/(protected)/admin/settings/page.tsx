import Link from 'next/link'
import { Bot, Building2, Factory, Send, Settings, ShieldCheck, Users } from 'lucide-react'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ROUTES } from '@/lib/constants/routes'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import {
  hasPermission,
  type PermissionMap,
  type ResourceKey,
} from '@/lib/permissions/resources'

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

function canViewResource(permissions: PermissionMap, resourceKey: ResourceKey) {
  return hasPermission(permissions, resourceKey, 'view')
}

export default async function AdminSettingsPage() {
  const { user } = await getCurrentUserContextOrRedirect()
  const permissionDetails = await getCurrentUserPermissions(user.id)
  const permissions = permissionDetails.permissions
  const canOpenAccessSettings = hasPermission(permissions, 'access_settings', 'manage')
  const canViewSettingsContent = permissions.admin_settings?.canView === true
    || permissions.admin_settings?.canManage === true

  if (!canOpenAccessSettings && !canViewSettingsContent) {
    return <AccessDenied />
  }

  const cards = [
    canOpenAccessSettings && {
      key: 'access',
      title: 'Управление доступом',
      description: 'Матрица доступа по отделам: отдельно начальник отдела и подчинённые. Администратор CRM имеет полный доступ.',
      href: ROUTES.ADMIN_ACCESS_SETTINGS,
      buttonLabel: 'Открыть управление доступом',
      icon: ShieldCheck,
    },
    canViewResource(permissions, 'departments') && {
      key: 'departments',
      title: 'Отделы и структура',
      description: 'Управление отделами, должностями, руководителями и назначениями сотрудников.',
      href: ROUTES.ADMIN_DEPARTMENTS,
      buttonLabel: 'Открыть отделы и структуру',
      icon: Building2,
    },
    canViewSettingsContent && canViewResource(permissions, 'nesting_settings') && {
      key: 'ai',
      title: 'Настройки AI',
      description: 'OpenRouter API ключ, модель, лимиты токенов, бюджет и история AI-запросов для анализа PDF-чертежей.',
      href: ROUTES.NESTING_SETTINGS,
      buttonLabel: 'Открыть настройки AI',
      icon: Bot,
    },
    canViewSettingsContent && canViewResource(permissions, 'admin_users') && {
      key: 'users',
      title: 'Настройка пользователей',
      description: 'Пользователи CRM, отделы, должности, статус аккаунтов и Telegram chat ID.',
      href: ROUTES.ADMIN_USERS,
      buttonLabel: 'Открыть настройку пользователей',
      icon: Users,
    },
    canViewSettingsContent && canViewResource(permissions, 'telegram_settings') && {
      key: 'telegram',
      title: 'Настройки Telegram',
      description: 'Telegram bot token, подключённые пользователи и тестовые уведомления.',
      href: ROUTES.ADMIN_TELEGRAM_SETTINGS,
      buttonLabel: 'Открыть настройки Telegram',
      icon: Send,
    },
    canViewSettingsContent && canViewResource(permissions, 'company_settings') && {
      key: 'company',
      title: 'Настройки компании',
      description: 'Реквизиты компании, банк, подпись директора и печать для экспортных документов.',
      href: ROUTES.ADMIN_COMPANY_SETTINGS,
      buttonLabel: 'Открыть настройки компании',
      icon: Building2,
    },
    canViewSettingsContent && canViewResource(permissions, 'production_fact_settings') && {
      key: 'production-fact',
      title: 'Настройки факта производства',
      description: 'Стандартные участки, подучастки и привязка заготовки к складской логике.',
      href: ROUTES.ADMIN_PRODUCTION_FACT_SETTINGS,
      buttonLabel: 'Открыть настройки факта',
      icon: Factory,
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
