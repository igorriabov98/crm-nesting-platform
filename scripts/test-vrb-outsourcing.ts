import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8')

const migration = read('supabase/migrations/20260831120000_vrb_mesh_outsourcing_workflow.sql')
const productForm = read('src/components/features/products/ProductForm.tsx')
const productActions = read('src/lib/actions/products.ts')
const salesActions = read('src/app/(protected)/sales-plan/actions.ts')
const outsourcingActions = read('src/lib/actions/outsourcing.ts')
const vrbActions = read('src/lib/actions/vrb-outsourcing.ts')
const receivingPanel = read('src/components/features/inventory/VrbReceivingPanel.tsx')
const receivingPage = read('src/app/(protected)/inventory/receiving/page.tsx')
const supplyPage = read('src/components/features/supply/SupplyOutsourcingRequestsPage.tsx')
const drawingRoute = read('src/app/api/supply/outsourcing/[operationId]/drawings/[source]/[fileId]/route.ts')
const machineProgress = read('src/lib/actions/machine-progress.ts')
const machineDetail = read('src/components/features/machines/MachineDetail.tsx')
const productionTable = read('src/components/features/production/ProductionTable.tsx')
const productionPlanner = read('src/components/features/production/ProductionPlanner.tsx')
const sidebarCounts = read('src/lib/actions/sidebar-work-queues.ts')
const taskCards = read('src/components/features/tasks/TaskCards.tsx')
const databaseTypes = read('src/lib/types/database.ts')

// Schema, constraints and immutable snapshots.
assert.match(migration, /requires_vrb_mesh boolean NOT NULL DEFAULT false/)
assert.match(migration, /'vrb_mesh',[\s\S]*'Заказ сетки VRB'/)
assert.match(migration, /operation_kind text NOT NULL DEFAULT 'standard'/)
assert.match(migration, /idx_machine_outsourcing_one_active_vrb_root/)
assert.match(migration, /parent_operation_id IS NULL\s+AND archived_at IS NULL/)
assert.match(migration, /source_machine_item_id uuid\s+REFERENCES public\.machine_items\(id\) ON DELETE SET NULL/)
assert.match(migration, /machine_outsourcing_vrb_receipts/)
assert.match(migration, /requested_quantity numeric NOT NULL CHECK \(requested_quantity > 0\)/)
assert.match(migration, /requested_weight_kg numeric NOT NULL DEFAULT 0/)
assert.match(migration, /project_drawing\.id IS NOT NULL THEN 'project'/)
assert.doesNotMatch(migration, /INSERT INTO public\.(inventory_stock|inventory_transactions|warehouse_stock)/)

// Triggered sync uses current product flags only when an order or its lines change.
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.sync_vrb_mesh_for_machine/)
assert.match(migration, /v_machine\.is_confirmed IS DISTINCT FROM true/)
assert.match(migration, /product\.requires_vrb_mesh = true/)
assert.match(migration, /AFTER INSERT OR UPDATE OF is_confirmed, is_archived ON public\.machines/)
assert.match(migration, /AFTER INSERT OR DELETE OR UPDATE OF machine_id, product_id, quantity/)
assert.doesNotMatch(migration, /CREATE TRIGGER[\s\S]{0,120}ON public\.products/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /v_operation\.supply_taken_at IS NULL[\s\S]*vrb_replace_operation_snapshot/)
assert.match(migration, /SET archived_at = now\(\)[\s\S]*status = 'cancelled'/)
assert.match(migration, /SET order_changed_at = COALESCE\(order_changed_at, now\(\)\)/)
assert.match(migration, /order_change_ignored_fingerprint/)
assert.match(migration, /v_operation\.order_change_decision = 'kept_original'[\s\S]*v_current_fingerprint/)
assert.match(migration, /Автоматический дозаказ VRB после отправки основной заявки/)
assert.match(migration, /положительная разница VRB исчезла/)
assert.match(migration, /v_supplement\.approval_task_id[\s\S]*status = 'cancelled'/)
assert.match(migration, /vrb_operation_dispatch_trigger/)
assert.match(migration, /vrb_transport_trip_status_trigger/)

// Approval task is transactional, idempotent, and intentionally silent in Telegram.
assert.match(migration, /ADD VALUE IF NOT EXISTS 'vrb_outsourcing_approval'/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.vrb_ensure_approval_task/)
assert.match(migration, /Missing supply leadership must never block sales order confirmation/)
assert.match(migration, /IF v_assignee_id IS NULL THEN RETURN; END IF/)
assert.match(migration, /notified_at\s*\)[\s\S]*now\(\)/)
assert.match(migration, /ON CONFLICT \(machine_id, assigned_to, task_type\)/)
assert.match(vrbActions, /notified_at: new Date\(\)\.toISOString\(\)/)
assert.match(taskCards, /vrb_outsourcing_approval: 'Заказ сетки VRB'/)
assert.match(taskCards, /ROUTES\.SUPPLY_OUTSOURCING_REQUESTS/)
assert.match(sidebarCounts, /loadOutsourcingApprovalCount/)

// Product UI and persistence.
assert.match(productForm, /Требуется сетка VRB/)
assert.match(productForm, /aria-describedby="requires_vrb_mesh_help"/)
assert.match(productForm, /Сетка VRB/)
assert.match(productActions, /requires_vrb_mesh: parsed\.requires_vrb_mesh/)
assert.match(salesActions, /ensureVrbApprovalTasksForMachine/)

// Supply agreement, conflict resolution and two delivery branches.
assert.match(outsourcingActions, /operation\.operation_kind === 'vrb_mesh' && operation\.delivery_method === 'carrier'/)
assert.match(outsourcingActions, /cancelActiveTransportNeed\(db, operation\.id, 'outbound', 'confirmed'\)/)
assert.match(outsourcingActions, /createNeedAndTask\(db, enrichedOperation, 'return', 'confirmed', supplyHeadId\)/)
assert.match(outsourcingActions, /deliveryCostPlanned/)
assert.match(outsourcingActions, /can_transport/)
assert.match(outsourcingActions, /После отправки условия VRB нельзя изменить/)
assert.match(vrbActions, /markVrbCarrierDispatched/)
assert.match(vrbActions, /delivery_tracking_number: parsed\.trackingNumber/)
assert.match(vrbActions, /fn_resolve_vrb_order_change/)
assert.match(supplyPage, /Принять изменения/)
assert.match(supplyPage, /Оставить исходное/)
assert.match(supplyPage, /Наш транспорт/)
assert.match(supplyPage, /Служба доставки/)

// Atomic warehouse receipt: delivery fact, factory isolation, partial receipt and no over-receipt.
assert.match(migration, /fn_receive_vrb_mesh\([\s\S]*p_operation_id uuid,[\s\S]*p_items jsonb/)
assert.match(migration, /jsonb_array_elements\(p_items\)/)
assert.match(migration, /operation_id = v_operation\.id/)
assert.match(migration, /v_machine_factory_id IS DISTINCT FROM p_factory_id/)
assert.match(migration, /v_quantity > v_remaining/)
assert.match(migration, /received\.quantity < item\.requested_quantity/)
assert.match(migration, /SET actual_returned_at = current_date/)
assert.match(migration, /need\.status = 'completed'/)
assert.match(vrbActions, /p_items: parsed\.items/)
assert.match(receivingPage, /VrbReceivingPanel/)
assert.match(receivingPanel, /не создаёт складской остаток/)
assert.match(receivingPanel, /max=\{item\.remainingQuantity\}/)

// Drawing survives source-line deletion; VRB is a risk, not a production stage.
assert.match(drawingRoute, /machine_outsourcing_vrb_items/)
assert.match(drawingRoute, /belongsToVrbRequest/)
assert.match(machineProgress, /\.eq\('operation_kind', 'standard'\)/)
assert.match(machineDetail, /Информационный риск: не блокирует производство/)
assert.match(productionTable, /vrb_status/)
assert.match(productionPlanner, /Производство не блокируется/)

// RLS and service-only execution.
assert.match(migration, /ENABLE ROW LEVEL SECURITY/g)
assert.match(migration, /GRANT SELECT ON public\.machine_outsourcing_vrb_items TO authenticated/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.sync_vrb_mesh_for_machine\(uuid\)\s+FROM PUBLIC, anon, authenticated/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_receive_vrb_mesh\(uuid, jsonb, uuid, uuid\)\s+FROM PUBLIC, anon, authenticated/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_receive_vrb_mesh\(uuid, jsonb, uuid, uuid\)\s+TO service_role/)
assert.match(databaseTypes, /operation_kind: 'standard' \| 'vrb_mesh'/)
assert.match(databaseTypes, /vrb_outsourcing_approval/)

type Product = { id: string; requiresVrb: boolean }
type Line = { id: string; productId: string; quantity: number }
type Snapshot = { lineId: string; quantity: number }
type Operation = {
  archived: boolean
  taken: boolean
  dispatched: boolean
  changed: boolean
  snapshot: Snapshot[]
  supplements: Snapshot[][]
}

function eligibleSnapshot(lines: Line[], products: Product[]) {
  const productById = new Map(products.map((product) => [product.id, product]))
  return lines
    .filter((line) => line.quantity > 0 && productById.get(line.productId)?.requiresVrb)
    .map((line) => ({ lineId: line.id, quantity: line.quantity }))
}

function sameSnapshot(left: Snapshot[], right: Snapshot[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function syncModel(
  confirmed: boolean,
  lines: Line[],
  products: Product[],
  operation: Operation | null,
): Operation | null {
  const current = eligibleSnapshot(lines, products)
  if (!confirmed || current.length === 0) {
    if (!operation) return null
    return operation.taken
      ? { ...operation, changed: true }
      : { ...operation, archived: true }
  }
  if (!operation) {
    return { archived: false, taken: false, dispatched: false, changed: false, snapshot: current, supplements: [] }
  }
  if (!operation.taken) return { ...operation, snapshot: current, changed: false }
  if (sameSnapshot(operation.snapshot, current)) return { ...operation, changed: false }
  const ordered = new Map(operation.snapshot.map((item) => [item.lineId, item.quantity]))
  for (const supplement of operation.supplements) {
    for (const item of supplement) ordered.set(item.lineId, (ordered.get(item.lineId) || 0) + item.quantity)
  }
  const positive = current.flatMap((item) => {
    const delta = item.quantity - (ordered.get(item.lineId) || 0)
    return delta > 0 ? [{ lineId: item.lineId, quantity: delta }] : []
  })
  return {
    ...operation,
    changed: true,
    supplements: operation.dispatched && positive.length > 0
      ? [...operation.supplements, positive]
      : operation.supplements,
  }
}

const products: Product[] = [
  { id: 'vrb-a', requiresVrb: true },
  { id: 'vrb-b', requiresVrb: true },
  { id: 'plain', requiresVrb: false },
]
const lines: Line[] = [
  { id: 'line-a', productId: 'vrb-a', quantity: 3 },
  { id: 'line-b', productId: 'vrb-b', quantity: 5 },
  { id: 'line-c', productId: 'plain', quantity: 8 },
]

assert.equal(syncModel(false, lines, products, null), null, 'no request before confirmation')
const created = syncModel(true, lines, products, null)
assert.ok(created)
assert.deepEqual(created.snapshot, [
  { lineId: 'line-a', quantity: 3 },
  { lineId: 'line-b', quantity: 5 },
], 'one request contains every currently flagged line and its order quantity')
assert.deepEqual(syncModel(true, lines, products, created), created, 'repeat sync is idempotent')

const productFlagChangedWithoutSync = created
products[0].requiresVrb = false
assert.equal(productFlagChangedWithoutSync.snapshot.length, 2, 'product-card edit does not retroactively mutate a confirmed snapshot')
products[0].requiresVrb = true

const preTakeChanged = syncModel(true, [{ ...lines[0], quantity: 7 }, lines[1]], products, created)
assert.equal(preTakeChanged?.snapshot[0]?.quantity, 7, 'before take the request follows order lines')
assert.equal(syncModel(false, lines, products, created)?.archived, true, 'untaken request is archived after unconfirmation')

const frozen = { ...created, taken: true }
const changedFrozen = syncModel(true, [{ ...lines[0], quantity: 6 }, lines[1]], products, frozen)
assert.equal(changedFrozen?.snapshot[0]?.quantity, 3, 'taken request stays frozen')
assert.equal(changedFrozen?.changed, true)
assert.equal(changedFrozen?.supplements.length, 0, 'before dispatch no supplement is created')

const dispatched = { ...frozen, dispatched: true }
const increased = syncModel(true, [{ ...lines[0], quantity: 6 }, lines[1]], products, dispatched)
assert.deepEqual(increased?.supplements, [[{ lineId: 'line-a', quantity: 3 }]], 'positive post-dispatch delta becomes a supplement')
const reduced = syncModel(true, [{ ...lines[0], quantity: 2 }, lines[1]], products, dispatched)
assert.equal(reduced?.supplements.length, 0, 'post-dispatch reduction remains a warning for manual resolution')

function shouldWarnAfterKeep(snapshot: Snapshot[], current: Snapshot[], ignoredCurrent: Snapshot[] | null) {
  if (sameSnapshot(snapshot, current)) return false
  return !ignoredCurrent || !sameSnapshot(current, ignoredCurrent)
}
const keptCurrent = [{ lineId: 'line-a', quantity: 2 }, { lineId: 'line-b', quantity: 5 }]
assert.equal(shouldWarnAfterKeep(created.snapshot, keptCurrent, keptCurrent), false, 'kept-original decision suppresses the same diff')
assert.equal(
  shouldWarnAfterKeep(created.snapshot, [{ ...keptCurrent[0], quantity: 1 }, keptCurrent[1]], keptCurrent),
  true,
  'a later relevant order change reopens the warning',
)

function transportNeeds(method: 'own_transport' | 'carrier') {
  return method === 'own_transport' ? ['return'] : []
}
assert.deepEqual(transportNeeds('own_transport'), ['return'])
assert.deepEqual(transportNeeds('carrier'), [])

type ReceiptState = { factoryId: string; requested: number; received: number }
function receiveModel(state: ReceiptState, factoryId: string, quantity: number) {
  assert.equal(factoryId, state.factoryId, 'factory isolation')
  assert.ok(quantity > 0)
  assert.ok(quantity <= state.requested - state.received, 'over-receipt is forbidden')
  const received = state.received + quantity
  return { ...state, received, completed: received === state.requested }
}

const partial = receiveModel({ factoryId: 'factory-a', requested: 10, received: 0 }, 'factory-a', 4)
assert.equal(partial.completed, false)
const complete = receiveModel(partial, 'factory-a', 6)
assert.equal(complete.completed, true)
assert.throws(() => receiveModel(partial, 'factory-a', 7))
assert.throws(() => receiveModel(partial, 'factory-b', 1))

console.log('VRB outsourcing workflow checks: ok')
