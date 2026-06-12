import { AccessDenied } from '@/components/ui/AccessDenied'
import { AISettingsPage } from '@/components/features/nesting/AISettingsPage'
import { requirePermission } from '@/lib/permissions/server'
import { getAISettings, getAIUsage, getNestingServiceUrl } from '@/lib/nesting/api'
import { AlertTriangle, ServerOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: 'Настройки AI — CRM Завода',
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Сервис раскладки недоступен'
}

function isLocalServiceUrl(url: string) {
  try {
    const hostname = new URL(url).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function NestingServiceUnavailable({ error }: { error: unknown }) {
  const serviceUrl = getNestingServiceUrl()
  const isMissingProductionUrl = !process.env.NESTING_SERVICE_URL || isLocalServiceUrl(serviceUrl)
  const message = getErrorMessage(error)

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center p-4">
      <Card className="w-full border-amber-200 bg-amber-50/70 text-[#1F2937]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              {isMissingProductionUrl ? (
                <ServerOff className="h-5 w-5 text-amber-700" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-700" />
              )}
            </span>
            <CardTitle>Сервис раскладки не подключен</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-[#374151]">
          <p>
            Настройки AI не могут быть загружены, потому что CRM сейчас не видит backend
            сервиса раскладки. После развертывания nesting-service добавьте в Vercel
            переменную
            {' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-xs">NESTING_SERVICE_URL</code>
            {' '}
            с публичным HTTPS адресом сервиса и выполните redeploy.
          </p>
          <p className="rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-[#92400E]">
            {isMissingProductionUrl
              ? `NESTING_SERVICE_URL не задан для production. Текущее значение: ${serviceUrl}`
              : message}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default async function NestingAISettingsRoute() {
  const allowed = await requirePermission('nesting_settings', 'view')
    .then(() => true)
    .catch(() => false)
  if (!allowed) return <AccessDenied />

  const data = await Promise.all([
    getAISettings(),
    getAIUsage(50),
  ])
    .then(([settings, usage]) => ({ settings, usage }))
    .catch((error) => ({ error }))

  if ('error' in data) {
    return <NestingServiceUnavailable error={data.error} />
  }

  return <AISettingsPage initialSettings={data.settings} initialUsage={data.usage.data} />
}
