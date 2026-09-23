import 'server-only'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/permissions/server'
import { assertFactoryAccess } from '@/lib/permissions/factory-scope'
import { ROUTES } from '@/lib/constants/routes'
import { buildSheetImportTemplate, parseSheetImportXlsx } from './sheet-import-xlsx'
import { SHEET_IMPORT_MAX_BYTES, type SheetImportCatalog, type SheetImportPreview, type SheetImportResult } from './sheet-import-types'

class ImportError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type RpcClient = { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> }

async function rpc<T>(client: RpcClient, name: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new ImportError(error.message, error.code === '42501' ? 403 : error.code === '40001' ? 409 : 400)
  if (!data) throw new ImportError('CRM не вернула результат импорта', 500)
  return data as T
}

function failure(error: unknown) {
  const status = error instanceof ImportError ? error.status
    : error instanceof Error && error.name === 'PermissionDeniedError' ? 403
      : error instanceof Error && error.name === 'AuthRequiredError' ? 401 : 400
  return Response.json({ error: error instanceof Error ? error.message : 'Не удалось обработать импорт' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function sheetImportTemplateResponse() {
  try {
    const { supabase } = await requirePermission('inventory', 'manage')
    const catalog = await rpc<SheetImportCatalog>(supabase as unknown as RpcClient, 'fn_sheet_inventory_import_catalog')
    const bytes = await buildSheetImportTemplate(catalog)
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="sheet-inventory-template.xlsx"',
      'Cache-Control': 'private, no-store',
    } })
  } catch (error) { return failure(error) }
}

export async function sheetImportUploadResponse(request: Request, commit: boolean) {
  try {
    const access = await requirePermission('inventory', 'manage')
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) throw new ImportError('Недопустимый источник запроса', 403)
    // Stream with a hard cap: do not buffer an unlimited multipart request.
    const reader = request.body?.getReader()
    if (!reader) throw new ImportError('Выберите файл')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > SHEET_IMPORT_MAX_BYTES + 16_384) throw new ImportError('Файл превышает 3 МБ', 413)
        chunks.push(part.value)
      }
    } finally { await reader.cancel() }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData()
    const factoryId = String(form.get('factoryId') || '')
    if (!UUID.test(factoryId)) throw new ImportError('Выберите завод склада')
    try { assertFactoryAccess(access, 'inventory', 'manage', factoryId) } catch { throw new ImportError('Нет права пополнять склад выбранного завода', 403) }
    const file = form.get('file')
    if (!(file instanceof File)) throw new ImportError('Выберите файл .xlsx')
    if (file.name.length > 255) throw new ImportError('Имя файла слишком длинное')
    const parsed = await parseSheetImportXlsx(Buffer.from(await file.arrayBuffer()), file.name)
    const client = access.supabase as unknown as RpcClient
    if (!commit) {
      const preview = parsed.rows.length ? await rpc<SheetImportPreview>(client, 'fn_preview_sheet_inventory_import', { p_factory_id: factoryId, p_rows: parsed.rows })
        : { rows: [], errors: [], quantity: 0, weightKg: null, pendingDensityGrades: [], fingerprint: '', previewHash: '', previous: null, newMaterials: 0, newGrades: 0, newVariants: 0 }
      return Response.json({ ...preview, errors: [...parsed.errors, ...preview.errors].sort((a,b) => a.row - b.row), skippedRows: parsed.skippedRows }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (parsed.errors.length) return Response.json({ error: 'Исправьте ошибки файла', errors: parsed.errors }, { status: 400 })
    const operationId = String(form.get('operationId') || '')
    const previewHash = String(form.get('previewHash') || '')
    const previousId = String(form.get('previousImportId') || '')
    if (!UUID.test(operationId) || !/^[a-f0-9]{64}$/.test(previewHash) || (previousId && !UUID.test(previousId))) throw new ImportError('Сначала проверьте файл')
    const result = await rpc<SheetImportResult>(client, 'fn_commit_sheet_inventory_import', {
      p_factory_id: factoryId, p_rows: parsed.rows, p_file_name: file.name,
      p_operation_id: operationId, p_preview_hash: previewHash, p_previous_import_id: previousId || null,
    })
    for (const path of [ROUTES.INVENTORY, ROUTES.INVENTORY_HISTORY, ROUTES.SUPPLY_ORDERS, ROUTES.TASKS, ROUTES.ADMIN_MATERIALS, ROUTES.STEEL_TYPES]) revalidatePath(path)
    revalidatePath('/inventory/[materialId]/history', 'page')
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
