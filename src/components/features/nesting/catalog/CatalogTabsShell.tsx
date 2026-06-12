'use client'

import type React from 'react'
import { useRouter } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type CatalogTab = 'sheets' | 'gaps' | 'kfactors' | 'remnants'

const catalogTabs: Array<{ value: CatalogTab; label: string }> = [
  { value: 'sheets', label: 'Листы' },
  { value: 'gaps', label: 'Перемычки' },
  { value: 'kfactors', label: 'K-факторы' },
  { value: 'remnants', label: 'Остатки' },
]

function isCatalogTab(value: string): value is CatalogTab {
  return catalogTabs.some((tab) => tab.value === value)
}

export function CatalogTabsShell({
  activeTab,
  children,
}: {
  activeTab: CatalogTab
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (typeof value === 'string' && isCatalogTab(value)) {
          router.push(`/nesting/catalog?tab=${value}`)
        }
      }}
      className="space-y-4"
    >
      <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg border border-[#E8ECF0] bg-white p-1">
        {catalogTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="min-w-28">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={activeTab} className="outline-none">
        {children}
      </TabsContent>
    </Tabs>
  )
}
