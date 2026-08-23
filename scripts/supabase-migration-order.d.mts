export type SupabaseMigrationChecksum = {
  file: string
  checksum: string
}

export const legacyDuplicateMigrationVersions: Map<string, Set<string>>
export const renamedMigrationFiles: Map<string, string>

export function listSupabaseMigrationFiles(migrationsDir: string): string[]

export function orderSupabaseMigrationFiles(
  files: string[],
  options?: { allowedDuplicateVersions?: Map<string, Set<string>> },
): string[]

export function classifySupabaseMigrations(
  localMigrations: SupabaseMigrationChecksum[],
  appliedMigrations: SupabaseMigrationChecksum[],
): {
  pending: SupabaseMigrationChecksum[]
  renamed: SupabaseMigrationChecksum[]
}
