'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { deleteDepartment } from '@/app/(protected)/admin/settings/departments/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Department } from '@/lib/types/departments'

interface DeleteDepartmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  department: Department
  childCount: number
  onSuccess: () => void
}

export function DeleteDepartmentDialog({
  open,
  onOpenChange,
  department,
  childCount,
  onSuccess,
}: DeleteDepartmentDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const membersCount = department.members_count ?? 0

  useEffect(() => {
    if (open) setError(null)
  }, [department.id, open])

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)

    try {
      const result = await deleteDepartment(department.id)
      if (!result.success) {
        throw new Error(result.error || 'Не удалось удалить отдел')
      }

      toast.success('Отдел удалён')
      onOpenChange(false)
      onSuccess()
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить отдел')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isDeleting) onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить отдел?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#6B7280]">
            Отдел <strong className="text-[#1B3A6B]">{department.name}</strong> будет удалён.
            Это действие нельзя отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {(childCount > 0 || membersCount > 0) && (
          <div className="flex gap-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Удаление невозможно, пока отдел содержит
              {childCount > 0 && ` подотделы (${childCount})`}
              {childCount > 0 && membersCount > 0 && ' и'}
              {membersCount > 0 && ` сотрудников (${membersCount})`}.
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-[#DC2626]">{error}</div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? 'Удаление...' : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
