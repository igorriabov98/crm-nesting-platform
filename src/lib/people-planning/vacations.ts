import type { EmployeeVacation } from '@/lib/types'

export function isVacationActive(vacation: EmployeeVacation) {
  return vacation.cancelled_at === null
}

export function isDateInsideVacation(date: string, vacation: EmployeeVacation) {
  return isVacationActive(vacation)
    && vacation.start_date <= date
    && vacation.end_date >= date
}

export function findEmployeeVacationOnDate(
  vacations: EmployeeVacation[],
  employeeId: string,
  date: string,
) {
  return vacations.find((vacation) => (
    vacation.employee_id === employeeId && isDateInsideVacation(date, vacation)
  )) || null
}

export function vacationDurationDays(vacation: Pick<EmployeeVacation, 'start_date' | 'end_date'>) {
  const start = Date.parse(`${vacation.start_date}T00:00:00Z`)
  const end = Date.parse(`${vacation.end_date}T00:00:00Z`)
  return Math.floor((end - start) / 86_400_000) + 1
}
