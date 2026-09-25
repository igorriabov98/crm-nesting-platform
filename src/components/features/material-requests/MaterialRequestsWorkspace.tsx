'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MaterialRequestQueue } from './MaterialRequestQueue'
import { StockMaterialRequestQueue, type StockQueueItem } from './StockMaterialRequestQueue'
import type { MaterialRequestQueueItem } from '@/lib/types/material-request-queue'

export function MaterialRequestsWorkspace({ items, canViewAll, stockItems, factories, canCreateStock }: {
  items: MaterialRequestQueueItem[]
  canViewAll: boolean
  stockItems: StockQueueItem[]
  factories: Array<{ id: string; name: string }>
  canCreateStock: boolean
}) {
  return <Tabs defaultValue="machines" className="space-y-6">
    <TabsList className="h-auto border bg-white p-1">
      <TabsTrigger value="machines">По заказам</TabsTrigger>
      <TabsTrigger value="stock">На склад</TabsTrigger>
    </TabsList>
    <TabsContent value="machines"><MaterialRequestQueue items={items} canViewAll={canViewAll} /></TabsContent>
    <TabsContent value="stock"><StockMaterialRequestQueue items={stockItems} factories={factories} canCreate={canCreateStock} /></TabsContent>
  </Tabs>
}
