import { AccessDenied } from '@/components/ui/AccessDenied'
import { CompanySettingsPage } from '@/components/features/settings/CompanySettingsPage'
import { getCompanySettings } from '@/lib/actions/company-settings'
import { requirePermission } from '@/lib/permissions/server'
import type { CurrentUserContext } from '@/lib/auth/current-user'

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

export default async function CompanySettingsRoute() {
  const { supabase } = await requirePermission('company_settings', 'view').catch(() => ({ supabase: null }))
  if (!supabase) {
    return <AccessDenied />
  }

  const settings = await getCompanySettings()
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
    />
  )
}
