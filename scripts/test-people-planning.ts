import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { calculateRequiredHalfDays, planningSlot, slotToPlanningDate } from '../src/lib/people-planning/slots'
import {
  buildPeoplePlanningStageProgress,
  comparePeoplePlanningMachines,
  comparePeoplePlanningSections,
} from '../src/lib/people-planning/presentation'
import { applyPeoplePlanningAssignmentChanges } from '../src/lib/people-planning/state'
import { findEmployeeVacationOnDate, vacationDurationDays } from '../src/lib/people-planning/vacations'
import type { EmployeeAssignment, EmployeeVacation } from '../src/lib/types'
import type { PeoplePlanningMachine, PeoplePlanningSection, PeoplePlanningWorkspace } from '../src/lib/people-planning/types'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const migration = read('supabase/migrations/20260720095019_people_planning_v1.sql')
const correctionsMigration = read('supabase/migrations/20260720131352_people_planning_stage_progress.sql')
const exactAssignmentsMigration = read('supabase/migrations/20260720143938_people_planning_exact_assignments.sql')
const performanceMigration = read('supabase/migrations/20260720154447_people_planning_fast_period_and_day_cancel.sql')
const vacationsMigration = read('supabase/migrations/20260721122405_production_employee_vacations.sql')
const actions = read('src/lib/actions/people-planning.ts')
const board = read('src/components/features/production/PeoplePlanningBoard.tsx')
const workspaceRoute = read('src/app/api/production/people/workspace/route.ts')
const state = read('src/lib/people-planning/state.ts')
const workOrder = read('src/lib/pdf/PeopleWorkOrderDocument.tsx')
const databaseTypes = read('src/lib/types/database.ts')
const sidebar = read('src/components/layout/Sidebar.tsx')
const workersPage = read('src/components/features/production/WorkersWorkspace.tsx')
const resources = read('src/lib/permissions/resources.ts')

for (const table of ['employees', 'employee_rates', 'employee_assignments']) {
  assert.match(migration, new RegExp(`CREATE TABLE public\\.${table} \\(`), `${table} table is missing`)
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} RLS is missing`)
  assert.match(migration, new RegExp(`CREATE POLICY ${table}_(?:select|insert|update)`), `${table} policies are missing`)
  assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`), `${table} explicit privilege reset is missing`)
}

for (const existingTable of ['machines', 'production_stages', 'production_month_plans', 'production_fact_sections', 'production_machine_facts', 'production_tonnage_facts']) {
  assert.doesNotMatch(migration, new RegExp(`ALTER TABLE public\\.${existingTable}\\b`, 'i'), `${existingTable} must not be altered`)
  assert.doesNotMatch(migration, new RegExp(`CREATE TRIGGER[\\s\\S]{0,200}ON public\\.${existingTable}\\b`, 'i'), `${existingTable} must not receive triggers`)
}

assert.match(migration, /REFERENCES public\.machines\(id\)/)
assert.match(migration, /REFERENCES public\.production_fact_sections\(id\)/)
assert.match(migration, /employee_assignments_employee_slot_unique UNIQUE \(employee_id, work_date, half\)/)
assert.match(migration, /Employee, machine and section must belong to the same factory/)
assert.match(migration, /parent_id IS NOT NULL/)
assert.match(migration, /total_weight \* 1000/)
assert.match(migration, /status = 'confirmed'/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.employees, public\.employee_rates, public\.employee_assignments TO authenticated/)
assert.doesNotMatch(actions, /production_tonnage_facts/)
assert.doesNotMatch(actions, /getMachine\(/)
assert.match(board, /Сотрудники и ставки/)
assert.match(board, /Первая половина/)
assert.match(board, /Вторая половина/)
assert.match(board, /Занят на другом участке/)
assert.match(board, /Скопировать вчерашний день/)
assert.match(board, /Машины месяца/)
assert.match(board, /Осталось/)
assert.match(board, /Весь день/)
assert.match(board, /scheduleSlotLocked/)
assert.match(board, /scheduleEmployeeFullDayAction/)
assert.match(board, /Назначение сохраняется сразу и только в выбранную клетку/)
assert.match(workOrder, /orientation="landscape"/)
for (const table of ['employees', 'employee_rates', 'employee_assignments']) {
  assert.match(databaseTypes, new RegExp(`${table}:`), `${table} database type is missing`)
}

assert.equal(calculateRequiredHalfDays(1000, 400), 5)
assert.equal(calculateRequiredHalfDays(0, 400), 0)
const slot = planningSlot('2030-01-07', 2)
assert.deepEqual(slotToPlanningDate(slot), { workDate: '2030-01-07', half: 2 })
assert.deepEqual(slotToPlanningDate(slot + 1), { workDate: '2030-01-08', half: 1 })

assert.match(correctionsMigration, /WHERE machine_id = p_machine_id\s+AND section_id = p_section_id\s+AND status = 'confirmed'/)
assert.match(correctionsMigration, /Machine section already has pending people planning suggestions/)
assert.match(correctionsMigration, /CREATE FUNCTION public\.fn_people_copy_previous_day/)
assert.match(correctionsMigration, /ON CONFLICT ON CONSTRAINT employee_assignments_employee_slot_unique/)
assert.match(correctionsMigration, /v_source_count <> 2/)
assert.match(correctionsMigration, /REVOKE ALL ON FUNCTION public\.fn_people_copy_previous_day\(uuid, date\) FROM PUBLIC, anon/)
assert.match(correctionsMigration, /GRANT EXECUTE ON FUNCTION public\.fn_people_copy_previous_day\(uuid, date\) TO authenticated/)
assert.match(databaseTypes, /fn_people_copy_previous_day:/)
assert.match(databaseTypes, /cancelled_at: string \| null/)
assert.match(databaseTypes, /fn_people_schedule_full_day:/)
for (const existingTable of ['machines', 'production_stages', 'production_month_plans', 'production_fact_sections', 'production_machine_facts', 'production_tonnage_facts']) {
  assert.doesNotMatch(correctionsMigration, new RegExp(`ALTER TABLE public\\.${existingTable}\\b`, 'i'), `${existingTable} must not be altered by corrections`)
  assert.doesNotMatch(exactAssignmentsMigration, new RegExp(`ALTER TABLE public\\.${existingTable}\\b`, 'i'), `${existingTable} must not be altered by exact assignments`)
}

assert.match(exactAssignmentsMigration, /ADD COLUMN cancelled_at timestamptz/)
assert.match(exactAssignmentsMigration, /WHERE status = 'pending'::public\.employee_assignment_status\s+AND cancelled_at IS NULL/)
assert.doesNotMatch(exactAssignmentsMigration, /DELETE FROM public\.employee_assignments/)
assert.match(exactAssignmentsMigration, /Employee already assigned in selected half-day/)
assert.match(exactAssignmentsMigration, /p_start_date,\s+p_start_half,\s+'confirmed'/)
assert.doesNotMatch(exactAssignmentsMigration, /FOR v_slot IN/)
assert.match(exactAssignmentsMigration, /CREATE FUNCTION public\.fn_people_schedule_full_day/)
assert.match(exactAssignmentsMigration, /REVOKE ALL ON FUNCTION public\.fn_people_schedule_full_day\(uuid, uuid, uuid, date\) FROM PUBLIC, anon/)
assert.match(exactAssignmentsMigration, /GRANT EXECUTE ON FUNCTION public\.fn_people_schedule_full_day\(uuid, uuid, uuid, date\) TO authenticated/)
assert.match(exactAssignmentsMigration, /source\.cancelled_at IS NULL/)
assert.match(actions, /export async function scheduleEmployeeFullDayAction/)
assert.match(actions, /\.is\('cancelled_at', null\)/)

assert.match(performanceMigration, /CREATE FUNCTION public\.fn_people_planning_period/)
assert.match(performanceMigration, /CREATE FUNCTION public\.fn_people_cancel_employee_day/)
assert.match(performanceMigration, /SECURITY INVOKER/g)
assert.match(performanceMigration, /SET cancelled_at = now\(\)/)
assert.match(performanceMigration, /pg_advisory_xact_lock/)
assert.match(performanceMigration, /OLD\.cancelled_at IS NULL[\s\S]*NEW\.cancelled_at IS NOT NULL/)
assert.doesNotMatch(performanceMigration, /DELETE FROM public\.employee_assignments/)
assert.match(performanceMigration, /REVOKE ALL ON FUNCTION public\.fn_people_planning_period\(uuid, date, date\) FROM PUBLIC, anon/)
assert.match(performanceMigration, /GRANT EXECUTE ON FUNCTION public\.fn_people_cancel_employee_day\(uuid, date\) TO authenticated/)
assert.match(actions, /export async function cancelEmployeeDayAction/)
assert.doesNotMatch(actions, /revalidatePath/)
assert.doesNotMatch(board, /router\.refresh/)
assert.doesNotMatch(board, /useRouter/)
assert.match(board, /window\.history\.pushState/)
assert.match(board, /periodCache/)
assert.match(board, /Очистить назначения за день/)
assert.match(board, /applyPeoplePlanningAssignmentChanges/)
assert.match(workspaceRoute, /params\.get\('scope'\) === 'period'/)
assert.match(workspaceRoute, /private, no-store/)
assert.match(state, /buildPeoplePlanningStageProgress/)
assert.match(databaseTypes, /fn_people_planning_period:/)
assert.match(databaseTypes, /fn_people_cancel_employee_day:/)

assert.match(vacationsMigration, /CREATE TABLE public\.employee_vacations \(/)
assert.match(vacationsMigration, /ALTER TABLE public\.employee_vacations ENABLE ROW LEVEL SECURITY/)
assert.match(vacationsMigration, /CREATE POLICY employee_vacations_select/)
assert.match(vacationsMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.employee_vacations TO authenticated/)
assert.doesNotMatch(vacationsMigration, /GRANT[^;]*DELETE[^;]*employee_vacations/i)
assert.doesNotMatch(vacationsMigration, /DELETE FROM public\.employee_vacations/)
assert.match(vacationsMigration, /Employee is on vacation for selected date/)
assert.match(vacationsMigration, /Employee has assignments in vacation period/)
assert.match(vacationsMigration, /people-employee-availability:/)
assert.match(vacationsMigration, /CREATE FUNCTION public\.fn_people_vacations_period/)
assert.match(vacationsMigration, /SECURITY INVOKER/)
assert.match(vacationsMigration, /REVOKE ALL ON FUNCTION public\.fn_people_vacations_period\(uuid, date, date\) FROM PUBLIC, anon/)
assert.match(databaseTypes, /employee_vacations:/)
assert.match(databaseTypes, /fn_people_vacations_period:/)
assert.match(actions, /export async function getWorkersWorkspace/)
assert.match(actions, /export async function saveEmployeeVacationAction/)
assert.match(actions, /export async function cancelEmployeeVacationAction/)
assert.match(board, /findEmployeeVacationOnDate/)
assert.match(board, /Нагрузка недоступна/)
assert.match(sidebar, /label: 'Работники'/)
assert.match(resources, /ROUTES\.PRODUCTION_WORKERS/)
assert.match(workersPage, /График отпусков/)
assert.match(workersPage, /Нормы выработки/)
assert.match(workersPage, /SelectValue placeholder=\{placeholder\}>\{selectedLabel\}/)

const sections = [
  { id: 'cleanup', name: 'Зачистка', parentName: 'Зачистка', displayName: 'Зачистка · Зачистка', production_stage_type: null, sort_order: 10 },
  { id: 'assembly', name: 'Цех 1', parentName: 'Сборка/Сварка', displayName: 'Сборка/Сварка · Цех 1', production_stage_type: null, sort_order: 10 },
  { id: 'cutting', name: 'Заготовка', parentName: 'Заготовка', displayName: 'Заготовка · Заготовка', production_stage_type: 'cutting', sort_order: 10 },
] as unknown as PeoplePlanningSection[]
assert.deepEqual([...sections].sort(comparePeoplePlanningSections).map((section) => section.id), ['cutting', 'assembly', 'cleanup'])

const stageProgress = buildPeoplePlanningStageProgress('machine-1', 1000, sections, [
  { machine_id: 'machine-1', section_id: 'cutting', status: 'confirmed', kg_planned: 250 },
  { machine_id: 'machine-1', section_id: 'cutting', status: 'pending', kg_planned: 125 },
  { machine_id: 'machine-1', section_id: 'cleanup', status: 'confirmed', kg_planned: 100 },
])
assert.equal(stageProgress.find((stage) => stage.sectionId === 'cutting')?.progressPercent, 25)
assert.equal(stageProgress.find((stage) => stage.sectionId === 'cutting')?.remainingPercent, 75)
assert.equal(stageProgress.find((stage) => stage.sectionId === 'cutting')?.pendingKg, 125)
assert.equal(stageProgress.find((stage) => stage.sectionId === 'cleanup')?.progressPercent, 10)

const assignment = {
  id: 'assignment-1',
  employee_id: 'employee-1',
  machine_id: 'machine-1',
  section_id: 'cutting',
  work_date: '2030-01-07',
  half: 1,
  status: 'confirmed',
  kg_planned: 200,
  created_at: '2030-01-01T00:00:00Z',
  created_by: null,
  updated_at: '2030-01-01T00:00:00Z',
  updated_by: null,
  cancelled_at: null,
} as EmployeeAssignment
const workspace = {
  factories: [],
  selectedFactoryId: 'factory-1',
  selectedDate: '2030-01-07',
  selectedMonth: '2030-01-01',
  productionMonths: ['2030-01-01'],
  view: 'day',
  dates: ['2030-01-07'],
  sections,
  employees: [],
  rates: [],
  vacations: [],
  assignments: [],
  planningAssignments: [],
  machines: [{
    id: 'machine-1',
    name: 'Machine 1',
    factoryId: 'factory-1',
    totalWeightKg: 1000,
    productionMonth: '2030-01-01',
    productionWorkshop: 1,
    queueNumber: 1,
    createdAt: '2030-01-01T00:00:00Z',
    stages: buildPeoplePlanningStageProgress('machine-1', 1000, sections, []),
  }],
  isDirector: true,
} as PeoplePlanningWorkspace
const assignedWorkspace = applyPeoplePlanningAssignmentChanges(workspace, [assignment])
assert.equal(assignedWorkspace.assignments.length, 1)
assert.equal(assignedWorkspace.planningAssignments.length, 1)
assert.equal(assignedWorkspace.machines[0].stages.find((stage) => stage.sectionId === 'cutting')?.progressPercent, 20)
const clearedWorkspace = applyPeoplePlanningAssignmentChanges(assignedWorkspace, [{
  ...assignment,
  cancelled_at: '2030-01-07T12:00:00Z',
}])
assert.equal(clearedWorkspace.assignments.length, 0)
assert.equal(clearedWorkspace.planningAssignments.length, 0)
assert.equal(clearedWorkspace.machines[0].stages.find((stage) => stage.sectionId === 'cutting')?.progressPercent, 0)

const machines = [
  { id: 'later-workshop', productionWorkshop: 2, queueNumber: 1, createdAt: '2030-01-01', name: 'B' },
  { id: 'later-queue', productionWorkshop: 1, queueNumber: 2, createdAt: '2030-01-01', name: 'C' },
  { id: 'first', productionWorkshop: 1, queueNumber: 1, createdAt: '2030-01-02', name: 'A' },
] as unknown as PeoplePlanningMachine[]
assert.deepEqual([...machines].sort(comparePeoplePlanningMachines).map((machine) => machine.id), ['first', 'later-queue', 'later-workshop'])

const vacation = {
  id: 'vacation-1',
  employee_id: 'employee-1',
  start_date: '2030-01-10',
  end_date: '2030-01-19',
  note: null,
  cancelled_at: null,
  created_at: '2030-01-01T00:00:00Z',
  created_by: null,
  updated_at: '2030-01-01T00:00:00Z',
  updated_by: null,
} as EmployeeVacation
assert.equal(findEmployeeVacationOnDate([vacation], 'employee-1', '2030-01-10')?.id, 'vacation-1')
assert.equal(findEmployeeVacationOnDate([vacation], 'employee-1', '2030-01-19')?.id, 'vacation-1')
assert.equal(findEmployeeVacationOnDate([vacation], 'employee-1', '2030-01-20'), null)
assert.equal(findEmployeeVacationOnDate([{ ...vacation, cancelled_at: '2030-01-02T00:00:00Z' }], 'employee-1', '2030-01-12'), null)
assert.equal(vacationDurationDays(vacation), 10)

if (process.env.PEOPLE_PLANNING_TEST_DATABASE_URL) {
  const result = spawnSync('psql', [
    '-v', 'ON_ERROR_STOP=1',
    process.env.PEOPLE_PLANNING_TEST_DATABASE_URL,
    '-f', path.join(root, 'supabase/tests/people_planning_v1_test.sql'),
  ], { stdio: 'inherit' })
  assert.equal(result.status, 0, 'SQL people planning test failed')
}

console.log('people planning v1 integration checks: ok')
