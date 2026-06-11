'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FilePlus2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createRequest } from '@/lib/actions/technologist-requests'

export function CreateRequestPanel({ machineId, canCreate }: { machineId: string; canCreate: boolean }) {
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      const result = await createRequest(machineId)
      if (!result.success) throw new Error(result.error || 'Не удалось создать заявку')
      toast.success('Заявка создана')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать заявку')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <FilePlus2 className="mx-auto h-10 w-10 text-slate-400" />
      <h1 className="mt-4 text-2xl font-bold text-[#1B3A6B]">Заявка на материалы ещё не создана</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
        Создайте черновик заявки, чтобы технолог мог заполнить материалы, а начальники участков проверили остатки.
      </p>
      {canCreate && (
        <Button className="mt-5" onClick={handleCreate} disabled={isCreating}>
          Создать заявку на материалы
        </Button>
      )}
    </div>
  )
}
