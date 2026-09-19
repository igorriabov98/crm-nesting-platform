import { synchronizeUserAuth } from '@/lib/organization/auth-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return Response.json({ error: 'Cron secret is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await synchronizeUserAuth()
    return Response.json({ ok: result.pending === 0, ...result }, { status: result.pending ? 503 : 200 })
  } catch {
    return Response.json({ error: 'Auth synchronization will be retried' }, { status: 503 })
  }
}
