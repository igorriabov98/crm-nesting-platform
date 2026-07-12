import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
const parsedUrl = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname) || !parsedUrl.pathname.toLowerCase().includes('test')) {
  throw new Error('Business scrap correction tests only run against a local database whose name contains "test"')
}

const inventory = spawnSync(process.execPath, ['scripts/test-inventory-stock-lifecycle.mjs'], {
  cwd: repoRoot,
  env: process.env,
  encoding: 'utf8',
})
process.stdout.write(inventory.stdout)
process.stderr.write(inventory.stderr)
if (inventory.status !== 0) process.exit(inventory.status ?? 1)

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8')
const sql = [
  read('supabase/tests/business_scrap_correction_prelude.sql'),
  read('supabase/migrations/20260712191527_technologist_business_scrap_corrections.sql'),
  read('supabase/tests/business_scrap_correction_assertions.sql'),
].join('\n\n')
const tempDir = mkdtempSync(path.join(tmpdir(), 'business-scrap-correction-test-'))
const sqlPath = path.join(tempDir, 'test.sql')

try {
  writeFileSync(sqlPath, sql)
  const result = spawnSync('psql', [databaseUrl, '-f', sqlPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log('Business scrap correction integration tests passed')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
