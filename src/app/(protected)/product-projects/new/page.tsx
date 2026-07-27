import Link from 'next/link'
import { ProductProjectForm } from '@/components/features/products/ProductProjectForm'
import { getEngineerOptions } from '@/lib/actions/products'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'
import type { Client } from '@/lib/types'
import { getOwnedMailLinkPreview } from '@/lib/actions/mail'
import type { MailLinkInput } from '@/lib/mail/types'

export const metadata = {
  title: 'Новый проект изделия — CRM Завода',
}

export default async function NewProductProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ mailKind?: string; mailId?: string }>
}) {
  const { supabase } = await getCurrentUserContextOrRedirect()
  const query = await searchParams
  const requestedMailLink = query.mailId && (query.mailKind === 'thread' || query.mailKind === 'message')
    ? { kind: query.mailKind, id: query.mailId } satisfies MailLinkInput
    : null
  const [{ data: clients }, { data: engineers, error: engineersError }, initialMailLink] = await Promise.all([
    supabase.from('clients').select('id, name').order('name'),
    getEngineerOptions(),
    requestedMailLink ? getOwnedMailLinkPreview(requestedMailLink).catch(() => null) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Новый проект изделия</h1>
          <p className="text-sm text-[#6B7280]">Для нового изделия менеджер выбирает инженера и фиксирует требования клиента.</p>
        </div>
        <Link href={ROUTES.PRODUCT_PROJECTS} className={buttonVariants({ variant: 'outline' })}>Назад</Link>
      </div>
      {engineersError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{engineersError}</div>
      ) : (
        <ProductProjectForm
          clients={(clients || []) as Pick<Client, 'id' | 'name'>[]}
          engineers={engineers || []}
          initialMailLink={initialMailLink}
        />
      )}
    </div>
  )
}
