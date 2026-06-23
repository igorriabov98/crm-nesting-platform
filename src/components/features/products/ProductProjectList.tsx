import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { ProductProjectListItem } from '@/lib/actions/products'

const statusLabels: Record<ProductProjectListItem['status'], string> = {
  new_project: 'Новый проект',
  draft: 'Черновик',
  engineering: 'Инженер',
  client_review: 'Согласование',
  approved: 'Подтвержден',
  added_to_products: 'В продукции',
  cancelled: 'Отменен',
}

export function ProductProjectList({ projects }: { projects: ProductProjectListItem[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Проекты изделий</h1>
          <p className="text-sm text-[#6B7280]">Новые изделия, которые еще согласовываются с клиентом.</p>
        </div>
        <div className="flex gap-2">
          <Link href={ROUTES.PRODUCTS} className={buttonVariants({ variant: 'outline' })}>База продукции</Link>
          <Link href={ROUTES.PRODUCT_PROJECTS_NEW} className={buttonVariants({ className: 'bg-[#1B3A6B] text-white hover:bg-[#152D54]' })}>
            <Plus className="mr-2 h-4 w-4" />
            Новый проект
          </Link>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="px-4 py-3">Проект</th>
                <th className="px-4 py-3">Клиент</th>
                <th className="px-4 py-3">Инженер</th>
                <th className="px-4 py-3">Версии</th>
                <th className="px-4 py-3">Файлы</th>
                <th className="px-4 py-3">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[#9CA3AF]">Проектов пока нет.</td>
                </tr>
              ) : projects.map((project) => (
                <tr key={project.id} className="hover:bg-[#F8F9FA]">
                  <td className="px-4 py-3">
                    <Link href={`${ROUTES.PRODUCT_PROJECTS}/${project.id}`} className="font-semibold text-[#2563EB] hover:underline">
                      {project.title}
                    </Link>
                    <div className="max-w-[360px] truncate text-xs text-[#9CA3AF]">{project.description || 'Описание не заполнено'}</div>
                  </td>
                  <td className="px-4 py-3 text-[#374151]">{project.client?.name || '—'}</td>
                  <td className="px-4 py-3 text-[#374151]">{project.assigned_engineer?.full_name || '—'}</td>
                  <td className="px-4 py-3 text-[#374151]">{project.versions?.length || 0}</td>
                  <td className="px-4 py-3 text-[#374151]">{project.product_project_files?.length || 0}</td>
                  <td className="px-4 py-3">
                    <Badge variant={project.status === 'cancelled' ? 'destructive' : project.status === 'added_to_products' ? 'default' : 'secondary'}>
                      {statusLabels[project.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
