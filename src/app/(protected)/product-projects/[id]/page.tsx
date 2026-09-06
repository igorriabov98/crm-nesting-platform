import Link from 'next/link'
import { ProductProjectDetailClient } from '@/components/features/products/ProductProjectDetailClient'
import { ProductProjectForm } from '@/components/features/products/ProductProjectForm'
import { getEngineerOptions, getProductProject } from '@/lib/actions/products'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'
import type { Client } from '@/lib/types'
import { getOwnedMailLinkPreview, getProductProjectMailLinks } from '@/lib/actions/mail'
import { ProductProjectMail } from '@/components/features/products/ProductProjectMail'
import { getCurrentUserPermissions } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import type { MailLinkInput } from '@/lib/mail/types'

export const metadata = {
  title: 'Проект изделия — CRM Завода',
}

export default async function ProductProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ correctionMailKind?: string; correctionMailId?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const requestedCorrectionMail = query.correctionMailId
    && (query.correctionMailKind === 'thread' || query.correctionMailKind === 'message')
    ? { kind: query.correctionMailKind, id: query.correctionMailId } satisfies MailLinkInput
    : null
  const { supabase, userId } = await getCurrentUserContextOrRedirect()
  const [
    { data: project, error },
    { data: clients },
    { data: engineers, error: engineersError },
    mailLinks,
    permissionDetails,
    initialCorrectionMailLink,
  ] = await Promise.all([
    getProductProject(id),
    supabase.from('clients').select('id, name').order('name'),
    getEngineerOptions(),
    getProductProjectMailLinks(id),
    getCurrentUserPermissions(userId),
    requestedCorrectionMail
      ? getOwnedMailLinkPreview(requestedCorrectionMail).catch(() => null)
      : Promise.resolve(null),
  ])

  if (error || !project) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{error || 'Проект не найден'}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link href={ROUTES.PRODUCT_PROJECTS} className={buttonVariants({ variant: 'outline' })}>Назад к проектам</Link>
      </div>
      {engineersError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{engineersError}</div>
      ) : (
        <ProductProjectForm project={project} clients={(clients || []) as Pick<Client, 'id' | 'name'>[]} engineers={engineers || []} />
      )}
      <ProductProjectDetailClient
        key={`${project.id}:${requestedCorrectionMail?.kind || ''}:${requestedCorrectionMail?.id || ''}`}
        project={project}
        mailLinks={mailLinks}
        initialCorrectionMailLink={initialCorrectionMailLink}
        canManage={hasPermission(permissionDetails.permissions, 'product_projects', 'manage')}
      />
      <ProductProjectMail
        projectId={project.id}
        initialLinks={mailLinks.filter((link) => link.version_id === null)}
        canManage={hasPermission(permissionDetails.permissions, 'product_projects', 'manage')}
      />
    </div>
  )
}
