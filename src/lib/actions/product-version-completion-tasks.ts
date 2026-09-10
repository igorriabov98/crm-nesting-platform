import type { Database } from '@/lib/types/database'
import { isProductClientFasteningComplete } from '@/lib/products/product-client-fastening'

type TaskInsert = Database['public']['Tables']['tasks']['Insert']
type TaskUpdate = Database['public']['Tables']['tasks']['Update']
type ProductFasteningType = Database['public']['Enums']['product_fastening_type']
type ProductCompletionType = Database['public']['Enums']['product_completion_type']

type DbResult = { data: unknown; error: { message?: string; code?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  limit: (count: number) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

export type ProductVersionCompletionSnapshot = {
  id: string
  version_number: number
  completion_type: ProductCompletionType | null
}

export type ProductClientFasteningCompletionSnapshot = {
  fastening_types: ProductFasteningType[] | null
  file_types: ProductFasteningType[]
}

export function isProductVersionCompletionFilled(
  version: ProductVersionCompletionSnapshot,
  clientFastening: ProductClientFasteningCompletionSnapshot | null,
) {
  return isProductClientFasteningComplete({
    completionType: version.completion_type,
    fasteningTypes: clientFastening?.fastening_types || [],
    fileTypes: clientFastening?.file_types || [],
  })
}

async function loadClientFasteningCompletion(db: LooseDb, productVersionId: string, clientId: string) {
  const { data: settingData, error: settingError } = await db
    .from('product_version_client_fastening_settings')
    .select('id, fastening_types')
    .eq('product_version_id', productVersionId)
    .eq('client_id', clientId)
    .limit(1)
  if (settingError) throw settingError
  const setting = ((settingData || []) as Array<{ id: string; fastening_types: ProductFasteningType[] }>)[0]
  if (!setting) return null

  const { data: fileData, error: fileError } = await db
    .from('product_version_client_fastening_files')
    .select('fastening_type')
    .eq('setting_id', setting.id)
  if (fileError) throw fileError
  return {
    fastening_types: setting.fastening_types || [],
    file_types: ((fileData || []) as Array<{ fastening_type: ProductFasteningType }>).map((file) => file.fastening_type),
  } satisfies ProductClientFasteningCompletionSnapshot
}

function datePlusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function ensureProductVersionCompletionTask(
  db: LooseDb,
  input: {
    productVersion: ProductVersionCompletionSnapshot
    productName: string
    clientId: string | null | undefined
    machineId: string
    assignedTo: string
  },
) {
  if (!input.clientId) return

  try {
    const clientFastening = await loadClientFasteningCompletion(db, input.productVersion.id, input.clientId)
    if (isProductVersionCompletionFilled(input.productVersion, clientFastening)) {
      await completeProductVersionCompletionTasksIfFilled(db, input.productVersion, input.clientId, clientFastening)
      return
    }

    const [{ data: existing, error: existingError }, { data: clientData, error: clientError }] = await Promise.all([
      db
        .from('tasks')
        .select('id')
        .eq('product_version_id', input.productVersion.id)
        .eq('client_id', input.clientId)
        .eq('task_type', 'product_version_incomplete')
        .eq('assigned_to', input.assignedTo)
        .in('status', ['pending', 'in_progress'])
        .limit(1),
      db.from('clients').select('name').eq('id', input.clientId).limit(1),
    ])

    if (existingError) throw existingError
    if (clientError) throw clientError
    if (((existing || []) as Array<{ id: string }>).length > 0) return

    const clientName = ((clientData || []) as Array<{ name: string }>)[0]?.name || 'Клиент'
    const versionLabel = `v${input.productVersion.version_number}`
    const payload: TaskInsert = {
      machine_id: input.machineId,
      client_id: input.clientId,
      product_version_id: input.productVersion.id,
      assigned_to: input.assignedTo,
      task_type: 'product_version_incomplete',
      title: `Дозаполнить карточку товара: ${input.productName} ${versionLabel} · ${clientName}`,
      description: `Для клиента "${clientName}" в версии ${versionLabel} товара "${input.productName}" не заполнены крепление, обязательный файл таблички или общая комплектация.`,
      status: 'pending',
      start_date: new Date().toISOString().slice(0, 10),
      deadline: datePlusDays(1),
    }

    const { error } = await db.from('tasks').insert(payload)
    if (error) throw error
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') return
    console.error('[product-version-completion-task] Не удалось синхронизировать клиентскую задачу:', error)
  }
}

export async function completeProductVersionCompletionTasksIfFilled(
  db: LooseDb,
  productVersion: ProductVersionCompletionSnapshot,
  clientId: string,
  providedFastening?: ProductClientFasteningCompletionSnapshot | null,
) {
  const clientFastening = providedFastening === undefined
    ? await loadClientFasteningCompletion(db, productVersion.id, clientId)
    : providedFastening
  if (!isProductVersionCompletionFilled(productVersion, clientFastening)) return

  const now = new Date().toISOString()
  const { error } = await db
    .from('tasks')
    .update({
      status: 'completed',
      completed_at: now,
      updated_at: now,
    } satisfies TaskUpdate)
    .eq('product_version_id', productVersion.id)
    .eq('client_id', clientId)
    .eq('task_type', 'product_version_incomplete')
    .in('status', ['pending', 'in_progress'])

  if (error) throw new Error(error.message || 'Не удалось закрыть задачи дозаполнения версии товара')
}

export async function reconcileProductVersionCompletionTasksForClient(
  db: LooseDb,
  input: {
    productVersion: ProductVersionCompletionSnapshot
    productName: string
    clientId: string
  },
) {
  const clientFastening = await loadClientFasteningCompletion(
    db,
    input.productVersion.id,
    input.clientId,
  )
  if (isProductVersionCompletionFilled(input.productVersion, clientFastening)) {
    await completeProductVersionCompletionTasksIfFilled(
      db,
      input.productVersion,
      input.clientId,
      clientFastening,
    )
    return
  }

  const { data: itemData, error: itemError } = await db
    .from('machine_items')
    .select('machine_id')
    .eq('product_version_id', input.productVersion.id)
  if (itemError) throw itemError
  const machineIds = Array.from(new Set(
    ((itemData || []) as Array<{ machine_id: string }>).map((item) => item.machine_id),
  ))
  if (machineIds.length === 0) return

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('id, client_id, created_by, is_archived')
    .in('id', machineIds)
    .eq('client_id', input.clientId)
  if (machineError) throw machineError

  const machines = (machineData || []) as Array<{
    id: string
    client_id: string | null
    created_by: string | null
    is_archived: boolean | null
  }>
  const firstMachineByOwner = new Map<string, string>()
  for (const machine of machines) {
    if (machine.is_archived || !machine.created_by) continue
    if (!firstMachineByOwner.has(machine.created_by)) {
      firstMachineByOwner.set(machine.created_by, machine.id)
    }
  }

  for (const [assignedTo, machineId] of firstMachineByOwner) {
    await ensureProductVersionCompletionTask(db, {
      productVersion: input.productVersion,
      productName: input.productName,
      clientId: input.clientId,
      machineId,
      assignedTo,
    })
  }
}

export async function reconcileProductVersionCompletionTasksForOrderClients(
  db: LooseDb,
  input: {
    productVersion: ProductVersionCompletionSnapshot
    productName: string
  },
) {
  const { data: itemData, error: itemError } = await db
    .from('machine_items')
    .select('machine_id')
    .eq('product_version_id', input.productVersion.id)
  if (itemError) throw itemError
  const machineIds = Array.from(new Set(
    ((itemData || []) as Array<{ machine_id: string }>).map((item) => item.machine_id),
  ))
  if (machineIds.length === 0) return

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('client_id, is_archived')
    .in('id', machineIds)
  if (machineError) throw machineError
  const clientIds = Array.from(new Set(
    ((machineData || []) as Array<{ client_id: string | null; is_archived: boolean | null }>)
      .filter((machine) => !machine.is_archived)
      .map((machine) => machine.client_id)
      .filter((clientId): clientId is string => Boolean(clientId)),
  ))

  for (const clientId of clientIds) {
    await reconcileProductVersionCompletionTasksForClient(db, {
      ...input,
      clientId,
    })
  }
}
