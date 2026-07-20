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
import type { PeoplePlanningMachine, PeoplePlanningSection } from '../src/lib/people-planning/types'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')
const migration = read('supabase/migrations/20260720095019_people_planning_v1.sql')
const correctionsMigration = read('supabase/migrations/20260720131352_people_planning_stage_progress.sql')
const actions = read('src/lib/actions/people-planning.ts')
const board = read('src/components/features/production/PeoplePlanningBoard.tsx')
const workOrder = read('src/lib/pdf/PeopleWorkOrderDocument.tsx')
const databaseTypes = read('src/lib/types/database.ts')

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
assert.match(migration, /Machine already has pending people planning suggestions/)
assert.doesNotMatch(actions, /production_tonnage_facts/)
assert.doesNotMatch(actions, /getMachine\(/)
assert.match(board, /Сотрудники и ставки/)
assert.match(board, /Первая половина/)
assert.match(board, /Вторая половина/)
assert.match(board, /Занят на другом участке/)
assert.match(board, /Скопировать вчерашний день/)
assert.match(board, /Машины месяца/)
assert.match(board, /Осталось/)
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
for (const existingTable of ['machines', 'production_stages', 'production_month_plans', 'production_fact_sections', 'production_machine_facts', 'production_tonnage_facts']) {
  assert.doesNotMatch(correctionsMigration, new RegExp(`ALTER TABLE public\\.${existingTable}\\b`, 'i'), `${existingTable} must not be altered by corrections`)
}

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

const machines = [
  { id: 'later-workshop', productionWorkshop: 2, queueNumber: 1, createdAt: '2030-01-01', name: 'B' },
  { id: 'later-queue', productionWorkshop: 1, queueNumber: 2, createdAt: '2030-01-01', name: 'C' },
  { id: 'first', productionWorkshop: 1, queueNumber: 1, createdAt: '2030-01-02', name: 'A' },
] as unknown as PeoplePlanningMachine[]
assert.deepEqual([...machines].sort(comparePeoplePlanningMachines).map((machine) => machine.id), ['first', 'later-queue', 'later-workshop'])

if (process.env.PEOPLE_PLANNING_TEST_DATABASE_URL) {
  const result = spawnSync('psql', [
    '-v', 'ON_ERROR_STOP=1',
    process.env.PEOPLE_PLANNING_TEST_DATABASE_URL,
    '-f', path.join(root, 'supabase/tests/people_planning_v1_test.sql'),
  ], { stdio: 'inherit' })
  assert.equal(result.status, 0, 'SQL people planning test failed')
}

console.log('people planning v1 integration checks: ok')
