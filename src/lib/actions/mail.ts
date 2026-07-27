'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAnyPermission, requirePermission } from '@/lib/permissions/server'
import { ROUTES } from '@/lib/constants/routes'
import { buildRawMessage, gmailFetch, getAccessToken, type GmailAccountRow } from '@/lib/mail/gmail-api'
import { syncGmailPage, syncGmailThread } from '@/lib/mail/sync'
import type { MailFolder, MailPageResult, MailThreadDetails } from '@/lib/mail/types'
import { cacheProjectThreadAttachments } from '@/lib/mail/attachments'
import { gmailLabelChanges, type MailMutation } from '@/lib/mail/model'
import { hasPermission } from '@/lib/permissions/resources'
import { deleteMailVaultSecret } from '@/lib/mail/vault'

const PAGE_SIZE = 50

async function requireMailAccount() {
  const context = await requirePermission('mail', 'view')
  const { data, error } = await (createAdminClient() as any)
    .from('mail_accounts')
    .select('*')
    .eq('user_id', context.userId)
    .is('disconnected_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { ...context, account: (data || null) as GmailAccountRow | null }
}

export async function getMailAccountStatus() {
  const { account } = await requireMailAccount()
  return {
    connected: Boolean(account),
    emailAddress: account?.email_address || null,
    syncStatus: (account as any)?.sync_status || null,
    syncError: (account as any)?.sync_error || null,
    lastSyncedAt: (account as any)?.last_synced_at || null,
  }
}

export async function getMailLabels() {
  const { account } = await requireMailAccount()
  if (!account) return []
  const { data, error } = await (createAdminClient() as any).from('mail_labels')
    .select('gmail_label_id,name,label_type,messages_unread')
    .eq('account_id', account.id)
    .order('label_type')
    .order('name')
  if (error) throw new Error(error.message)
  return data || []
}

function labelForFolder(folder: MailFolder) {
  return folder === 'ALL' ? null : folder
}

export async function getMailThreads(input?: {
  folder?: MailFolder
  query?: string
  before?: string | null
}): Promise<MailPageResult> {
  const { account } = await requireMailAccount()
  if (!account) return { items: [], nextCursor: null, hasMore: false }
  const folder = input?.folder || 'INBOX'
  let query = (createAdminClient() as any).from('mail_threads')
    .select('id,gmail_thread_id,subject,snippet,participants,label_ids,last_message_at,message_count,is_unread,is_starred,has_attachments')
    .eq('account_id', account.id)
    .order('last_message_at', { ascending: false })
    .limit(PAGE_SIZE + 1)
  const label = labelForFolder(folder)
  if (label) query = query.contains('label_ids', [label])
  if (input?.query?.trim()) {
    query = query.textSearch('search_vector', input.query.trim(), { config: 'simple', type: 'websearch' })
  }
  if (input?.before) query = query.lt('last_message_at', input.before)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data || []
  const hasMore = rows.length > PAGE_SIZE
  const items = rows.slice(0, PAGE_SIZE)
  return {
    items,
    hasMore,
    nextCursor: hasMore ? items.at(-1)?.last_message_at || null : null,
  }
}

export async function loadOlderMail(input: {
  folder: MailFolder
  query?: string
  pageToken?: string | null
  before?: string | null
}) {
  const { account } = await requireMailAccount()
  if (!account) throw new Error('Gmail не подключён')
  const token = input.pageToken ?? (account as any).next_page_token ?? null
  let nextPageToken: string | null = token
  if (token) {
    const result = await syncGmailPage(account, {
      pageToken: token,
      labelId: labelForFolder(input.folder) || undefined,
      query: input.query,
      maxResults: PAGE_SIZE,
    })
    nextPageToken = result.nextPageToken
  }
  const page = await getMailThreads({ folder: input.folder, query: input.query, before: input.before })
  return { items: page.items, nextPageToken, nextCursor: page.nextCursor, hasMore: page.hasMore || Boolean(nextPageToken) }
}

export async function getMailThread(threadId: string): Promise<MailThreadDetails> {
  const context = await requireAnyPermission([
    { resourceKey: 'mail', operation: 'view' },
    { resourceKey: 'product_projects', operation: 'view' },
  ])
  const db = createAdminClient() as any
  const { data: accessRow, error: accessError } = await db.from('mail_threads')
    .select('id,account:mail_accounts!inner(user_id),project_links:product_project_mail_threads(id,unlinked_at)')
    .eq('id', threadId)
    .maybeSingle()
  if (accessError || !accessRow) throw new Error('Переписка не найдена')
  const account = Array.isArray(accessRow.account) ? accessRow.account[0] : accessRow.account
  const isOwner = account?.user_id === context.userId
  const hasActiveProjectLink = (accessRow.project_links || []).some((link: { unlinked_at: string | null }) => !link.unlinked_at)
  const canViewProjects = hasPermission(context.permissions, 'product_projects', 'view')
  if (!isOwner && !(hasActiveProjectLink && canViewProjects)) throw new Error('Нет доступа к переписке')

  const { data, error } = await db.from('mail_threads')
    .select(`
      id,gmail_thread_id,subject,snippet,participants,label_ids,last_message_at,message_count,is_unread,is_starred,has_attachments,
      messages:mail_messages(
        id,gmail_message_id,from_address,from_name,to_addresses,cc_addresses,subject,body_text,body_html_sanitized,
        received_at,is_incoming,is_unread,is_starred,
        attachments:mail_attachments(id,file_name,mime_type,size_bytes)
      )
    `)
    .eq('id', threadId)
    .order('received_at', { referencedTable: 'mail_messages', ascending: true })
    .single()
  if (error) throw new Error(error.message)
  return data as MailThreadDetails
}

export async function mutateMailThread(threadId: string, mutation: MailMutation) {
  const { account } = await requireMailAccount()
  if (!account) return { success: false, error: 'Gmail не подключён' }
  const { data: thread } = await (createAdminClient() as any).from('mail_threads')
    .select('gmail_thread_id')
    .eq('id', threadId)
    .eq('account_id', account.id)
    .maybeSingle()
  if (!thread) return { success: false, error: 'Цепочка не найдена' }
  try {
    await gmailFetch(account, `/threads/${thread.gmail_thread_id}/modify`, {
      method: 'POST',
      body: JSON.stringify(gmailLabelChanges[mutation]),
    })
    await syncGmailThread(account, thread.gmail_thread_id)
    revalidatePath(ROUTES.MAIL)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось изменить письмо' }
  }
}

export async function sendMail(input: {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text: string
  gmailThreadId?: string
  inReplyTo?: string
  references?: string
  draft?: boolean
}) {
  const { account } = await requireMailAccount()
  if (!account) return { success: false, error: 'Gmail не подключён' }
  if (input.to.length === 0 || !input.subject.trim() || !input.text.trim()) {
    return { success: false, error: 'Укажите получателя, тему и текст письма' }
  }
  try {
    const body = {
      message: {
        raw: buildRawMessage(input),
        ...(input.gmailThreadId ? { threadId: input.gmailThreadId } : {}),
      },
    }
    const result = input.draft
      ? await gmailFetch<{ id: string }>(account, '/drafts', { method: 'POST', body: JSON.stringify(body) })
      : await gmailFetch<{ id: string; threadId: string }>(account, '/messages/send', {
        method: 'POST',
        body: JSON.stringify(body.message),
      })
    if (!input.draft && 'threadId' in result && typeof result.threadId === 'string') {
      await syncGmailThread(account, result.threadId)
    }
    revalidatePath(ROUTES.MAIL)
    return { success: true, id: result.id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось отправить письмо' }
  }
}

export async function disconnectGmail() {
  try {
    const { account } = await requireMailAccount()
    if (!account) return { success: true }
    try {
      const token = await getAccessToken(account)
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        cache: 'no-store',
      })
    } catch {
      // Local disconnect must still succeed if Google has already revoked access.
    }
    await Promise.all([
      deleteMailVaultSecret(account.access_token_vault_id),
      deleteMailVaultSecret(account.refresh_token_vault_id),
    ])
    await (createAdminClient() as any).from('mail_accounts').update({
      access_token_vault_id: null,
      refresh_token_vault_id: null,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expires_at: null,
      sync_status: 'disconnected',
      disconnected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', account.id)
    revalidatePath(ROUTES.MAIL)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось отключить Gmail' }
  }
}

export async function linkMailThreadToProductProject(threadId: string, productProjectId: string) {
  try {
    const { supabase, userId } = await requirePermission('product_projects', 'manage')
    const { error } = await (supabase as any).from('product_project_mail_threads').upsert({
      product_project_id: productProjectId,
      thread_id: threadId,
      linked_by: userId,
      linked_at: new Date().toISOString(),
      unlinked_at: null,
      unlinked_by: null,
    }, { onConflict: 'product_project_id,thread_id' })
    if (error) throw new Error(error.message)
    void cacheProjectThreadAttachments(threadId)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${productProjectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось привязать переписку' }
  }
}

export async function unlinkMailThreadFromProductProject(linkId: string, productProjectId: string) {
  try {
    const { supabase, userId } = await requirePermission('product_projects', 'manage')
    const { error } = await (supabase as any).from('product_project_mail_threads').update({
      unlinked_at: new Date().toISOString(),
      unlinked_by: userId,
    }).eq('id', linkId).eq('product_project_id', productProjectId)
    if (error) throw new Error(error.message)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${productProjectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить связь' }
  }
}

export async function getProductProjectMailThreads(productProjectId: string) {
  await requirePermission('product_projects', 'view')
  const { data, error } = await (createAdminClient() as any).from('product_project_mail_threads')
    .select('id,linked_at,thread:mail_threads(id,gmail_thread_id,subject,snippet,participants,last_message_at,message_count,is_unread,has_attachments)')
    .eq('product_project_id', productProjectId)
    .is('unlinked_at', null)
    .order('linked_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}
