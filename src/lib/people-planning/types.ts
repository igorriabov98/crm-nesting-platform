import type {
  Employee,
  EmployeeAssignment,
  EmployeeRate,
  FactorySummary,
  ProductionFactSection,
} from '@/lib/types'

export type PeoplePlanningView = 'day' | 'week'

export type PeoplePlanningStageProgress = {
  sectionId: string
  sectionName: string
  parentName: string
  displayName: string
  confirmedKg: number
  pendingKg: number
  progressPercent: number
  remainingKg: number
  remainingPercent: number
}

export type PeoplePlanningMachine = {
  id: string
  name: string
  factoryId: string
  totalWeightKg: number
  productionMonth: string | null
  productionWorkshop: number | null
  queueNumber: number | null
  createdAt: string
  stages: PeoplePlanningStageProgress[]
}

export type PeoplePlanningSection = ProductionFactSection & {
  parentName: string
  displayName: string
}

export type PeoplePlanningWorkspace = {
  factories: FactorySummary[]
  selectedFactoryId: string
  selectedDate: string
  selectedMonth: string
  productionMonths: string[]
  view: PeoplePlanningView
  dates: string[]
  sections: PeoplePlanningSection[]
  employees: Employee[]
  rates: EmployeeRate[]
  assignments: EmployeeAssignment[]
  machines: PeoplePlanningMachine[]
  isDirector: boolean
}

export type PeoplePlanningActionResult<T = undefined> = {
  success: boolean
  data?: T
  error: string | null
}
