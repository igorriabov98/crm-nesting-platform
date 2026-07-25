import Link from 'next/link'
import { ProductProjectDetailClient } from '@/components/features/products/ProductProjectDetailClient'
import { ProductProjectForm } from '@/components/features/products/ProductProjectForm'
import { getEngineerOptions, getProductProject } from '@/lib/actions/products'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { ROUTES } from '@/lib/constants/routes'
import { buttonVariants } from '@/components/ui/button'
import type { Client } from '@/lib/types'
import { getProductProjectMailThreads } from '@/lib/actions/mail'
import { ProductProjectMail } from '@/components/features/products/ProductProjectMail'

export const metadata = {
  title: 'Проект изделия — CRM Завода',
}

export default async function ProductProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await getCurrentUserContextOrRedirect()
  const [{ data: project, error }, { data: clients }, { data: engineers, error: engineersError }, mailThreads] = await Promise.all([
    getProductProject(id),
    supabase.from('clients').select('id, name').order('name'),
    getEngineerOptions(),
    getProductProjectMailThreads(id),
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
      <ProductProjectDetailClient project={project} />
      <ProductProjectMail projectId={project.id} initialLinks={mailThreads as never[]} />
    </div>
  )
}
