import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8')

const [enumMigration, migration, inventoryActions, transferActions, reserveButton, transportPanel,
  receivingPanel, supplyRequestActions, taskActions, taskCards, productionFactActions, databaseTypes] = await Promise.all([
  read('supabase/migrations/20260721124444_inventory_factory_transfers.sql'),
  read('supabase/migrations/20260721124456_inventory_factory_transfer_module.sql'),
  read('src/lib/actions/inventory.ts'),
  read('src/lib/actions/inventory-transfers.ts'),
  read('src/components/features/supply-request/ReserveButton.tsx'),
  read('src/components/features/supply/InventoryTransferPanel.tsx'),
  read('src/components/features/inventory/InventoryTransferReceivingPanel.tsx'),
  read('src/lib/actions/supply-request.ts'),
  read('src/lib/actions/tasks.ts'),
  read('src/components/features/tasks/TaskCards.tsx'),
  read('src/lib/actions/production-fact.ts'),
  read('src/lib/types/database.ts'),
])

assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'transfer_out'/)
assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'transfer_in'/)
assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'inventory_transfer'/)
for (const table of ['inventory_transfers', 'inventory_transfer_items']) {
  assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`), `${table} is missing`)
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} RLS is missing`)
}
for (const status of ['needs_date', 'scheduled', 'partially_received', 'completed', 'cancelled']) {
  assert.match(migration, new RegExp(`'${status}'`), `transfer status ${status} is missing`)
}
for (const rpc of [
  'fn_reserve_inventory_row_for_machine_transfer',
  'fn_set_inventory_transfer_date',
  'fn_receive_inventory_transfer',
]) {
  assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}`), `${rpc} is missing`)
}
assert.match(migration, /CREATE UNIQUE INDEX inventory_transfers_one_active_direction_idx/)
assert.match(migration, /'transfer_out'/)
assert.match(migration, /'transfer_in'/)
assert.match(migration, /РИСК ОПОЗДАНИЯ/)
assert.match(migration, /Мерные куски можно принимать только целиком/)
assert.match(migration, /FOR UPDATE[\s\S]*inventory_assert_machine_transfers_received/)
assert.match(migration, /BEFORE INSERT OR UPDATE OF machine_id, section_id ON public\.production_machine_facts/)
assert.match(migration, /BEFORE INSERT ON public\.production_fact_cutting_events/)
assert.match(migration, /CREATE TRIGGER protect_inventory_transfer_task/)
assert.match(migration, /SET search_path = ''/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_receive_inventory_transfer/)

assert.match(inventoryActions, /fn_reserve_inventory_row_for_machine_transfer/)
assert.match(transferActions, /fn_set_inventory_transfer_date/)
assert.match(transferActions, /fn_receive_inventory_transfer/)
assert.match(reserveButton, /Остатки других заводов/)
assert.match(reserveButton, /Подтвердите маршрут/)
assert.match(reserveButton, /window\.confirm/)
assert.match(transportPanel, /Ожидаемая дата/)
assert.match(receivingPanel, /Принять указанный факт/)
assert.match(receivingPanel, /Частичная и сверхплановая приёмка/)
assert.match(supplyRequestActions, /item\.factory_id === data\.request\.machine\.factory_id/)
assert.match(taskActions, /Задача перемещения материалов закрывается автоматически/)
assert.match(taskCards, /Перемещение материалов/)
assert.match(productionFactActions, /assertInventoryTransfersReceived/)
assert.match(productionFactActions, /не весь межзаводской материал принят/)
assert.match(databaseTypes, /inventory_transfers:/)
assert.match(databaseTypes, /inventory_transfer_items:/)
assert.match(databaseTypes, /'inventory_transfer'/)
assert.match(databaseTypes, /'transfer_out'/)
assert.match(databaseTypes, /'transfer_in'/)

if (process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL) {
  const databaseUrl = new URL(process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL)
  const isLocal = ['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)
    || databaseUrl.hostname === ''
  assert.ok(isLocal && databaseUrl.pathname.toLowerCase().includes('test'),
    'SQL transfer tests only run against a local database whose name contains "test"')

  const result = spawnSync('psql', [
    '-v', 'ON_ERROR_STOP=1',
    process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL,
    '-f', path.join(root, 'supabase/tests/inventory_factory_transfers_test.sql'),
  ], { stdio: 'inherit' })
  assert.equal(result.status, 0, 'SQL inventory transfer lifecycle test failed')

  const runPsql = (sql) => new Promise((resolve) => {
    const child = spawn('psql', [
      '-v', 'ON_ERROR_STOP=1',
      '-At',
      process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL,
      '-c', sql,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })

  const fixture = {
    actor: randomUUID(),
    supply: randomUUID(),
    department: randomUUID(),
    material: randomUUID(),
    machine: randomUUID(),
    request: randomUUID(),
    item: randomUUID(),
    inventory: randomUUID(),
    section: randomUUID(),
    fact: randomUUID(),
  }
  const setupSql = `
    WITH factories AS (
      SELECT
        (SELECT id FROM public.factories WHERE name = 'Берегово' LIMIT 1) AS destination_id,
        (SELECT id FROM public.factories WHERE name = 'Ужгород' LIMIT 1) AS source_id
    )
    INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
    SELECT '${fixture.actor}', '${fixture.actor}@example.test', 'Concurrency technologist', 'technologist', destination_id, true FROM factories;
    INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
    SELECT '${fixture.supply}', '${fixture.supply}@example.test', 'Concurrency supply', 'procurement_head', id, true
    FROM public.factories WHERE name = 'Берегово' LIMIT 1;
    INSERT INTO public.departments(id, name, head_user_id, factory_id, is_active, sort_order, created_by)
    SELECT '${fixture.department}', 'Снабжение', '${fixture.supply}', id, true, -2000, '${fixture.actor}'
    FROM public.factories WHERE name = 'Берегово' LIMIT 1;
    INSERT INTO public.materials(id, name, category, created_by)
    VALUES ('${fixture.material}', 'Concurrency transfer material', 'components', '${fixture.actor}');
    INSERT INTO public.machines(id, factory_id, name, created_by)
    SELECT '${fixture.machine}', id, 'INV-TRANSFER-CONCURRENCY', '${fixture.actor}'
    FROM public.factories WHERE name = 'Берегово' LIMIT 1;
    INSERT INTO public.technologist_requests(id, machine_id, created_by)
    VALUES ('${fixture.request}', '${fixture.machine}', '${fixture.actor}');
    INSERT INTO public.request_components(id, request_id, component_name, quantity_needed, unit, material_id)
    VALUES ('${fixture.item}', '${fixture.request}', 'Concurrency item', 1, 'шт', '${fixture.material}');
    INSERT INTO public.inventory(id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by)
    SELECT '${fixture.inventory}', id, '${fixture.material}', 1, 0, 'шт', '${fixture.actor}'
    FROM public.factories WHERE name = 'Ужгород' LIMIT 1;
    INSERT INTO public.production_fact_sections(id, factory_id, name, production_stage_type, created_by, updated_by)
    SELECT '${fixture.section}', id, 'Concurrency cutting ${fixture.section}', 'cutting', '${fixture.actor}', '${fixture.actor}'
    FROM public.factories WHERE name = 'Берегово' LIMIT 1;
    SELECT set_config('request.jwt.claim.sub', '${fixture.actor}', true);
    SELECT public.fn_reserve_inventory_row_for_machine_transfer(
      '${fixture.inventory}', '${fixture.machine}', 1, 'request_components', '${fixture.item}',
      '${fixture.actor}', NULL, false
    );
    SELECT transfer.id::text || '|' || item.id::text
    FROM public.inventory_transfers AS transfer
    JOIN public.inventory_transfer_items AS item ON item.transfer_id = transfer.id
    WHERE transfer.machine_id = '${fixture.machine}'
      AND transfer.status IN ('needs_date', 'scheduled', 'partially_received');
  `
  const setup = spawnSync('psql', [
    '-v', 'ON_ERROR_STOP=1', '-At',
    process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL,
    '-c', setupSql,
  ], { encoding: 'utf8' })
  assert.equal(setup.status, 0, setup.stderr || 'Concurrency fixture setup failed')
  const idsLine = setup.stdout.trim().split('\n').findLast((line) => line.includes('|'))
  assert.ok(idsLine, 'Concurrency transfer ids were not returned')
  const [transferId, transferItemId] = idsLine.split('|')

  const cleanupSql = `
    DELETE FROM public.production_machine_facts WHERE machine_id = '${fixture.machine}';
    DELETE FROM public.inventory_reservations WHERE machine_id = '${fixture.machine}';
    DELETE FROM public.inventory_transfers WHERE machine_id = '${fixture.machine}';
    DELETE FROM public.inventory_transactions WHERE machine_id = '${fixture.machine}';
    DELETE FROM public.tasks WHERE machine_id = '${fixture.machine}';
    DELETE FROM public.technologist_requests WHERE id = '${fixture.request}';
    DELETE FROM public.production_stages WHERE machine_id = '${fixture.machine}';
    DELETE FROM public.machines WHERE id = '${fixture.machine}';
    DELETE FROM public.production_fact_sections WHERE id = '${fixture.section}';
    DELETE FROM public.inventory WHERE material_id = '${fixture.material}';
    DELETE FROM public.departments WHERE id = '${fixture.department}';
    DELETE FROM public.materials WHERE id = '${fixture.material}';
    DELETE FROM public.users WHERE id IN ('${fixture.actor}', '${fixture.supply}');
  `

  try {
    const cuttingPromise = runPsql(`
      BEGIN;
      SELECT id FROM public.machines WHERE id = '${fixture.machine}' FOR UPDATE;
      SELECT pg_sleep(1);
      INSERT INTO public.production_machine_facts(
        id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
      )
      SELECT '${fixture.fact}', factory_id, current_date, 'day', id, '${fixture.section}', '${fixture.actor}', '${fixture.actor}'
      FROM public.machines WHERE id = '${fixture.machine}';
      COMMIT;
    `)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const receivingPromise = runPsql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${fixture.actor}', true);
      SELECT public.fn_receive_inventory_transfer(
        '${transferId}',
        jsonb_build_array(jsonb_build_object('item_id', '${transferItemId}', 'quantity', 1)),
        '${fixture.actor}'
      );
      COMMIT;
    `)
    const [cutting, receiving] = await Promise.all([cuttingPromise, receivingPromise])
    assert.notEqual(cutting.status, 0, 'Concurrent cutting fact was not rejected')
    assert.match(cutting.stderr, /не весь межзаводской материал принят/)
    assert.equal(receiving.status, 0, receiving.stderr || 'Concurrent receiving failed')

    const check = spawnSync('psql', [
      '-v', 'ON_ERROR_STOP=1', '-At',
      process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL,
      '-c', `SELECT status::text || '|' || (SELECT count(*) FROM public.production_machine_facts WHERE id = '${fixture.fact}')::text FROM public.inventory_transfers WHERE id = '${transferId}';`,
    ], { encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr)
    assert.equal(check.stdout.trim(), 'completed|0', 'Concurrent receive/cutting invariant failed')
  } finally {
    const cleanup = spawnSync('psql', [
      '-v', 'ON_ERROR_STOP=1',
      process.env.INVENTORY_TRANSFER_TEST_DATABASE_URL,
      '-c', cleanupSql,
    ], { encoding: 'utf8' })
    assert.equal(cleanup.status, 0, cleanup.stderr || 'Concurrency fixture cleanup failed')
  }
}

console.log('inventory transfer integration checks: ok')
