'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { archiveMachine } from '@/app/(protected)/sales-plan/actions'
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

interface MachineArchiveDialogProps {
  machine: Pick<MachineDetails | MachineListItem, 'id' | 'name'>
  isOpen: boolean
  onClose: () => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export function MachineArchiveDialog({ machine, isOpen, onClose }: MachineArchiveDialogProps) {
  const router = useRouter()
  const [isArchiving, setIsArchiving] = useState(false)

  async function handleArchive() {
    setIsArchiving(true)
    try {
      const res = await archiveMachine(machine.id)
      if (!res.success) throw new Error(res.error || 'Не удалось архивировать машину')

      toast.success('Машина архивирована. Активные задачи по ней отменены.')
      onClose()
      router.refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="bg-white border-[#E8ECF0] text-[#1B3A6B]">
        <AlertDialogHeader>
          <AlertDialogTitle>Архивировать машину: {machine.name}?</AlertDialogTitle>
          <AlertDialogDescription className="text-[#6B7280]">
            Машина останется в базе и исторических данных для аналитики, но будет скрыта из активного плана. Активные задачи по ней будут отменены, а дальнейшие действия с машиной будут заблокированы.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isArchiving}
            className="bg-transparent border-[#E8ECF0] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]"
          >
            Отмена
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleArchive}
            disabled={isArchiving}
            className={buttonVariants({ variant: 'default', className: 'bg-[#1B3A6B] text-white hover:bg-[#152D54]' })}
          >
            {isArchiving ? 'Архивирование...' : 'Архивировать'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
