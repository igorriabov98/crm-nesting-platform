import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  classifySupabaseMigrations,
  listSupabaseMigrationFiles,
  orderSupabaseMigrationFiles,
} from './supabase-migration-order.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const files = listSupabaseMigrationFiles(migrationsDir)
const ordered = orderSupabaseMigrationFiles(files)

assert.equal(ordered.length, files.length, 'Every SQL migration must be included exactly once')
assert.deepEqual(new Set(ordered), new Set(files), 'Migration ordering must not add or omit files')

const dependencyOrder = [
  '20260818120000_supply_receiving_plan_fact_piece_fields.sql',
  '20260818150000_long_stock_cutting_plan_receipt_recalculation.sql',
  '20260818160000_long_stock_cutting_plan_pdf.sql',
  '20260818170000_supply_long_stock_plan_return.sql',
  '20260819120000_long_stock_cutting_fact.sql',
]
for (let index = 1; index < dependencyOrder.length; index += 1) {
  assert.ok(
    ordered.indexOf(dependencyOrder[index - 1]) < ordered.indexOf(dependencyOrder[index]),
    `${dependencyOrder[index - 1]} must run before ${dependencyOrder[index]}`,
  )
}

const artificialDuplicate = '20260818120000_artificial_duplicate.sql'
assert.throws(
  () => orderSupabaseMigrationFiles([...files, artificialDuplicate]),
  (error) => {
    assert.match(error.message, /duplicate migration versions/u)
    assert.match(error.message, /20260818120000/u)
    assert.match(error.message, new RegExp(artificialDuplicate, 'u'))
    return true
  },
  'An artificial duplicate version must fail before migrations are applied',
)

assert.throws(
  () => orderSupabaseMigrationFiles([...files, '100_artificial_legacy_duplicate.sql']),
  /duplicate migration versions/u,
  'The legacy exception must reject any additional file',
)

const renamedPlan = classifySupabaseMigrations(
  [{ file: '20260818160000_long_stock_cutting_plan_pdf.sql', checksum: 'same-content' }],
  [{ file: '20260818120000_long_stock_cutting_plan_pdf.sql', checksum: 'same-content' }],
)
assert.deepEqual(renamedPlan.pending, [])
assert.deepEqual(renamedPlan.renamed, [
  { file: '20260818160000_long_stock_cutting_plan_pdf.sql', checksum: 'same-content' },
])
assert.deepEqual(
  classifySupabaseMigrations(
    [{ file: '20260818160001_same_content_but_unrelated.sql', checksum: 'same-content' }],
    [{ file: '20260818120000_long_stock_cutting_plan_pdf.sql', checksum: 'same-content' }],
  ).pending,
  [{ file: '20260818160001_same_content_but_unrelated.sql', checksum: 'same-content' }],
)
assert.throws(
  () => classifySupabaseMigrations(
    [{ file: '20260818160000_changed.sql', checksum: 'new-content' }],
    [{ file: '20260818160000_changed.sql', checksum: 'old-content' }],
  ),
  /checksum changed for applied migration/u,
)

console.log(`[supabase-migration-order] validated ${ordered.length} migrations and duplicate rejection`)
