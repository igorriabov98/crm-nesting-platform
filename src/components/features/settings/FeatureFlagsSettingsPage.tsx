'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Flag, History, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { updateFeatureFlag } from '@/lib/actions/feature-flags'
import type { FeatureFlagAdminDashboard } from '@/lib/feature-flags/admin'

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '—'
}

function stateLabel(enabled: boolean | null) {
  if (enabled === null) return 'не существовал'
  return enabled ? 'включён' : 'выключен'
}

export function FeatureFlagsSettingsPage({ initial }: { initial: FeatureFlagAdminDashboard }) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [refreshing, startTransition] = useTransition()

  async function toggleFlag(key: FeatureFlagAdminDashboard['flags'][number]['key'], enabled: boolean) {
    setPendingKey(key)
    const result = await updateFeatureFlag({ key, enabled })
    setPendingKey(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success(enabled ? 'Фичефлаг включён' : 'Фичефлаг выключен')
    startTransition(() => router.refresh())
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#1B3A6B]">
            <Flag className="size-5" />
            Фичефлаги
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Глобальные серверные переключатели. Новое значение действует со следующего запроса без redeploy.</p>
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />
            При отсутствии записи или ошибке чтения функционал считается выключенным.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {initial.flags.map((flag) => (
          <Card key={flag.key} className={flag.enabled ? 'border-emerald-200' : 'border-slate-200'}>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`feature-flag-${flag.key}`} className="font-medium text-foreground">{flag.label}</label>
                  <Badge variant={flag.enabled ? 'default' : 'outline'}>{flag.enabled ? 'Включено' : 'Выключено'}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{flag.description}</p>
                <p className="font-mono text-xs text-slate-500">{flag.key}</p>
                <p className="text-xs text-slate-500">
                  Последнее изменение: {flag.updatedByName || 'Система'} · {formatDate(flag.updatedAt)}
                </p>
              </div>
              <Switch
                id={`feature-flag-${flag.key}`}
                checked={flag.enabled}
                disabled={pendingKey !== null || refreshing}
                aria-label={`${flag.enabled ? 'Выключить' : 'Включить'}: ${flag.label}`}
                onCheckedChange={(checked) => void toggleFlag(flag.key, checked)}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-[#1B3A6B]">
            <History className="size-5" />
            История изменений
          </CardTitle>
        </CardHeader>
        <CardContent>
          {initial.audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Изменений пока нет.</p>
          ) : (
            <div className="divide-y">
              {initial.audit.map((entry) => (
                <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-sm text-foreground">{entry.flagKey}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(entry.changedAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.changedByName || 'Система'}: {stateLabel(entry.oldEnabled)} → {stateLabel(entry.newEnabled)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
