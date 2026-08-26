import { createAdminClient } from '@/lib/supabase/admin'
import { removeFileObject } from '@/lib/file-archive/resolver'
/* eslint-disable @typescript-eslint/no-explicit-any */

type CleanupRow = {
  id: string
  bucket_id: string
  object_path: string
  file_name: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempt_count: number
}

async function main() {
  const args = new Map(
    process.argv.slice(2).map((argument) => {
      const [key, ...value] = argument.split('=')
      return [key, value.join('=') || 'true']
    }),
  )
  const fingerprint = args.get('--fingerprint') || ''
  const execute = args.get('--execute') === 'true'
  const confirmation = args.get('--confirm') || ''
  const limit = Math.min(500, Math.max(1, Number(args.get('--limit') || 100)))

  if (!/^[0-9a-f]{32}$/.test(fingerprint)) {
    throw new Error('Передайте --fingerprint=<32 hex> из подтверждённого preflight')
  }
  if (!Number.isSafeInteger(limit)) throw new Error('--limit должен быть положительным целым числом')
  if (execute && confirmation !== 'DELETE_KNIFE_RESET_STORAGE_OBJECTS') {
    throw new Error('Для удаления передайте --confirm=DELETE_KNIFE_RESET_STORAGE_OBJECTS')
  }

  const admin = createAdminClient()
  const db = admin as any

  const { data, error } = await db.from('knife_reset_storage_cleanup_queue')
    .select('id,bucket_id,object_path,file_name,status,attempt_count')
    .eq('reset_fingerprint', fingerprint)
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  const rows = (data || []) as CleanupRow[]

  if (!execute) {
    console.log(JSON.stringify({ fingerprint, pendingObjects: rows.length, objects: rows }, null, 2))
    console.log('Dry run only. No storage object or queue row was changed.')
    return
  }

  let completed = 0
  let failed = 0
  for (const row of rows) {
    const startedAt = new Date().toISOString()
    const { error: claimError } = await db.from('knife_reset_storage_cleanup_queue').update({
      status: 'processing',
      attempt_count: Number(row.attempt_count || 0) + 1,
      last_attempt_at: startedAt,
      last_error: null,
    }).eq('id', row.id)
    if (claimError) throw new Error(claimError.message)

    try {
      await removeFileObject(row.bucket_id, row.object_path)
      const { error: completeError } = await db.from('knife_reset_storage_cleanup_queue').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', row.id)
      if (completeError) throw new Error(completeError.message)
      completed += 1
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : 'Неизвестная ошибка удаления файла'
      const { error: failureError } = await db.from('knife_reset_storage_cleanup_queue').update({
        status: 'failed',
        last_error: message,
      }).eq('id', row.id)
      if (failureError) throw new Error(`${message}; queue update: ${failureError.message}`)
      failed += 1
      console.error(`${row.bucket_id}/${row.object_path}: ${message}`)
    }
  }

  console.log(JSON.stringify({ fingerprint, attempted: rows.length, completed, failed }, null, 2))
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
