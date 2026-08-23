import { readdirSync } from 'node:fs'

const migrationNamePattern = /^([0-9]+)_(.+)\.sql$/u

// These files predate the timestamp migration convention and are already tracked
// in production by their complete file names. Renaming them would replay applied
// SQL through the repository ledger. No additional file may reuse this version.
export const legacyDuplicateMigrationVersions = new Map([
  ['100', new Set([
    '100_allow_multiple_technologist_requests.sql',
    '100_auto_assign_material_undefined_agenda.sql',
    '100_finance_supply_permissions.sql',
    '100_manual_production_stage_overdue.sql',
  ])],
])

// Production tracks historical migrations by complete file name. Keep explicit
// aliases so a pure rename is not replayed, without treating unrelated files
// with coincidentally identical SQL as already applied.
export const renamedMigrationFiles = new Map([
  ['20260701120000_production_month_plan_status.sql', '111_production_month_plan_status.sql'],
  ['20260818160000_long_stock_cutting_plan_pdf.sql', '20260818120000_long_stock_cutting_plan_pdf.sql'],
  ['20260818170000_supply_long_stock_plan_return.sql', '20260818150000_supply_long_stock_plan_return.sql'],
])

export function listSupabaseMigrationFiles(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
}

export function orderSupabaseMigrationFiles(
  files,
  { allowedDuplicateVersions = legacyDuplicateMigrationVersions } = {},
) {
  const parsed = files.map(parseMigrationName)
  assertUniqueMigrationVersions(parsed, allowedDuplicateVersions)

  return parsed
    .sort((left, right) => {
      const leftVersion = BigInt(left.version)
      const rightVersion = BigInt(right.version)
      if (leftVersion < rightVersion) return -1
      if (leftVersion > rightVersion) return 1
      return left.file.localeCompare(right.file, 'en')
    })
    .map(({ file }) => file)
}

export function classifySupabaseMigrations(localMigrations, appliedMigrations) {
  const appliedByName = new Map(appliedMigrations.map((migration) => [migration.file, migration.checksum]))
  const pending = []
  const renamed = []

  for (const migration of localMigrations) {
    const appliedChecksum = appliedByName.get(migration.file)
    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(`[supabase-migrations] checksum changed for applied migration ${migration.file}`)
      }
      continue
    }
    const previousFile = renamedMigrationFiles.get(migration.file)
    const previousChecksum = previousFile ? appliedByName.get(previousFile) : undefined
    if (previousChecksum !== undefined) {
      if (previousChecksum !== migration.checksum) {
        throw new Error(`[supabase-migrations] checksum changed while renaming ${previousFile}`)
      }
      renamed.push(migration)
      continue
    }
    pending.push(migration)
  }

  return { pending, renamed }
}

function parseMigrationName(file) {
  const match = migrationNamePattern.exec(file)
  if (!match) {
    throw new Error(
      `[supabase-migrations] invalid migration file name ${file}; expected <numeric-version>_<name>.sql`,
    )
  }
  return { file, version: match[1] }
}

function assertUniqueMigrationVersions(parsed, allowedDuplicateVersions) {
  const filesByVersion = new Map()
  for (const migration of parsed) {
    const files = filesByVersion.get(migration.version) ?? []
    files.push(migration.file)
    filesByVersion.set(migration.version, files)
  }

  const violations = []
  for (const [version, files] of filesByVersion) {
    if (files.length < 2) continue
    const allowedFiles = allowedDuplicateVersions.get(version)
    const actualFiles = new Set(files)
    const isExactLegacySet = allowedFiles
      && actualFiles.size === allowedFiles.size
      && [...actualFiles].every((file) => allowedFiles.has(file))
    if (!isExactLegacySet) {
      violations.push(`${version}: ${files.sort().join(', ')}`)
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `[supabase-migrations] duplicate migration versions:\n${violations.map((value) => `- ${value}`).join('\n')}`,
    )
  }
}
