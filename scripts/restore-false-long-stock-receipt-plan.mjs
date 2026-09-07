import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (!argument.startsWith('--')) continue
  const [name, inlineValue] = argument.split('=', 2)
  const value = inlineValue ?? (process.argv[index + 1]?.startsWith('--') ? 'true' : process.argv[++index])
  args.set(name, value ?? 'true')
}

const requestItemId = args.get('--request-item-id')
const explicitVersionId = args.get('--version-id')
const explicitActorId = args.get('--actor-id')
const apply = args.get('--apply') === 'true'

if (!requestItemId && !explicitVersionId) {
  throw new Error('Укажите --request-item-id или --version-id')
}

const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let versionId = explicitVersionId
if (!versionId) {
  const { data: item, error: itemError } = await db
    .from('long_stock_cutting_plan_items')
    .select('plan_id')
    .eq('request_item_id', requestItemId)
    .eq('link_state', 'active')
    .maybeSingle()
  if (itemError) throw itemError
  if (!item) throw new Error('Активная позиция карты раскроя не найдена')

  const { data: version, error: versionError } = await db
    .from('long_stock_cutting_plan_versions')
    .select('id, invalidated_by, version_number, status')
    .eq('plan_id', item.plan_id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (versionError) throw versionError
  if (!version) throw new Error('Версия карты раскроя не найдена')
  versionId = version.id
}

const { data: version, error: versionError } = await db
  .from('long_stock_cutting_plan_versions')
  .select('id, invalidated_by, version_number, status')
  .eq('id', versionId)
  .single()
if (versionError) throw versionError

const actorId = explicitActorId || version.invalidated_by
if (!actorId) throw new Error('Не удалось определить исполнителя; укажите --actor-id')

const dryRun = await callRestore(true)
process.stdout.write(`${JSON.stringify({ phase: 'dry_run', result: dryRun }, null, 2)}\n`)

if (apply) {
  if (dryRun?.eligible !== true) {
    throw new Error('Восстановление отменено: dry-run вернул eligible=false')
  }
  const restored = await callRestore(false)
  process.stdout.write(`${JSON.stringify({ phase: 'restore', result: restored }, null, 2)}\n`)
}

async function callRestore(dryRunMode) {
  const { data, error } = await db.rpc(
    'fn_restore_false_receipt_invalidated_long_stock_plan_v1',
    {
      p_version_id: versionId,
      p_actor: actorId,
      p_dry_run: dryRunMode,
    },
  )
  if (error) throw error
  return data
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Отсутствует обязательная переменная ${name}`)
  return value
}
