import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type DetailingCheckState = {
  ready: boolean
  has_matches: boolean
  decision: 'auto_no_matches' | 'reserved' | 'declined' | null
  message?: string
}

type ReadClient = { rpc(name: 'fn_detailing_request_check_state', args: { p_request_id: string }): Promise<{ data: DetailingCheckState | null; error: { message: string } | null }> }

// The caller must authorize access to this request before reading its readiness.
// Unlike validation during a mutation, viewing never records a decision.
export async function getDetailingCheckState(requestId: string): Promise<DetailingCheckState> {
  const { data, error } = await (createAdminClient() as unknown as ReadClient).rpc('fn_detailing_request_check_state', { p_request_id: requestId })
  if (error) throw new Error(error.message || 'Не удалось проверить деталировку')
  if (!data || typeof data.ready !== 'boolean') throw new Error('Не удалось проверить деталировку')
  return data as DetailingCheckState
}
