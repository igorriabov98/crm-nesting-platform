'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import type { MachineEditDialogProps } from './MachineEditDialog'

const MachineEditDialog = dynamic(
  () => import('./MachineEditDialog').then((module) => module.MachineEditDialog),
  {
    loading: () => (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 backdrop-blur-[1px]"
        role="status"
        aria-live="polite"
      >
        <div className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 font-medium text-slate-700 shadow-xl">
          <Loader2 className="h-5 w-5 animate-spin text-blue-900" aria-hidden="true" />
          Загрузка редактора…
        </div>
      </div>
    ),
  },
)

export function LazyMachineEditDialog(props: MachineEditDialogProps) {
  return <MachineEditDialog {...props} />
}
