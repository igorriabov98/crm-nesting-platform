import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

type RequestNumbering = { request_id: string; request_number: number; revision_numbers: Record<string, number> }

type ReadClient = { rpc(name: 'fn_technologist_request_numbers', args: { p_request_ids: string[] }): Promise<{ data: RequestNumbering[] | null; error: { message: string } | null }> }

// Call only after authorizing the request IDs. Display numbers are kept separate
// from the per-request revision indexes used by the approval lifecycle.
export async function getRequestNumbers(requestIds: string[]) {
  if (!requestIds.length) return new Map<string, RequestNumbering>()
  const { data, error } = await (createAdminClient() as unknown as ReadClient).rpc('fn_technologist_request_numbers', { p_request_ids: requestIds })
  if (error) throw new Error(error.message || 'Не удалось загрузить номера заявок')
  const rows = data || []
  const numbers = new Map(rows.map(row => [row.request_id, row]))
  if (requestIds.some(id => !numbers.has(id))) throw new Error('Номер заявки не найден')
  return numbers
}
