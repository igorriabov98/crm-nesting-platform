'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAnyPermission, requirePermission } from '@/lib/permissions/server'
import { ROUTES } from '@/lib/constants/routes'
import { buildRawMessage, gmailFetch, getAccessToken, type GmailAccountRow } from '@/lib/mail/gmail-api'
import { syncGmailPage, syncGmailThread } from '@/lib/mail/sync'
import type { CrmMailLink, MailFolder, MailLinkInput, MailLinkPreview, MailPageResult, MailThreadDetails } from '@/lib/mail/types'
import { cacheProjectThreadAttachments } from '@/lib/mail/attachments'
import { gmailLabelChanges, type MailMutation } from '@/lib/mail/model'
import { hasPermission } from '@/lib/permissions/resources'
import { deleteMailVaultSecret } from '@/lib/mail/vault'
import { canManageDepartmentRequestTarget, type DepartmentRequestTarget } from '@/lib/department-requests'

const PAGE_SIZE = 50
const mailLinkSchema = z.object({
  kind: z.enum(['thread', 'message']),
  id: z.string().uuid(),
})
const DIRECTORS = ['financial_director', 'commercial_director', 'planning_director']

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

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

export async function getOwnedMailLinkPreview(input: MailLinkInput): Promise<MailLinkPreview | null> {
  const parsed = mailLinkSchema.parse(input)
  const context = await requirePermission('mail', 'view')
  const db = createAdminClient() as any

  if (parsed.kind === 'thread') {
    const { data, error } = await db.from('mail_threads')
      .select('id,subject,snippet,participants,last_message_at,message_count,has_attachments,account:mail_accounts!inner(user_id)')
      .eq('id', parsed.id)
      .maybeSingle()
    const account = relationOne(data?.account as { user_id: string } | { user_id: string }[] | null)
    if (error || !data || account?.user_id !== context.userId) return null
    const participant = Array.isArray(data.participants) ? data.participants[0] : null
    return {
      ...parsed,
      thread_id: data.id,
      subject: data.subject,
      snippet: data.snippet,
      sender: participant?.name || participant?.email || 'Неизвестный отправитель',
      received_at: data.last_message_at,
      message_count: data.message_count,
      has_attachments: data.has_attachments,
    }
  }

  const { data, error } = await db.from('mail_messages')
    .select('id,thread_id,subject,snippet,from_address,from_name,received_at,account:mail_accounts!inner(user_id),attachments:mail_attachments(id)')
    .eq('id', parsed.id)
    .maybeSingle()
  const account = relationOne(data?.account as { user_id: string } | { user_id: string }[] | null)
  if (error || !data || account?.user_id !== context.userId) return null
  return {
    ...parsed,
    thread_id: data.thread_id,
    subject: data.subject,
    snippet: data.snippet,
    sender: data.from_name || data.from_address || 'Неизвестный отправитель',
    received_at: data.received_at,
    message_count: 1,
    has_attachments: (data.attachments || []).length > 0,
  }
}

type RequestAccessRow = {
  created_by: string
  target_department: DepartmentRequestTarget
  factory_id: string | null
}

function canAccessRequest(context: Awaited<ReturnType<typeof requireAnyPermission>>, request: RequestAccessRow) {
  if (request.created_by === context.userId) return true
  if (!hasPermission(context.permissions, 'department_requests', 'view')) return false
  const departmentAllowed = canManageDepartmentRequestTarget({
    target: request.target_department,
    role: context.role,
    memberships: context.permissionDetails.memberships.map((membership) => ({
      departmentName: membership.departmentName,
      positionName: membership.positionName,
    })),
  })
  const factoryAllowed = request.target_department !== 'production'
    || DIRECTORS.includes(context.role)
    || !request.factory_id
    || request.factory_id === context.factoryId
  return departmentAllowed && factoryAllowed
}

async function hasRequestMailAccess(
  db: any,
  context: Awaited<ReturnType<typeof requireAnyPermission>>,
  table: 'department_request_mail_threads' | 'department_request_mail_messages',
  column: 'thread_id' | 'message_id',
  id: string,
) {
  const { data } = await db.from(table)
    .select('request:department_requests!inner(created_by,target_department,factory_id)')
    .eq(column, id)
    .is('unlinked_at', null)
  return (data || []).some((row: { request: RequestAccessRow | RequestAccessRow[] | null }) => {
    const request = relationOne(row.request)
    return request ? canAccessRequest(context, request) : false
  })
}

export async function getMailThread(threadId: string, messageId?: string | null): Promise<MailThreadDetails> {
  const parsedThreadId = z.string().uuid().parse(threadId)
  const parsedMessageId = messageId ? z.string().uuid().parse(messageId) : null
  const context = await requireAnyPermission([
    { resourceKey: 'mail', operation: 'view' },
    { resourceKey: 'product_projects', operation: 'view' },
    { resourceKey: 'department_requests', operation: 'view' },
  ])
  const db = createAdminClient() as any
  const { data: accessRow, error: accessError } = await db.from('mail_threads')
    .select('id,account:mail_accounts!inner(user_id)')
    .eq('id', parsedThreadId)
    .maybeSingle()
  if (accessError || !accessRow) throw new Error('Переписка не найдена')
  const account = Array.isArray(accessRow.account) ? accessRow.account[0] : accessRow.account
  const isOwner = account?.user_id === context.userId
  let hasWholeThreadAccess = false
  let hasSingleMessageAccess = false
  if (!isOwner) {
    if (hasPermission(context.permissions, 'product_projects', 'view')) {
      const [{ data: projectThreadLinks }, { data: projectMessageLinks }] = await Promise.all([
        db.from('product_project_mail_threads').select('id').eq('thread_id', parsedThreadId).is('unlinked_at', null).limit(1),
        parsedMessageId
          ? db.from('product_project_mail_messages').select('id').eq('message_id', parsedMessageId).is('unlinked_at', null).limit(1)
          : Promise.resolve({ data: [] }),
      ])
      hasWholeThreadAccess = (projectThreadLinks || []).length > 0
      hasSingleMessageAccess = (projectMessageLinks || []).length > 0
    }
    if (!hasWholeThreadAccess) {
      hasWholeThreadAccess = await hasRequestMailAccess(
        db, context, 'department_request_mail_threads', 'thread_id', parsedThreadId,
      )
    }
    if (parsedMessageId && !hasSingleMessageAccess) {
      hasSingleMessageAccess = await hasRequestMailAccess(
        db, context, 'department_request_mail_messages', 'message_id', parsedMessageId,
      )
    }
    if (!hasWholeThreadAccess && !(parsedMessageId && hasSingleMessageAccess)) {
      throw new Error('Нет доступа к переписке')
    }
  }

  const { data, error } = await db.from('mail_threads')
    .select(`
      id,gmail_thread_id,subject,snippet,participants,label_ids,last_message_at,message_count,is_unread,is_starred,has_attachments,
      messages:mail_messages(
        id,gmail_message_id,from_address,from_name,to_addresses,cc_addresses,subject,body_text,body_html_sanitized,
        received_at,is_incoming,is_unread,is_starred,
        attachments:mail_attachments(id,file_name,mime_type,size_bytes)
      )
    `)
    .eq('id', parsedThreadId)
    .order('received_at', { referencedTable: 'mail_messages', ascending: true })
    .single()
  if (error) throw new Error(error.message)
  const details = data as MailThreadDetails
  if (parsedMessageId) {
    details.messages = details.messages.filter((message) => message.id === parsedMessageId)
    if (details.messages.length === 0) throw new Error('Письмо не найдено')
    details.message_count = 1
  }
  return details
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

export async function linkMailToProductProject(input: MailLinkInput, productProjectId: string) {
  try {
    const parsed = mailLinkSchema.parse(input)
    const projectId = z.string().uuid().parse(productProjectId)
    const { supabase, userId } = await requirePermission('product_projects', 'manage')
    const table = parsed.kind === 'thread' ? 'product_project_mail_threads' : 'product_project_mail_messages'
    const mailColumn = parsed.kind === 'thread' ? 'thread_id' : 'message_id'
    const { error } = await (supabase as any).from(table).upsert({
      product_project_id: projectId,
      [mailColumn]: parsed.id,
      linked_by: userId,
      linked_at: new Date().toISOString(),
      unlinked_at: null,
      unlinked_by: null,
    }, { onConflict: `product_project_id,${mailColumn}` })
    if (error) throw new Error(error.message)
    if (parsed.kind === 'thread') void cacheProjectThreadAttachments(parsed.id)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось привязать письмо' }
  }
}

export async function linkMailThreadToProductProject(threadId: string, productProjectId: string) {
  return linkMailToProductProject({ kind: 'thread', id: threadId }, productProjectId)
}

export async function unlinkProductProjectMailLink(kind: MailLinkInput['kind'], linkId: string, productProjectId: string) {
  try {
    const parsedKind = z.enum(['thread', 'message']).parse(kind)
    const parsedLinkId = z.string().uuid().parse(linkId)
    const projectId = z.string().uuid().parse(productProjectId)
    const { supabase, userId } = await requirePermission('product_projects', 'manage')
    const table = parsedKind === 'thread' ? 'product_project_mail_threads' : 'product_project_mail_messages'
    const { error } = await (supabase as any).from(table).update({
      unlinked_at: new Date().toISOString(),
      unlinked_by: userId,
    }).eq('id', parsedLinkId).eq('product_project_id', projectId)
    if (error) throw new Error(error.message)
    revalidatePath(`${ROUTES.PRODUCT_PROJECTS}/${projectId}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить связь' }
  }
}

export async function unlinkMailThreadFromProductProject(linkId: string, productProjectId: string) {
  return unlinkProductProjectMailLink('thread', linkId, productProjectId)
}

function threadLinkToCrmLink(row: any): CrmMailLink | null {
  const thread = relationOne(row.thread)
  if (!thread) return null
  const participant = Array.isArray(thread.participants) ? thread.participants[0] : null
  return {
    link_id: row.id,
    kind: 'thread',
    linked_at: row.linked_at,
    preview: {
      kind: 'thread',
      id: thread.id,
      thread_id: thread.id,
      subject: thread.subject,
      snippet: thread.snippet,
      sender: participant?.name || participant?.email || 'Неизвестный отправитель',
      received_at: thread.last_message_at,
      message_count: thread.message_count,
      has_attachments: thread.has_attachments,
    },
  }
}

function messageLinkToCrmLink(row: any): CrmMailLink | null {
  const message = relationOne(row.message)
  const thread = relationOne(message?.thread)
  if (!message || !thread) return null
  return {
    link_id: row.id,
    kind: 'message',
    linked_at: row.linked_at,
    preview: {
      kind: 'message',
      id: message.id,
      thread_id: thread.id,
      subject: message.subject,
      snippet: message.snippet,
      sender: message.from_name || message.from_address || 'Неизвестный отправитель',
      received_at: message.received_at,
      message_count: 1,
      has_attachments: (message.attachments || []).length > 0,
    },
  }
}

async function loadCrmMailLinks(
  threadTable: 'product_project_mail_threads' | 'department_request_mail_threads',
  messageTable: 'product_project_mail_messages' | 'department_request_mail_messages',
  entityColumn: 'product_project_id' | 'department_request_id',
  entityId: string,
) {
  const db = createAdminClient() as any
  const [{ data: threadRows, error: threadError }, { data: messageRows, error: messageError }] = await Promise.all([
    db.from(threadTable)
      .select('id,linked_at,thread:mail_threads(id,subject,snippet,participants,last_message_at,message_count,has_attachments)')
      .eq(entityColumn, entityId)
      .is('unlinked_at', null)
      .order('linked_at', { ascending: false }),
    db.from(messageTable)
      .select('id,linked_at,message:mail_messages(id,subject,snippet,from_address,from_name,received_at,attachments:mail_attachments(id),thread:mail_threads(id))')
      .eq(entityColumn, entityId)
      .is('unlinked_at', null)
      .order('linked_at', { ascending: false }),
  ])
  if (threadError) throw new Error(threadError.message)
  if (messageError) throw new Error(messageError.message)
  return [
    ...(threadRows || []).map(threadLinkToCrmLink),
    ...(messageRows || []).map(messageLinkToCrmLink),
  ].filter((link): link is CrmMailLink => Boolean(link)).sort((a, b) => b.linked_at.localeCompare(a.linked_at))
}

export async function getProductProjectMailLinks(productProjectId: string) {
  const projectId = z.string().uuid().parse(productProjectId)
  await requirePermission('product_projects', 'view')
  const { data: project } = await (createAdminClient() as any).from('product_projects').select('id').eq('id', projectId).maybeSingle()
  if (!project) throw new Error('Проект не найден')
  return loadCrmMailLinks('product_project_mail_threads', 'product_project_mail_messages', 'product_project_id', projectId)
}

export async function getProductProjectMailThreads(productProjectId: string) {
  return getProductProjectMailLinks(productProjectId)
}

export async function getDepartmentRequestMailLinks(requestId: string) {
  const id = z.string().uuid().parse(requestId)
  const context = await requireAnyPermission([
    { resourceKey: 'department_requests', operation: 'view' },
    { resourceKey: 'mail', operation: 'view' },
  ])
  const { data: request } = await (createAdminClient() as any).from('department_requests')
    .select('created_by,target_department,factory_id')
    .eq('id', id)
    .maybeSingle()
  if (!request || !canAccessRequest(context, request as RequestAccessRow)) throw new Error('Запрос не найден')
  return loadCrmMailLinks(
    'department_request_mail_threads', 'department_request_mail_messages', 'department_request_id', id,
  )
}

export async function unlinkDepartmentRequestMailLink(kind: MailLinkInput['kind'], linkId: string, requestId: string) {
  try {
    const parsedKind = z.enum(['thread', 'message']).parse(kind)
    const parsedLinkId = z.string().uuid().parse(linkId)
    const id = z.string().uuid().parse(requestId)
    const { supabase, userId } = await requirePermission('department_requests', 'manage')
    const table = parsedKind === 'thread' ? 'department_request_mail_threads' : 'department_request_mail_messages'
    const { error } = await (supabase as any).from(table).update({
      unlinked_at: new Date().toISOString(),
      unlinked_by: userId,
    }).eq('id', parsedLinkId).eq('department_request_id', id)
    if (error) throw new Error(error.message)
    revalidatePath(`/requests/detail/${id}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить связь' }
  }
}
