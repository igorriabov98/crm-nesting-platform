'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/features/nesting/StatusBadge'
import { ProjectActions } from '@/components/features/nesting/ProjectActions'
import { cn } from '@/lib/utils'
import type { NestingProject } from '@/lib/nesting/api'

function getProjectHref(project: NestingProject) {
  return project.status === 'done' ? `/nesting/${project.id}/result` : `/nesting/${project.id}/parts`
}

function formatDate(value: string) {
  try {
    return format(new Date(value), 'dd.MM.yyyy', { locale: ru })
  } catch {
    return '—'
  }
}

function Utilization({ value }: { value: number | null }) {
  if (value === null || Number.isNaN(value)) {
    return <span className="text-[#9CA3AF]">—</span>
  }

  const color = value > 75 ? 'bg-emerald-500' : value >= 50 ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="flex min-w-[96px] items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-slate-100">
        <div className={cn('h-2 rounded-full', color)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-medium text-[#374151]">{Math.round(value)}%</span>
    </div>
  )
}

export function NestingProjectsTable({
  projects,
  page,
  totalPages,
}: {
  projects: NestingProject[]
  page: number
  totalPages: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function goToPage(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(nextPage))
    router.push(`/nesting?${params.toString()}`)
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-8 text-center">
        <p className="text-sm font-medium text-[#1B3A6B]">Проектов раскладки пока нет</p>
        <p className="mt-1 text-sm text-[#6B7280]">Создайте новую раскладку и загрузите STEP-файл.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F8F9FA]">
              <TableHead>Заказ</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Деталей</TableHead>
              <TableHead className="text-right">Листов</TableHead>
              <TableHead>Утилизация</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow
                key={project.id}
                className="cursor-pointer"
                onClick={() => router.push(getProjectHref(project))}
              >
                <TableCell className="font-medium text-[#1B3A6B]">{project.orderNumber}</TableCell>
                <TableCell className="text-[#6B7280]">{formatDate(project.createdAt)}</TableCell>
                <TableCell><StatusBadge status={project.status} /></TableCell>
                <TableCell className="text-right">{project.partsCount || '—'}</TableCell>
                <TableCell className="text-right">{project.sheetsCount || '—'}</TableCell>
                <TableCell><Utilization value={project.avgUtilization} /></TableCell>
                <TableCell><ProjectActions project={project} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Назад
          </Button>
          <span className="text-sm text-[#6B7280]">Страница {page} из {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
          >
            Вперёд
          </Button>
        </div>
      )}
    </div>
  )
}
