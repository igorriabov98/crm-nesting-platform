import { AccessDenied } from '@/components/ui/AccessDenied'
import { CompanySettingsPage } from '@/components/features/settings/CompanySettingsPage'
import { getCompanySettings } from '@/lib/actions/company-settings'
import { requirePermission } from '@/lib/permissions/server'
import type { CurrentUserContext } from '@/lib/auth/current-user'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = {
  title: 'Настройки компании - CRM Завода',
}

async function createSignedImageUrl(
  supabase: CurrentUserContext['supabase'],
  path: string | null
) {
  if (!path) return null

  const { data, error } = await supabase.storage
    .from('product-files')
    .createSignedUrl(path, 3600)

  if (error) return null
  return data.signedUrl
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; details?: unknown; hint?: unknown }
    return [record.message, record.details, record.hint]
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .join(' ')
  }
  return ''
}

function CompanySettingsUnavailable({ error }: { error: unknown }) {
  const message = getErrorMessage(error)

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center p-4">
      <Card className="w-full border-amber-200 bg-amber-50/70 text-[#1F2937]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
            </span>
            <CardTitle>Настройки компании не инициализированы</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-[#374151]">
          <p>
            Страница доступна, но CRM не смогла загрузить запись настроек компании.
            Проверьте, что в production Supabase применена миграция
            {' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-xs">20260527000000_document_generation.sql</code>
            {' '}
            и существует строка
            {' '}
            <code className="rounded bg-white px-1.5 py-0.5 text-xs">00000000-0000-0000-0000-000000000001</code>
            .
          </p>
          {message && (
            <p className="rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-[#92400E]">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default async function CompanySettingsRoute() {
  const { supabase } = await requirePermission('company_settings', 'view').catch(() => ({ supabase: null }))
  if (!supabase) {
    return <AccessDenied />
  }

  const [settings, departmentsResult] = await Promise.all([
    getCompanySettings().catch((error) => ({ error })),
    supabase
      .from('departments')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
  ])
  if ('error' in settings) {
    return <CompanySettingsUnavailable error={settings.error} />
  }

  const [signatureImageUrl, stampImageUrl] = await Promise.all([
    createSignedImageUrl(supabase, settings.signature_image_path),
    createSignedImageUrl(supabase, settings.stamp_image_path),
  ])

  return (
    <CompanySettingsPage
      settings={settings}
      imageUrls={{
        signature: signatureImageUrl,
        stamp: stampImageUrl,
      }}
      departments={(departmentsResult.data || []) as Array<{ id: string; name: string }>}
    />
  )
}
