import Link from 'next/link'
import { Archive, ChevronDown, PackageOpen, Plus } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { ProductProjectListItem } from '@/lib/actions/products'
import { productProjectStatusLabels } from './ProductProjectLifecycle'

function ProjectTable({ projects, emptyMessage }: { projects: ProductProjectListItem[]; emptyMessage: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Проект</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Инженер</th>
              <th className="px-4 py-3 font-medium">Версии</th>
              <th className="px-4 py-3 font-medium">Файлы</th>
              <th className="px-4 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {projects.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{emptyMessage}</td>
              </tr>
            ) : projects.map((project) => (
              <tr key={project.id} className="transition-colors hover:bg-muted/35">
                <td className="px-4 py-3">
                  <Link href={`${ROUTES.PRODUCT_PROJECTS}/${project.id}`} className="font-semibold text-primary hover:underline">
                    {project.title}
                  </Link>
                  <div className="max-w-[360px] truncate text-xs text-muted-foreground">{project.description || 'Описание не заполнено'}</div>
                </td>
                <td className="px-4 py-3 text-foreground/80">{project.client?.name || '—'}</td>
                <td className="px-4 py-3 text-foreground/80">{project.assigned_engineer?.full_name || '—'}</td>
                <td className="px-4 py-3 text-foreground/80">{project.versions?.length || 0}</td>
                <td className="px-4 py-3 text-foreground/80">{project.product_project_files?.length || 0}</td>
                <td className="px-4 py-3">
                  <Badge variant={project.status === 'cancelled' ? 'destructive' : project.status === 'added_to_products' ? 'default' : 'secondary'}>
                    {productProjectStatusLabels[project.status]}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ProductProjectList({ projects }: { projects: ProductProjectListItem[] }) {
  const archivedProjects = projects.filter((project) => project.status === 'added_to_products' || project.status === 'cancelled')
  const activeProjects = projects.filter((project) => project.status !== 'added_to_products' && project.status !== 'cancelled')

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Sales · Разработка изделий</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Проекты продукции</h1>
          <p className="mt-1 text-sm text-muted-foreground">Активная разработка, согласование и автоматический перенос готовых изделий в продукцию.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={ROUTES.PRODUCTS} className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>База продукции</Link>
          <Link href={ROUTES.PRODUCT_PROJECTS_NEW} className={buttonVariants({ className: 'min-h-11' })}>
            <Plus className="mr-2 size-4" />
            Новый проект
          </Link>
        </div>
      </div>

      <section className="space-y-3" aria-labelledby="active-projects-title">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><PackageOpen className="size-4" /></span>
          <div>
            <h2 id="active-projects-title" className="font-semibold text-foreground">В работе</h2>
            <p className="text-xs text-muted-foreground">Активных проектов: {activeProjects.length}</p>
          </div>
        </div>
        <ProjectTable projects={activeProjects} emptyMessage="Активных проектов пока нет." />
      </section>

      <details className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Archive className="size-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-foreground">Архив проектов</span>
            <span className="block text-xs text-muted-foreground">Закрытые и отменённые проекты: {archivedProjects.length}</span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-border p-3">
          <ProjectTable projects={archivedProjects} emptyMessage="Архив пока пуст." />
        </div>
      </details>
    </div>
  )
}
