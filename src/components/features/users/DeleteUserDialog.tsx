'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { deleteUser } from '@/app/(protected)/admin/users/actions'
import type { CurrentUser } from '@/lib/types'

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
import { buttonVariants } from '@/components/ui/button'

interface DeleteUserDialogProps {
  user: CurrentUser
  isOpen: boolean
  onClose: () => void
}

export function DeleteUserDialog({ user, isOpen, onClose }: DeleteUserDialogProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    try {
      const res = await deleteUser(user.id)
      if (!res.success) throw new Error(res.error || 'Не удалось удалить пользователя')
      
      toast.success('Пользователь успешно удален')
      onClose()
      router.refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось удалить пользователя')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="bg-white border-[#E8ECF0] text-[#1B3A6B]">
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#6B7280]">
            Вы уверены, что хотите безвозвратно удалить <strong>{user.full_name}</strong> ({user.email})?
            Это действие нельзя отменить, и пользователь потеряет весь доступ к CRM.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel 
            disabled={isDeleting}
            className="bg-transparent border-[#E8ECF0] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]"
          >
            Отмена
          </AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleDelete}
            disabled={isDeleting}
            className={buttonVariants({ variant: 'destructive', className: 'hover:bg-red-700' })}
          >
            {isDeleting ? 'Удаление...' : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
