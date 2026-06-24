import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const NOVA_POSHTA_ENDPOINT = 'https://api.novaposhta.ua/v2.0/json/'
const STALE_AFTER_MS = 15 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

type RequestRow = {
  id: string
  factory_id: string
  nova_poshta_ttn: string
  tracking_last_checked_at: string | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeDeliveryDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`

  const localMatch = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})/)
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`
  return null
}

function isStale(value: string | null) {
  if (!value) return true
  const checkedAt = new Date(value).getTime()
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= STALE_AFTER_MS
}

async function trackDocument(apiKey: string, ttn: string) {
  const response = await fetch(NOVA_POSHTA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      modelName: 'TrackingDocument',
      calledMethod: 'getStatusDocuments',
      methodProperties: {
        Documents: [{ DocumentNumber: ttn, Phone: '' }],
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Новая почта вернула HTTP ${response.status}`)
  }

  const result = await response.json()
  if (!result?.success || !Array.isArray(result?.data) || !result.data[0]) {
    const message = Array.isArray(result?.errors) && result.errors.length > 0
      ? result.errors.join('; ')
      : 'Статус отправления не найден'
    throw new Error(message)
  }

  const item = result.data[0]
  return {
    status: String(item.Status || item.StatusDescription || 'Статус не указан'),
    statusCode: item.StatusCode == null ? null : String(item.StatusCode),
    estimatedDeliveryDate: normalizeDeliveryDate(
      item.ScheduledDeliveryDate || item.ActualDeliveryDate || item.DateMoving
    ),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const novaPoshtaApiKey = (Deno.env.get('NOVA_POSHTA_API_KEY') || '').trim()
  const cronSecret = (Deno.env.get('CONSUMABLE_TRACKING_SECRET') || Deno.env.get('CRON_SECRET') || '').trim()

  if (!supabaseUrl || !serviceRoleKey || !novaPoshtaApiKey) {
    return json({ error: 'Tracking integration is not configured' }, 503)
  }

  const service = createClient(supabaseUrl, serviceRoleKey)
  const authHeader = req.headers.get('authorization') || ''
  const headerSecret = req.headers.get('x-cron-secret') || ''
  const { data: vaultCronSecret } = await service
    .rpc('get_consumable_tracking_cron_secret')
    .then(({ data }) => ({ data: typeof data === 'string' ? data : '' }))
    .catch(() => ({ data: '' }))
  const acceptedCronSecrets = [cronSecret, vaultCronSecret].filter(Boolean)
  const isCron = acceptedCronSecrets.some((secret) => (
    authHeader === `Bearer ${secret}` || headerSecret === secret
  )
  )

  let requestId: string | null = null
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    requestId = typeof body?.requestId === 'string' ? body.requestId : null
  }

  let caller: { id: string; role: string; factory_id: string | null } | null = null
  if (!isCron) {
    if (!anonKey || !authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: authData } = await authClient.auth.getUser()
    if (!authData.user) return json({ error: 'Unauthorized' }, 401)

    const { data: profile } = await service
      .from('users')
      .select('id, role, factory_id, is_active')
      .eq('id', authData.user.id)
      .maybeSingle()

    if (!profile || profile.is_active === false) return json({ error: 'Unauthorized' }, 401)
    caller = profile
  }

  let query = service
    .from('consumable_requests')
    .select('id, factory_id, nova_poshta_ttn, tracking_last_checked_at')
    .eq('status', 'delivery')
    .eq('delivery_method', 'nova_poshta')
    .not('nova_poshta_ttn', 'is', null)
    .order('tracking_last_checked_at', { ascending: true, nullsFirst: true })
    .limit(250)

  if (requestId) query = query.eq('id', requestId)
  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  const rows = (data || []) as RequestRow[]
  const allowedRows = rows.filter((row) => {
    if (isCron) return true
    if (!caller) return false
    if (['planning_director', 'financial_director', 'commercial_director', 'supply_manager', 'procurement_head'].includes(caller.role)) {
      return true
    }
    return caller.role === 'production_manager' && caller.factory_id === row.factory_id
  })

  if (!isCron && allowedRows.length === 0) return json({ error: 'Заявка недоступна' }, 403)

  const results: Array<{ requestId: string; updated: boolean; error?: string }> = []
  for (const row of allowedRows) {
    if (!isCron && !isStale(row.tracking_last_checked_at)) {
      results.push({ requestId: row.id, updated: false })
      continue
    }

    try {
      const tracking = await trackDocument(novaPoshtaApiKey, row.nova_poshta_ttn)
      const { error: updateError } = await service
        .from('consumable_requests')
        .update({
          tracking_status: tracking.status,
          tracking_status_code: tracking.statusCode,
          tracking_estimated_delivery_date: tracking.estimatedDeliveryDate,
          tracking_last_checked_at: new Date().toISOString(),
          tracking_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      if (updateError) throw updateError
      results.push({ requestId: row.id, updated: true })
    } catch (trackingError) {
      const message = trackingError instanceof Error ? trackingError.message : String(trackingError)
      await service
        .from('consumable_requests')
        .update({
          tracking_error: message,
          tracking_last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      results.push({ requestId: row.id, updated: false, error: message })
    }
  }

  return json({ ok: true, processed: results.length, results })
})
