import type { Database } from '@/lib/types/database'

type DbError = { message?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (name: string, args?: Record<string, never>) => Promise<DbResult>
}

export async function syncDueCustomsClearanceTasks(client: unknown) {
  const db = client as LooseDb
  const { data, error } = await db.rpc('fn_sync_due_customs_clearance_tasks')
  if (error) {
    const message = error.message || 'Не удалось синхронизировать задачи затамаживания'
    if (message.includes('Could not find the function') || message.includes('does not exist')) {
      return { checked: 0, synced: 0, machineIds: [] as string[], skippedReason: 'Миграция затамаживания ещё не применена' }
    }
    throw new Error(message)
  }

  const { data: tasks, error: tasksError } = await db
    .from('tasks')
    .select('machine_id')
    .eq('task_type', 'customs_clearance' satisfies Database['public']['Enums']['task_type'])
    .in('status', ['pending', 'in_progress'])
  if (tasksError) throw new Error(tasksError.message || 'Не удалось получить задачи затамаживания')

  const machineIds = Array.from(new Set(
    ((tasks || []) as Array<{ machine_id?: string | null }>)
      .map((row) => row.machine_id)
      .filter((id): id is string => Boolean(id)),
  ))
  return {
    checked: typeof data === 'number' ? data : 0,
    synced: machineIds.length,
    machineIds,
    skippedReason: null,
  }
}
