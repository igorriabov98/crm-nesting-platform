'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { deleteMachine } from '@/app/(protected)/sales-plan/actions'
import type { MachineDetails, MachineListItem } from '@/lib/types'

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

interface MachineDeleteDialogProps {
  machine: Pick<MachineDetails | MachineListItem, 'id' | 'name'>
  isOpen: boolean
  onClose: () => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export function MachineDeleteDialog({ machine, isOpen, onClose }: MachineDeleteDialogProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setIsDeleting(true)
    try {
      const res = await deleteMachine(machine.id)
      if (!res.success) throw new Error(res.error || 'Не удалось удалить машину')
      
      toast.success('Машина и все её связанные данные успешно удалены')
      onClose()
      router.refresh()
    } catch (e: unknown) {
      toast.error(getErrorMessage(e))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="bg-white border-[#E8ECF0] text-[#1B3A6B]">
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить машину: {machine.name}?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#6B7280]">
            Будут безвозвратно удалены все <strong>этапы производства</strong>, <strong>позиции снабжения</strong> и привязанный <strong>инвойс</strong>. Это деструктивное действие нельзя отменить!
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
            {isDeleting ? 'Удаление...' : 'Да, удалить всё'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
