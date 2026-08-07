import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSION_RESOURCES, getDefaultPermissionMap, hasPermission } from '../src/lib/permissions/resources'
import { ROUTES } from '../src/lib/constants/routes'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260807120000_file_archive_google_drive.sql')
for (const table of [
  'file_archive_connections', 'file_archive_policies', 'file_archive_runs',
  'file_archive_run_items', 'file_archive_assets', 'file_archive_folders',
]) {
  assert(migration.includes(`create table public.${table}`), `Нет таблицы ${table}`)
  assert(migration.includes(`alter table public.${table} enable row level security`), `RLS не включён для ${table}`)
  assert(migration.includes(`revoke all on table public.${table} from public, anon, authenticated`), `Прямой доступ не закрыт для ${table}`)
}
for (const state of ['local', 'queued', 'copying', 'pending_delete', 'archived', 'failed']) {
  assert(migration.includes(`'${state}'`), `Нет состояния ${state}`)
}
assert(migration.includes('retention_days integer not null default 60'))
assert(migration.includes('local_grace_days integer not null default 7'))
assert(migration.includes('enabled boolean not null default false'))
assert(migration.includes('file_archive_build_preview'))
assert(migration.includes('file_archive_confirm_preview'))
assert(migration.includes('preview_hash'))
assert(migration.includes("'machine_chat'"))
assert(migration.includes("'production_drawing'"))
assert(migration.includes("'nesting_input'"))
assert(migration.includes("'nesting_output'"))

const permission = PERMISSION_RESOURCES.find((resource) => resource.key === 'file_archive_settings')
assert(permission)
assert.equal(permission.defaultHref, ROUTES.ADMIN_FILE_ARCHIVE_SETTINGS)
assert(hasPermission(getDefaultPermissionMap('planning_director'), 'file_archive_settings', 'manage'))
assert(!hasPermission(getDefaultPermissionMap('technologist'), 'file_archive_settings', 'view'))

const oauthStart = read('src/app/api/file-archive/oauth/start/route.ts')
const oauthCallback = read('src/app/api/file-archive/oauth/callback/route.ts')
assert(oauthStart.includes("'https://www.googleapis.com/auth/drive.file'"))
assert(oauthStart.includes("url.searchParams.set('access_type', 'offline')"))
assert(oauthStart.includes("requirePermission('file_archive_settings', 'manage')"))
assert(oauthCallback.includes("db.rpc('file_archive_activate_connection'"), 'Смена диска должна быть атомарной')
assert(migration.includes("set status = 'read_only'"), 'Старое подключение должно становиться read_only')
assert(oauthCallback.includes('storeMailVaultSecret'), 'OAuth токены должны сохраняться в Vault')
assert(!oauthCallback.includes('console.log'))

const resolver = read('src/lib/file-archive/resolver.ts')
assert(resolver.includes("asset?.state === 'archived'"))
assert(resolver.includes('createSignedUrl(input.objectPath, 60)'))
assert(resolver.includes('alt=media'))
assert(resolver.includes('.storage.from(bucket).remove([objectPath])'), 'Ручное удаление должно использовать Storage API')

const worker = read('nesting-service/src/lib/file-archive.ts')
const processConfig = read('nesting-service/ecosystem.config.js')
assert(processConfig.includes("name: 'file-archive-worker'"))
assert(worker.includes("['Без привязки', year, month"))
assert(worker.includes('crmAssetId'))
assert(worker.includes('uploadType=resumable'))
assert(worker.indexOf('verifyDriveFile(connection, asset.drive_file_id') < worker.indexOf('.remove([asset.object_path])'))
assert(worker.includes("state: 'pending_delete'"))
assert(worker.includes("state: 'archived'"))

const storage = read('nesting-service/src/lib/storage.ts')
assert(storage.includes("const CRM_FILE_SCHEME = 'crm-file://'"))
assert(storage.includes('findArchivedAsset(bucket, objectPath)'))
assert(storage.includes("archived?.state === 'archived'"))

for (const route of [
  'src/app/api/products/files/[id]/route.ts',
  'src/app/api/product-projects/files/[id]/route.ts',
  'src/app/api/machine-chat/files/[messageId]/[attachmentId]/route.ts',
  'src/app/api/department-requests/files/[id]/route.ts',
  'src/app/api/products/production-drawings/[id]/route.ts',
  'src/app/api/machine-layout/files/[id]/route.ts',
]) {
  assert(read(route).includes('resolveFileResponse'), `${route} не использует общий resolver`)
}

console.log('file-archive: OK')
