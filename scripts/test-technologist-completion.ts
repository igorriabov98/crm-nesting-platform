import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculatePlasmaTime, calculateWaste, nextWeekday } from '../src/lib/request-completion-calculations'
import { resolveCompletionWorkspaceNavigation } from '../src/lib/request-completion-navigation'
import { ROUTES } from '../src/lib/constants/routes'

assert.deepEqual(calculateWaste(1000, 15.5), { scrapKg: 155, usefulKg: 845 })
assert.deepEqual(calculateWaste(123.456, 15.5), { scrapKg: 19.136, usefulKg: 104.32 })
assert.deepEqual(calculatePlasmaTime(1, 1), { enteredMinutes: 61, addedMinutes: 16, actualMinutes: 77 })
assert.equal(nextWeekday(new Date('2026-07-31T00:00:00Z')).toISOString().slice(0, 10), '2026-08-03')
assert.deepEqual(resolveCompletionWorkspaceNavigation('pending_stock_check'), { kind: 'open' })
assert.deepEqual(resolveCompletionWorkspaceNavigation('stock_checked'), { kind: 'open' })
assert.deepEqual(resolveCompletionWorkspaceNavigation('submitted_to_supply'), { kind: 'redirect', href: ROUTES.MATERIAL_REQUESTS })
assert.deepEqual(resolveCompletionWorkspaceNavigation('completed'), { kind: 'redirect', href: ROUTES.MATERIAL_REQUESTS })
assert.deepEqual(resolveCompletionWorkspaceNavigation('draft'), { kind: 'unavailable' })

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

const completionPage = readFileSync('src/app/(protected)/technologist/requests/[requestId]/complete/page.tsx', 'utf8')
assert.ok(completionPage.includes('if (result.redirectTo) redirect(result.redirectTo)'))

const planFactsMigration = readFileSync('supabase/migrations/20260820120000_technologist_completion_plan_facts.sql', 'utf8')
for (const required of [
  'technologist_request_plan_fact_items',
  'fn_get_long_stock_completion_plan_facts_v1',
  'Сверка веса не сошлась для позиции',
  'Укажите отходность только для обычных металлических позиций без карты раскроя',
  "v_payload_count = 0 and v_plan_count = 0",
]) assert.ok(planFactsMigration.includes(required), `plan-fact completion migration is missing ${required}`)

const completionAction = readFileSync('src/lib/actions/request-completion.ts', 'utf8')
assert.ok(completionAction.includes("accountingMode: 'manual_percent' | 'plan_fact'"))
assert.ok(completionAction.includes("client.rpc('fn_get_long_stock_completion_plan_facts_v1'"))
assert.ok(completionAction.includes('wasteItems: z.array(wasteSchema)'))
assert.ok(!completionAction.includes('wasteItems: z.array(wasteSchema).min(1)'))

const completionWizard = readFileSync('src/components/features/technologist/RequestCompletionWizard.tsx', 'utf8')
assert.ok(completionWizard.includes("item.accountingMode === 'manual_percent'"))
assert.ok(completionWizard.includes("item.accountingMode === 'plan_fact'"))
assert.ok(completionWizard.includes('wasteItems: manualWasteItems.map'))
assert.ok(!completionWizard.includes('wasteItems: workspace.wasteItems.map'))

console.log('Technologist completion regression passed')
