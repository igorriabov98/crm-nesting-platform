import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const parsedUrl = new URL(databaseUrl)
const isLocalHost = parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost'
const isTestDatabase = parsedUrl.pathname.toLowerCase().includes('test')
if (!isLocalHost || !isTestDatabase) {
  throw new Error('Inventory integration tests only run against a local database whose name contains "test"')
}

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8')

function extractFunction(source, qualifiedName) {
  const startNeedle = `CREATE OR REPLACE FUNCTION ${qualifiedName}(`
  const start = source.indexOf(startNeedle)
  if (start < 0) throw new Error(`Function ${qualifiedName} was not found`)

  const bodyStart = source.indexOf('AS $$', start)
  if (bodyStart < 0) throw new Error(`Function body for ${qualifiedName} was not found`)

  const legacyEndNeedle = '$$ LANGUAGE plpgsql SECURITY DEFINER;'
  const modernEndNeedle = '\n$$;'
  const legacyEnd = source.indexOf(legacyEndNeedle, bodyStart + 5)
  const modernEnd = source.indexOf(modernEndNeedle, bodyStart + 5)
  const candidates = [
    legacyEnd >= 0 ? legacyEnd + legacyEndNeedle.length : -1,
    modernEnd >= 0 ? modernEnd + modernEndNeedle.length : -1,
  ].filter((value) => value >= 0)

  if (candidates.length === 0) throw new Error(`Function end for ${qualifiedName} was not found`)
  return source.slice(start, Math.min(...candidates))
}

const factoryMigration = read('supabase/migrations/20260626153000_inventory_factory_scope.sql')
const cutMigration = read('supabase/migrations/90_reapply_cut_reservation_functions.sql')
const chainCordMigration = read('supabase/migrations/20260712125529_normalize_chain_cord_inventory_mm.sql')
const deliveredSupplyCuttingMigration = read('supabase/migrations/20260712152924_auto_reserve_delivered_supply_for_cutting.sql')
const knifeSupplyFutureScrapMigration = read('supabase/migrations/20260714120049_knife_supply_future_scrap.sql')
const archiveScrapMigration = read('supabase/migrations/92_archive_empty_business_scrap_on_unreserve.sql')

const sql = [
  '\\set ON_ERROR_STOP on',
  read('supabase/tests/inventory_stock_lifecycle_setup.sql'),
  'BEGIN;',
  chainCordMigration,
  'COMMIT;',
  extractFunction(factoryMigration, 'public.fn_upsert_inventory_stock'),
  extractFunction(cutMigration, 'fn_insert_cut_reservation'),
  extractFunction(factoryMigration, 'public.fn_reserve_inventory_row_for_machine'),
  extractFunction(factoryMigration, 'public.fn_unreserve_inventory_reservation'),
  archiveScrapMigration,
  deliveredSupplyCuttingMigration,
  knifeSupplyFutureScrapMigration,
  read('supabase/tests/inventory_stock_lifecycle_assertions.sql'),
].join('\n\n')

const tempDir = mkdtempSync(path.join(tmpdir(), 'inventory-stock-test-'))
const sqlPath = path.join(tempDir, 'test.sql')

try {
  writeFileSync(sqlPath, sql)
  const result = spawnSync('psql', [databaseUrl, '-f', sqlPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  process.stdout.write(result.stdout)
  console.log('Inventory stock lifecycle tests passed')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
