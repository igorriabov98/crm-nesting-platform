import type { Employee, EmployeeAssignment, EmployeeRate } from '@/lib/types'
import { buildPeoplePlanningStageProgress } from '@/lib/people-planning/presentation'
import type { PeoplePlanningPeriod, PeoplePlanningWorkspace } from '@/lib/people-planning/types'

function assignmentOrder(left: EmployeeAssignment, right: EmployeeAssignment) {
  return left.work_date.localeCompare(right.work_date)
    || left.half - right.half
    || left.employee_id.localeCompare(right.employee_id)
}

export function applyPeoplePlanningPeriod(
  workspace: PeoplePlanningWorkspace,
  period: PeoplePlanningPeriod,
): PeoplePlanningWorkspace {
  return { ...workspace, ...period }
}

export function applyPeoplePlanningAssignmentChanges(
  workspace: PeoplePlanningWorkspace,
  changes: EmployeeAssignment[],
): PeoplePlanningWorkspace {
  if (changes.length === 0) return workspace

  const changedIds = new Set(changes.map((assignment) => assignment.id))
  const visibleDates = new Set(workspace.dates)
  const visibleMachineIds = new Set(workspace.machines.map((machine) => machine.id))
  const activeChanges = changes.filter((assignment) => !assignment.cancelled_at)

  const assignments = [
    ...workspace.assignments.filter((assignment) => !changedIds.has(assignment.id)),
    ...activeChanges.filter((assignment) => visibleDates.has(assignment.work_date)),
  ].sort(assignmentOrder)

  const planningAssignments = [
    ...workspace.planningAssignments.filter((assignment) => !changedIds.has(assignment.id)),
    ...activeChanges.filter((assignment) => visibleMachineIds.has(assignment.machine_id)),
  ].sort(assignmentOrder)

  const machines = workspace.machines.map((machine) => ({
    ...machine,
    stages: buildPeoplePlanningStageProgress(
      machine.id,
      machine.totalWeightKg,
      workspace.sections,
      planningAssignments,
    ),
  }))

  return { ...workspace, assignments, planningAssignments, machines }
}

export function applyPeoplePlanningEmployeeChange(
  workspace: PeoplePlanningWorkspace,
  employee: Employee,
): PeoplePlanningWorkspace {
  const employees = workspace.employees.some((row) => row.id === employee.id)
    ? workspace.employees.map((row) => row.id === employee.id ? employee : row)
    : [...workspace.employees, employee]
  return { ...workspace, employees }
}

export function applyPeoplePlanningRateChange(
  workspace: PeoplePlanningWorkspace,
  rate: EmployeeRate,
): PeoplePlanningWorkspace {
  const rates = workspace.rates.some((row) => row.id === rate.id)
    ? workspace.rates.map((row) => row.id === rate.id ? rate : row)
    : [...workspace.rates, rate]
  return { ...workspace, rates }
}
