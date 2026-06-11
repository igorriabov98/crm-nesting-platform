import { notFound } from 'next/navigation'

import { getSupplyByMachine } from '../actions'
import { SupplyMachineDetail } from '@/components/features/supply/SupplyMachineDetail'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const metadata = { title: 'Детали снабжения машины — CRM Завода' }

export default async function SupplyMachinePage({ params }: { params: Promise<{ machineId: string }> }) {
  const { machineId } = await params
  let data
  let user

  try {
    const supabase = await createServerSupabaseClient()
    const [supplyData, authResult] = await Promise.all([
      getSupplyByMachine(machineId),
      supabase.auth.getUser(),
    ])
    data = supplyData
    user = authResult.data.user
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Неизвестная ошибка'
    if (message === 'Машина не найдена') notFound()
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Ошибка</h1>
        <p className="text-[#DC2626]">{message}</p>
      </div>
    )
  }

  return <SupplyMachineDetail data={{ ...data, currentUser: user }} />
}
