"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClientCreateDialog } from './ClientCreateDialog'

export function ClientPageHeader() {
  const router = useRouter()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Клиенты</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Компании, их машины, актуальные инвойсы и просрочки.
        </p>
      </div>

      <Button type="button" onClick={() => setIsCreateOpen(true)} className="w-full sm:w-auto">
        <Plus className="h-4 w-4" />
        Новый клиент
      </Button>

      <ClientCreateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreated={() => router.refresh()}
      />
    </div>
  )
}
