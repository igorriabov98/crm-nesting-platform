import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from '@/lib/supabase/admin'

export async function resolveNestingFileUri(input: {
  bucket: string
  objectPath: string
  sourceRecordId?: string | null
}) {
  const db = createAdminClient() as any
  let query = db.from('file_archive_assets').select('id')
    .eq('bucket_id', input.bucket).eq('object_path', input.objectPath)
  if (input.sourceRecordId) query = query.eq('source_record_id', input.sourceRecordId)
  const { data, error } = await query.maybeSingle()
  if (!error && data?.id) return `crm-file://${data.id}`
  return `supabase://${input.bucket}/${input.objectPath}`
}
