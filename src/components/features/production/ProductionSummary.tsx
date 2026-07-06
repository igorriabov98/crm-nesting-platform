"use client"

import React from 'react'
import { Factory, PlayCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { ProductionRow } from '@/app/(protected)/production/actions'

interface ProductionSummaryProps {
  data: ProductionRow[]
}

export function ProductionSummary({ data }: ProductionSummaryProps) {
  const totalMachines = data.length
  let activeStages = 0
  let completedStages = 0
  let overdueStages = 0

  data.forEach((row) => {
    row.stages.forEach((s) => {
      if (s.status === 'active') activeStages++
      if (s.status === 'completed') completedStages++
      if (s.status === 'overdue') overdueStages++
    })
  })

  const cards = [
    { label: 'Всего машин', value: totalMachines, icon: Factory, color: 'text-[#2563EB]', bg: 'bg-blue-500/10 border-blue-500/20' },
    { label: 'В работе этапов', value: activeStages, icon: PlayCircle, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
    { label: 'Завершено этапов', value: completedStages, icon: CheckCircle2, color: 'text-[#16A34A]', bg: 'bg-green-500/10 border-green-500/20' },
    { label: 'Просрочено', value: overdueStages, icon: AlertTriangle, color: 'text-[#DC2626]', bg: 'bg-red-500/10 border-red-500/20' },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`flex min-h-20 items-center gap-3 rounded-lg border px-3 py-2.5 ${c.bg}`}>
          <c.icon className={`h-6 w-6 shrink-0 ${c.color}`} />
          <div className="min-w-0">
            <p className="text-xl font-bold leading-tight text-[#1B3A6B]">{c.value}</p>
            <p className="truncate text-xs text-[#6B7280]">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
