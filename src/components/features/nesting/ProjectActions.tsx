'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteNestingProject } from '@/lib/nesting/actions'
import type { NestingProject } from '@/lib/nesting/api'
import { isCompletedNestingStatus } from '@/lib/nesting/status'
import { usePermissions } from '@/components/providers/PermissionProvider'

function getProjectHref(project: NestingProject) {
  return isCompletedNestingStatus(project.status) ? `/nesting/${project.id}/result` : `/nesting/${project.id}/parts`
}

export function ProjectActions({ project }: { project: NestingProject }) {
  const router = useRouter()
  const { can } = usePermissions()
  const canManage = can('nesting', 'manage')

  async function handleDelete() {
    try {
      await deleteNestingProject(project.id)
      toast.success('Проект удалён')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить проект')
    }
  }

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <AlertDialog>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#F4F6F9] hover:text-[#1B3A6B] focus:outline-none">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white">
            <DropdownMenuLabel>Действия</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="p-0">
              <Link className="flex w-full items-center gap-2 px-1.5 py-1" href={getProjectHref(project)}>
                <ExternalLink className="h-4 w-4" />
                Открыть
              </Link>
            </DropdownMenuItem>
            {isCompletedNestingStatus(project.status) ? (
              <DropdownMenuItem className="p-0">
                <a className="flex w-full items-center gap-2 px-1.5 py-1" href={`/api/nesting/dxf/${project.id}`}>
                  <Download className="h-4 w-4" />
                  Скачать DXF
                </a>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <Download className="h-4 w-4" />
                Скачать DXF
              </DropdownMenuItem>
            )}
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <AlertDialogTrigger className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm text-red-600 hover:bg-red-50 focus:outline-none">
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </AlertDialogTrigger>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {canManage && <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить проект {project.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Проект, детали и результаты раскладки будут удалены. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={handleDelete}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>}
      </AlertDialog>
    </div>
  )
}
