export type PlanningDashboardFactory = {
  id: string
  name: string
}
export type PlanningPersonalItem = {
  id: string
  kind: 'task' | 'request'
  title: string
  status: 'pending' | 'in_progress'
  deadline: string | null
  machineName: string | null
  href: string
}

export type PlanningTonnageMetric = {
  plan: number
  fact: number
  percent: number | null
  deviation: number
}

export type PlanningAssemblyTonnage = {
  month: string
  monthMetric: PlanningTonnageMetric
  todayMetric: PlanningTonnageMetric
}

export type PlanningOverdueShipment = {
  id: string
  name: string
  specification: string | null
  clientName: string | null
  weightTons: number
  desiredShippingDate: string
  overdueDays: number
  href: string
}

export type PlanningTodayOrder = {
  id: string
  name: string
  plannedKg: number
  href: string
}

export type PlanningTodaySection = {
  id: string
  name: string
  parentName: string
  orders: PlanningTodayOrder[]
}

export type PlanningSupplyRiskCategory =
  | 'materials'
  | 'detailing'
  | 'consumables'
  | 'transfers'
  | 'outsourcing'
  | 'transport'
  | 'other'

export type PlanningSupplyRisk = {
  id: string
  category: PlanningSupplyRiskCategory
  title: string
  context: string | null
  dueDate: string | null
  remainingQuantity: number | null
  unit: string | null
  overdueDays: number | null
  href: string
}

export type PlanningSupplyRisks = {
  overdue: PlanningSupplyRisk[]
  undated: PlanningSupplyRisk[]
  overdueCount: number
  undatedCount: number
}

export type PlanningDirectorDashboardData = {
  personalItems: PlanningPersonalItem[]
  personalItemsCount: number
  assemblyTonnage: PlanningAssemblyTonnage
  overdueShipments: PlanningOverdueShipment[]
  overdueShipmentsCount: number
  todaySections: PlanningTodaySection[]
  supplyRisks: PlanningSupplyRisks
  updatedAt: string
}
