import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculatePlasmaTime, calculateWaste, nextWeekday } from '../src/lib/request-completion-calculations'

assert.deepEqual(calculateWaste(1000, 15.5), { scrapKg: 155, usefulKg: 845 })
assert.deepEqual(calculateWaste(123.456, 15.5), { scrapKg: 19.136, usefulKg: 104.32 })
assert.deepEqual(calculatePlasmaTime(1, 1), { enteredMinutes: 61, addedMinutes: 16, actualMinutes: 77 })
assert.equal(nextWeekday(new Date('2026-07-31T00:00:00Z')).toISOString().slice(0, 10), '2026-08-03')

const migration = readFileSync('supabase/migrations/20260729120000_technologist_completion_future_detailing_scrap.sql', 'utf8')
for (const required of [
  'fn_finalize_technologist_request', 'FOR UPDATE', 'fn_confirm_future_detailing', 'fn_materialize_due_future_detailing_tasks',
  'fn_sell_metal_scrap', 'fn_cancel_metal_scrap_sale', 'fn_review_metal_scrap_lot', 'review_required',
  'average_price_per_kg', 'metal_scrap_finance_incomes', 'next_weekday',
  'fn_correct_technologist_completion', 'fn_correct_future_detailing_plan',
]) assert.ok(migration.includes(required), `migration is missing ${required}`)

const supplyPage = readFileSync('src/components/features/supply-request/SupplyRequestPage.tsx', 'utf8')
assert.ok(supplyPage.includes('/technologist/requests/${request.id}/complete'))
assert.ok(!supplyPage.includes("toast.success('Бронь завершена. Заявка передана в снабжение.')"))

console.log('Technologist completion regression passed')
