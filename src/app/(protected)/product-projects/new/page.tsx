import Link from 'next/link'
import { ProductProjectForm } from '@/components/features/products/ProductProjectForm'
import { getEngineerOptions } from '@/lib/actions/products'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'
import type { Client } from '@/lib/types'
import { getOwnedMailLinkPreview } from '@/lib/actions/mail'
import type { MailLinkInput } from '@/lib/mail/types'
import { ArrowLeft, Sparkles } from 'lucide-react'

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
    <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Проекты продукции</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Новый проект изделия</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Зафиксируйте требования и назначьте инженера. Задача и дальнейшие статусы создадутся автоматически.
            </p>
          </div>
        </div>
        <Link href={ROUTES.PRODUCT_PROJECTS} className={buttonVariants({ variant: 'outline', className: 'min-h-11 shrink-0' })}>
          <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
          К проектам
        </Link>
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
