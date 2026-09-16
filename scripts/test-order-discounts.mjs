import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20260915124442_client_price_order_discounts.sql', import.meta.url), 'utf8')
const priceAction = await readFile(new URL('../src/lib/actions/client-product-prices.ts', import.meta.url), 'utf8')
const discountAction = await readFile(new URL('../src/lib/actions/machine-discounts.ts', import.meta.url), 'utf8')
const documentAction = await readFile(new URL('../src/lib/actions/document-generation.ts', import.meta.url), 'utf8')
const documentRoute = await readFile(new URL('../src/app/api/documents/generate/route.ts', import.meta.url), 'utf8')
const invoiceAction = await readFile(new URL('../src/lib/actions/invoices.ts', import.meta.url), 'utf8')
const priceDialog = await readFile(new URL('../src/components/features/client-prices/ClientPriceAdjustmentDialog.tsx', import.meta.url), 'utf8')
const discountSection = await readFile(new URL('../src/components/features/machines/MachineDiscountSection.tsx', import.meta.url), 'utf8')
const approvalDialog = await readFile(new URL('../src/components/features/tasks/MachineDiscountApprovalButton.tsx', import.meta.url), 'utf8')
const documentButtons = await readFile(new URL('../src/components/features/documents/DocumentGenerationButtons.tsx', import.meta.url), 'utf8')

for (const table of [
  'client_price_adjustments',
  'client_price_adjustment_lines',
  'client_price_adjustment_order_lines',
  'machine_discount_requests',
]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`))
}

for (const rpc of [
  'fn_adjust_client_product_prices',
  'fn_apply_client_price_adjustment_to_orders',
  'fn_submit_machine_discount_request',
  'fn_approve_machine_discount_request',
  'fn_reject_machine_discount_request',
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`))
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}[^;]+to service_role`, 's'))
}

assert.match(migration, /p_percent < 0\.01 or p_percent > 50/)
assert.match(migration, /p_discount_percent < 0\.01 or p_discount_percent > 50/)
assert.match(migration, /where price\.client_id = p_client_id and price\.coating = any\(p_coatings\)/)
assert.match(migration, /round\(price\.price_eur::numeric \* case when p_direction = 'increase'/)
assert.match(migration, /round\(v_item\.price::numeric, 2\) = v_item\.old_price/)
assert.match(migration, /'skipReasons', v_skip_reasons/)
assert.match(migration, /not coalesce\(item\.is_sample, false\)/)
assert.match(migration, /invoice\.cancelled_at is null/)
assert.match(migration, /status in \('pending', 'approved'\)/)
assert.match(migration, /fn_machine_discount_items_snapshot\(v_request\.machine_id\)/)
assert.match(migration, /Изменён состав, изделие, покрытие, количество или цена заказа/)
assert.match(migration, /after update of client_id, is_archived on public\.machines/)
assert.match(migration, /invoice_pending_machine_discount_guard/)
assert.match(migration, /where request\.machine_id = new\.machine_id and request\.status = 'pending'/)

assert.match(priceAction, /adjustClientProductPrices/)
assert.match(priceAction, /applyClientPriceAdjustmentToOrders/)
assert.match(discountAction, /submitMachineDiscountRequest/)
assert.match(discountAction, /approveMachineDiscountRequest/)
assert.match(discountAction, /rejectMachineDiscountRequest/)
assert.match(discountAction, /adminDb\(\)\.rpc\('fn_submit_machine_discount_request'/)
assert.match(discountAction, /adminDb\(\)\.rpc\('fn_approve_machine_discount_request'/)
assert.match(discountAction, /adminDb\(\)\.rpc\('fn_reject_machine_discount_request'/)
assert.doesNotMatch(discountAction, /context\.supabase[\s\S]{0,120}fn_(?:submit|approve|reject)_machine_discount/)
assert.match(documentAction, /goods_total_after_discount/)
assert.match(documentAction, /discount_status/)
assert.match(documentRoute, /скидка ожидает подтверждения/)
assert.match(invoiceAction, /Новый инвойс заблокирован: скидка ожидает подтверждения/)
assert.match(priceDialog, /\[\.\.\.CLIENT_PRICE_COATINGS\]/)
assert.match(priceDialog, /Галочки по умолчанию сняты/)
assert.match(priceDialog, /Обновление снимет текущую скидку/)
assert.match(priceDialog, /max-h-\[90dvh\]/)
assert.match(discountSection, /Ожидает подтверждения/)
assert.match(discountSection, /Транспорт и прочие расходы не меняются/)
assert.match(discountSection, /machine\.has_active_invoice/)
assert.match(approvalDialog, /Для отклонения комментарий обязателен/)
assert.match(approvalDialog, /request\.total_before_discount/)
assert.match(approvalDialog, /request\.total_after_discount/)
assert.match(documentButtons, /const blocked = pricedDocumentsBlocked && isPriced/)

console.log('order discount and client price adjustment source contract: ok')
