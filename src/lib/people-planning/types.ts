import type {
  Employee,
  EmployeeAssignment,
  EmployeeRate,
  FactorySummary,
  ProductionFactSection,
} from '@/lib/types'

export type PeoplePlanningView = 'day' | 'week'

export type PeoplePlanningMachine = {
  id: string
  name: string
  factoryId: string
  totalWeightKg: number
  confirmedKg: number
  progressPercent: number
  productionMonth: string | null
  queueNumber: number | null
}

export type PeoplePlanningSection = ProductionFactSection & {
  parentName: string
  displayName: string
}

export type PeoplePlanningWorkspace = {
  factories: FactorySummary[]
  selectedFactoryId: string
  selectedDate: string
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
