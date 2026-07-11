import type { Database } from '@/lib/types/database'

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
  fastening_types: ProductFasteningType[] | null
  completion_type: ProductCompletionType | null
}

export function isProductVersionCompletionFilled(version: ProductVersionCompletionSnapshot) {
  return (version.fastening_types || []).length > 0 && Boolean(version.completion_type)
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
    machineId: string
    assignedTo: string
  },
) {
  if (isProductVersionCompletionFilled(input.productVersion)) return

  try {
    const { data: existing, error: existingError } = await db
      .from('tasks')
      .select('id')
      .eq('product_version_id', input.productVersion.id)
      .eq('task_type', 'product_version_incomplete')
      .eq('assigned_to', input.assignedTo)
      .in('status', ['pending', 'in_progress'])
      .limit(1)

    if (existingError) throw existingError
    if (((existing || []) as Array<{ id: string }>).length > 0) return

    const versionLabel = `v${input.productVersion.version_number}`
    const payload: TaskInsert = {
      machine_id: input.machineId,
      product_version_id: input.productVersion.id,
      assigned_to: input.assignedTo,
      task_type: 'product_version_incomplete',
      title: `Дозаполнить карточку товара: ${input.productName} ${versionLabel}`,
      description: `В версии ${versionLabel} товара "${input.productName}" не заполнены крепление или комплектация. Заполните эти поля в карточке товара.`,
      status: 'pending',
      start_date: new Date().toISOString().slice(0, 10),
      deadline: datePlusDays(1),
    }

    const { error } = await db.from('tasks').insert(payload)
    if (error) throw error
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') return
    console.error('[product-version-completion-task] Не удалось создать задачу дозаполнения версии товара:', error)
  }
}

export async function completeProductVersionCompletionTasksIfFilled(
  db: LooseDb,
  productVersion: ProductVersionCompletionSnapshot,
) {
  if (!isProductVersionCompletionFilled(productVersion)) return

  const now = new Date().toISOString()
  const { error } = await db
    .from('tasks')
    .update({
      status: 'completed',
      completed_at: now,
      updated_at: now,
    } satisfies TaskUpdate)
    .eq('product_version_id', productVersion.id)
    .eq('task_type', 'product_version_incomplete')
    .in('status', ['pending', 'in_progress'])

  if (error) throw new Error(error.message || 'Не удалось закрыть задачи дозаполнения версии товара')
}
