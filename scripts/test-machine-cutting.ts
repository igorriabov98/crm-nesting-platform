import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MACHINE_CUTTING_MAX_BYTES,
  machineCuttingUploadPrefix,
  validateMachineCuttingRegistration,
  validateMachineCuttingUploadRequest,
} from '../src/lib/machine-cutting/files'
import { canUploadMachineCutting } from '../src/lib/machine-cutting/access-policy'
import { hasPermission, type PermissionMap } from '../src/lib/permissions/resources'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const validObjectPath = `${machineCuttingUploadPrefix(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
)}1777777777777-33333333-3333-4333-8333-333333333333.zip`

assert.equal(validateMachineCuttingUploadRequest({ fileName: 'CUT.ZIP', fileSize: 1 }).extension, '.zip')
assert.equal(validateMachineCuttingUploadRequest({ fileName: 'cut.RaR', fileSize: 10 }).extension, '.rar')
assert.equal(validateMachineCuttingUploadRequest({ fileName: 'cut.7Z', fileSize: MACHINE_CUTTING_MAX_BYTES }).extension, '.7z')
assert.throws(() => validateMachineCuttingUploadRequest({ fileName: 'empty.zip', fileSize: 0 }), /пустым/u)
assert.throws(() => validateMachineCuttingUploadRequest({ fileName: 'cut.tar', fileSize: 10 }), /ZIP, RAR и 7Z/u)
assert.throws(() => validateMachineCuttingUploadRequest({ fileName: 'cut.zip', fileSize: MACHINE_CUTTING_MAX_BYTES + 1 }), /500 МБ/u)
assert.throws(() => validateMachineCuttingUploadRequest({ fileName: '../cut.zip', fileSize: 10 }), /имя/u)

assert.doesNotThrow(() => validateMachineCuttingRegistration({
  machineId: '11111111-1111-4111-8111-111111111111',
  completionId: '22222222-2222-4222-8222-222222222222',
  objectPath: validObjectPath,
  fileName: 'CUT.ZIP',
  mimeType: 'application/zip',
  fileSize: 10,
}))
assert.throws(() => validateMachineCuttingRegistration({
  machineId: '99999999-9999-4999-8999-999999999999',
  completionId: '22222222-2222-4222-8222-222222222222',
  objectPath: validObjectPath,
  fileName: 'CUT.ZIP',
  mimeType: 'application/zip',
  fileSize: 10,
}), /не принадлежит/u)

const basePolicy = {
  userId: 'author',
  role: 'technologist' as const,
  canManage: true,
  isArchived: false,
  completionCreatedBy: 'author',
}
assert(canUploadMachineCutting(basePolicy), 'Автор завершения с manage должен загружать')
assert(canUploadMachineCutting({ ...basePolicy, userId: 'director', role: 'planning_director' }), 'Директор с manage должен загружать')
assert(!canUploadMachineCutting({ ...basePolicy, userId: 'other' }), 'Другой технолог не должен загружать')
assert(!canUploadMachineCutting({ ...basePolicy, canManage: false }), 'manage должен проверяться независимо')
assert(!canUploadMachineCutting({ ...basePolicy, isArchived: true }), 'Архивная машина должна быть read-only')
assert(!canUploadMachineCutting({ ...basePolicy, completionCreatedBy: null }), 'Без завершения загрузка запрещена')

const viewOnly: PermissionMap = { machine_cutting: { canView: true, canManage: false } }
assert(hasPermission(viewOnly, 'machine_cutting', 'view'))
assert(!hasPermission(viewOnly, 'machine_cutting', 'manage'))

const migration = read('supabase/migrations/20260807190000_machine_cutting_archives.sql')
for (const relation of ['public.machines', 'public.technologist_requests', 'public.technologist_request_completions']) {
  assert(migration.includes(`references ${relation}(id) on delete restrict`), `Нет связи с ${relation}`)
}
assert(migration.includes('before insert or update or delete on public.machine_cutting_archives'))
assert(migration.includes("if tg_op in ('UPDATE', 'DELETE')"))
assert(migration.includes('revoke all on table public.machine_cutting_archives from public, anon, authenticated'))
assert(migration.includes("'nesting_output'"))
assert(migration.includes("'machine_cutting_archive'"))
assert(migration.includes('create or replace function public.file_archive_build_preview'))
assert(/select role, 'machine_cutting', can_view, can_manage[\s\S]*where resource_key = 'nesting'[\s\S]*on conflict \(role, resource_key\) do nothing/u.test(migration))
assert(migration.includes("cross join (values ('head'::text), ('member'::text))"))
assert(/where resource_key = 'nesting'[\s\S]*select scopes\.department_id, scopes\.subject_scope, 'machine_cutting',[\s\S]*on conflict \(department_id, subject_scope, resource_key\) do nothing/u.test(migration))

const action = read('src/lib/actions/machine-cutting.ts')
const uploadRoute = read('src/app/api/machine-cutting/upload-url/route.ts')
const downloadRoute = read('src/app/api/machine-cutting/files/[id]/route.ts')
const directUpload = read('src/lib/machine-cutting/direct-upload-client.ts')
assert(action.includes("requirePermission('machine_cutting', 'view')"))
assert(action.includes("requirePermission('machine_cutting', 'manage')"))
assert(action.includes('context.completion?.id !== parsed.completionId'), 'Регистрация должна оставаться привязанной к последнему завершению')
assert(action.includes(".order('uploaded_at', { ascending: false })"))
assert(action.includes('entered_plasma_minutes,added_plasma_minutes,actual_plasma_minutes'))
assert(uploadRoute.includes('.createSignedUploadUrl(objectPath)'))
assert(uploadRoute.includes("requirePermission('machine_cutting', 'manage')"))
assert(uploadRoute.includes('{ allowArchivedCleanup: true }'), 'Незарегистрированный объект должен очищаться даже после архивации машины')
assert(directUpload.includes('.uploadToSignedUrl(objectPath, token, file'))
assert(downloadRoute.includes("requirePermission('machine_cutting', 'view')"))
assert(downloadRoute.includes('resolveFileResponse'))
assert(downloadRoute.includes("disposition: 'attachment'"))

const tab = read('src/components/features/machines/tabs/TechnologistTab.tsx')
const panel = read('src/components/features/machines/MachineCuttingPanel.tsx')
assert(tab.includes("useState<'layout' | 'cutting'>('layout')"), 'Расстановка должна быть выбрана по умолчанию')
assert(tab.includes('<TabsTrigger') && tab.includes('Расстановка') && tab.includes('Порезка'))
assert(panel.includes('Время плазмы появится после завершения заявки технолога'))
assert(panel.includes('Добавлено +25%'))
assert(panel.includes('Итоговое время'))
assert(panel.includes('sm:grid-cols-3'))
assert(!panel.includes('min-w-['), 'Панель порезки не должна навязывать горизонтальную ширину')

console.log('machine-cutting: OK')
