import { NextResponse } from 'next/server'
import { syncDueTransportCostTasks } from '@/lib/actions/transport-cost-tasks'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function isAuthorized(request: Request) {
  const secret = (process.env.TASKS_CRON_SECRET || process.env.CRON_SECRET || '').trim()
  if (!secret) return { ok: false as const, status: 503, error: 'Cron secret is not configured' }

  const authHeader = request.headers.get('authorization')
  const headerSecret = request.headers.get('x-cron-secret')
  const allowed = authHeader === `Bearer ${secret}` || headerSecret === secret
  return allowed
    ? { ok: true as const }
    : { ok: false as const, status: 401, error: 'Unauthorized' }
}

async function syncDueTasks(request: Request) {
  const authorization = isAuthorized(request)
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status })
  }

  try {
    const result = await syncDueTransportCostTasks(createAdminClient())
    for (const machineId of result.machineIds) {
      await dispatchPendingTelegramDeliveries({ machineId, limit: 50 })
    }
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Due tasks] Sync failed:', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return syncDueTasks(request)
}

export async function GET(request: Request) {
  return syncDueTasks(request)
}
