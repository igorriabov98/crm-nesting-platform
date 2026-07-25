import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from '@/lib/supabase/admin'
import { gmailFetch, type GmailAccountRow } from './gmail-api'

export async function fetchAndCacheAttachment(attachmentId: string) {
  const db = createAdminClient() as any
  const { data: attachment, error } = await db.from('mail_attachments').select(`
    id,gmail_attachment_id,file_name,mime_type,storage_path,
    message:mail_messages!inner(gmail_message_id,account_id)
  `).eq('id', attachmentId).single()
  if (error || !attachment) throw new Error(error?.message || 'Вложение не найдено')
  const message = Array.isArray(attachment.message) ? attachment.message[0] : attachment.message
  if (attachment.storage_path) {
    const { data, error: downloadError } = await createAdminClient().storage
      .from('mail-project-attachments')
      .download(attachment.storage_path)
    if (downloadError || !data) throw new Error(downloadError?.message || 'Не удалось прочитать вложение')
    return { bytes: Buffer.from(await data.arrayBuffer()), attachment }
  }
  const { data: account, error: accountError } = await db.from('mail_accounts')
    .select('*')
    .eq('id', message.account_id)
    .single()
  if (accountError || !account) throw new Error(accountError?.message || 'Почтовый аккаунт не найден')
  const result = await gmailFetch<{ data: string }>(
    account as GmailAccountRow,
    `/messages/${message.gmail_message_id}/attachments/${attachment.gmail_attachment_id}`,
  )
  const bytes = Buffer.from(result.data, 'base64url')
  const storagePath = `${account.id}/${message.gmail_message_id}/${attachment.id}/${attachment.file_name}`
  const { error: uploadError } = await createAdminClient().storage
    .from('mail-project-attachments')
    .upload(storagePath, bytes, { contentType: attachment.mime_type, upsert: true })
  if (!uploadError) {
    await db.from('mail_attachments').update({
      storage_path: storagePath,
      cached_at: new Date().toISOString(),
    }).eq('id', attachment.id)
  }
  return { bytes, attachment }
}

export async function cacheProjectThreadAttachments(threadId: string) {
  const { data } = await (createAdminClient() as any).from('mail_attachments')
    .select('id,message:mail_messages!inner(thread_id)')
    .eq('message.thread_id', threadId)
    .is('storage_path', null)
  const ids: string[] = (data || []).map((item: any) => item.id as string)
  await Promise.allSettled(ids.map((id) => fetchAndCacheAttachment(id)))
}
