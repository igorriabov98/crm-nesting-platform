'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { deletePosition } from '@/app/(protected)/admin/settings/departments/actions'
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
import type { Position } from '@/lib/types/departments'

interface DeletePositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: Position
  onSuccess: () => void
}

export function DeletePositionDialog({
  open,
  onOpenChange,
  position,
  onSuccess,
}: DeletePositionDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open, position.id])

  async function handleDelete() {
    setIsDeleting(true)
    setError(null)

    try {
      const result = await deletePosition(position.id)
      if (!result.success) {
        throw new Error(result.error || 'Не удалось удалить должность')
      }

      toast.success('Должность удалена')
      onOpenChange(false)
      onSuccess()
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить должность')
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
          <AlertDialogTitle>Удалить должность?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#6B7280]">
            Должность <strong className="text-[#1B3A6B]">{position.name}</strong> будет удалена.
            Это действие нельзя отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <div className="rounded-lg bg-red-500/10 p-3 text-sm text-[#DC2626]">
            {error}
          </div>
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
