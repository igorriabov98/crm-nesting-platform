import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  decodeBase64Url,
  gmailFetch,
  sanitizeMailHtml,
  type GmailAccountRow,
} from './gmail-api'
import { cacheProjectThreadAttachments } from './attachments'

type GmailHeader = { name: string; value: string }
type GmailPart = {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailPart[]
  headers?: GmailHeader[]
}
type GmailMessage = {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}
type GmailThread = {
  id: string
  historyId?: string
  messages?: GmailMessage[]
}

function header(part: GmailPart | undefined, name: string) {
  return part?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function parseAddress(value: string) {
  const match = value.match(/^(?:"?([^"]*)"?\s)?<?([^<>\s,]+@[^<>\s,]+)>?$/)
  return { name: match?.[1]?.trim() || undefined, email: (match?.[2] || value).trim() }
}

function splitAddresses(value: string) {
  if (!value) return []
  return value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => parseAddress(item).email).filter(Boolean)
}

function walkParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) return []
  return [part, ...(part.parts || []).flatMap(walkParts)]
}

function bodies(message: GmailMessage) {
  const parts = walkParts(message.payload)
  const textPart = parts.find((part) => part.mimeType === 'text/plain' && part.body?.data)
  const htmlPart = parts.find((part) => part.mimeType === 'text/html' && part.body?.data)
  const text = decodeBase64Url(textPart?.body?.data || (message.payload?.mimeType === 'text/plain' ? message.payload.body?.data : ''))
  const html = decodeBase64Url(htmlPart?.body?.data || (message.payload?.mimeType === 'text/html' ? message.payload.body?.data : ''))
  return { text: text || null, html: html ? sanitizeMailHtml(html) : null }
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let index = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++]
      await work(current)
    }
  }))
}

export async function syncGmailThread(account: GmailAccountRow, gmailThreadId: string) {
  const gmailThread = await gmailFetch<GmailThread>(
    account,
    `/threads/${encodeURIComponent(gmailThreadId)}?format=full`,
  )
  const messages = gmailThread.messages || []
  if (messages.length === 0) return null

  const db = createAdminClient() as any
  const last = [...messages].sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0)).at(-1)!
  const labelIds = Array.from(new Set(messages.flatMap((message) => message.labelIds || [])))
  const participants = Array.from(new Map(messages.flatMap((message) => {
    const values = [
      parseAddress(header(message.payload, 'From')),
      ...splitAddresses(header(message.payload, 'To')).map((email) => ({ email })),
    ]
    return values.map((value) => [value.email.toLowerCase(), value])
  })).values())
  const hasAttachments = messages.some((message) =>
    walkParts(message.payload).some((part) => Boolean(part.filename && part.body?.attachmentId))
  )

  const { data: threadRow, error: threadError } = await db.from('mail_threads').upsert({
    account_id: account.id,
    gmail_thread_id: gmailThread.id,
    subject: header(last.payload, 'Subject') || '(Без темы)',
    snippet: last.snippet || '',
    participants,
    label_ids: labelIds,
    last_message_at: new Date(Number(last.internalDate || Date.now())).toISOString(),
    message_count: messages.length,
    is_unread: labelIds.includes('UNREAD'),
    is_starred: labelIds.includes('STARRED'),
    has_attachments: hasAttachments,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id,gmail_thread_id' }).select('id').single()
  if (threadError) throw new Error(threadError.message)

  let newestMessageRowId: string | null = null
  for (const message of messages) {
    const messageLabels = message.labelIds || []
    const content = bodies(message)
    const from = parseAddress(header(message.payload, 'From'))
    const receivedAt = new Date(Number(message.internalDate || Date.now())).toISOString()
    const { data: messageRow, error: messageError } = await db.from('mail_messages').upsert({
      account_id: account.id,
      thread_id: threadRow.id,
      gmail_message_id: message.id,
      gmail_thread_id: message.threadId,
      internet_message_id: header(message.payload, 'Message-ID') || null,
      from_address: from.email,
      from_name: from.name || null,
      to_addresses: splitAddresses(header(message.payload, 'To')),
      cc_addresses: splitAddresses(header(message.payload, 'Cc')),
      bcc_addresses: splitAddresses(header(message.payload, 'Bcc')),
      subject: header(message.payload, 'Subject') || '(Без темы)',
      snippet: message.snippet || '',
      body_text: content.text,
      body_html_sanitized: content.html,
      label_ids: messageLabels,
      received_at: receivedAt,
      is_incoming: messageLabels.includes('INBOX'),
      is_unread: messageLabels.includes('UNREAD'),
      is_starred: messageLabels.includes('STARRED'),
      body_cached_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id,gmail_message_id' }).select('id').single()
    if (messageError) throw new Error(messageError.message)
    if (message.id === last.id) newestMessageRowId = messageRow.id

    const attachments = walkParts(message.payload).filter((part) => part.filename && part.body?.attachmentId)
    if (attachments.length > 0) {
      const { error } = await db.from('mail_attachments').upsert(attachments.map((part) => ({
        message_id: messageRow.id,
        gmail_attachment_id: part.body!.attachmentId!,
        file_name: part.filename!,
        mime_type: part.mimeType || 'application/octet-stream',
        size_bytes: part.body?.size || 0,
      })), { onConflict: 'message_id,gmail_attachment_id' })
      if (error) throw new Error(error.message)
    }
  }

  return {
    threadId: threadRow.id,
    newestMessageRowId,
    newestMessage: last,
    historyId: gmailThread.historyId || null,
  }
}

export async function syncGmailPage(
  account: GmailAccountRow,
  options: { pageToken?: string | null; labelId?: string; query?: string; maxResults?: number } = {},
) {
  const params = new URLSearchParams({
    maxResults: String(options.maxResults || 50),
    ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    ...(options.labelId && options.labelId !== 'ALL' ? { labelIds: options.labelId } : {}),
    ...(options.query ? { q: options.query } : {}),
  })
  const page = await gmailFetch<{
    threads?: Array<{ id: string }>
    nextPageToken?: string
    resultSizeEstimate?: number
  }>(account, `/threads?${params}`)
  const threadRefs = page.threads || []
  await mapLimit(threadRefs, 8, async (thread) => {
    await syncGmailThread(account, thread.id)
  })
  await (createAdminClient() as any).from('mail_accounts').update({
    sync_status: 'ready',
    sync_error: null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    next_page_token: page.nextPageToken || null,
  }).eq('id', account.id)
  return { nextPageToken: page.nextPageToken || null, loaded: threadRefs.length }
}

export async function syncGmailLabels(account: GmailAccountRow) {
  const result = await gmailFetch<{
    labels?: Array<{
      id: string
      name: string
      type?: 'system' | 'user'
      color?: Record<string, string>
      messagesTotal?: number
      messagesUnread?: number
    }>
  }>(account, '/labels')
  const labels = result.labels || []
  if (labels.length > 0) {
    const { error } = await (createAdminClient() as any).from('mail_labels').upsert(labels.map((label) => ({
      account_id: account.id,
      gmail_label_id: label.id,
      name: label.name,
      label_type: label.type || 'user',
      color: label.color || null,
      messages_total: label.messagesTotal ?? null,
      messages_unread: label.messagesUnread ?? null,
      updated_at: new Date().toISOString(),
    })), { onConflict: 'account_id,gmail_label_id' })
    if (error) throw new Error(error.message)
  }
  return labels
}

export async function startGmailWatch(account: GmailAccountRow) {
  const { pubsubTopic } = await import('./config').then(({ requireMailSettings }) => requireMailSettings())
  const result = await gmailFetch<{ historyId: string; expiration: string }>(account, '/watch', {
    method: 'POST',
    body: JSON.stringify({ topicName: pubsubTopic, labelIds: ['INBOX'], labelFilterBehavior: 'include' }),
  })
  await (createAdminClient() as any).from('mail_accounts').update({
    gmail_history_id: result.historyId,
    watch_expires_at: new Date(Number(result.expiration)).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', account.id)
  return result
}

export async function processGmailHistory(account: GmailAccountRow, incomingHistoryId: string) {
  const startHistoryId = account.gmail_history_id
  if (!startHistoryId) {
    await syncGmailPage(account, { maxResults: 50, labelId: 'INBOX' })
    return
  }
  const threadIdSet = new Set<string>()
  let nextPageToken: string | null = null
  let latestHistoryId = incomingHistoryId
  try {
    do {
      const params: URLSearchParams = new URLSearchParams({
        startHistoryId,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
        ...(nextPageToken ? { pageToken: nextPageToken } : {}),
      })
      const history: {
        history?: Array<{ messagesAdded?: Array<{ message: { threadId: string } }> }>
        historyId?: string
        nextPageToken?: string
      } = await gmailFetch(account, `/history?${params}`)
      for (const item of history.history || []) {
        for (const added of item.messagesAdded || []) threadIdSet.add(added.message.threadId)
      }
      latestHistoryId = history.historyId || latestHistoryId
      nextPageToken = history.nextPageToken || null
    } while (nextPageToken)
  } catch {
    await syncGmailPage(account, { maxResults: 50, labelId: 'INBOX' })
    await (createAdminClient() as any).from('mail_accounts').update({
      gmail_history_id: incomingHistoryId,
      updated_at: new Date().toISOString(),
    }).eq('id', account.id)
    return
  }
  const threadIds = Array.from(threadIdSet)
  await mapLimit(threadIds, 8, async (threadId) => {
    const synced = await syncGmailThread(account, threadId)
    if (!synced?.newestMessageRowId) return
    const { data: projectLink } = await (createAdminClient() as any)
      .from('product_project_mail_threads')
      .select('id')
      .eq('thread_id', synced.threadId)
      .is('unlinked_at', null)
      .limit(1)
      .maybeSingle()
    if (projectLink) await cacheProjectThreadAttachments(synced.threadId)
    const { data: existing } = await (createAdminClient() as any)
      .from('notifications')
      .select('id')
      .eq('user_id', account.user_id)
      .eq('type', 'mail_received')
      .eq('related_mail_message_id', synced.newestMessageRowId)
      .maybeSingle()
    if (!existing) {
      await (createAdminClient() as any).from('notifications').insert({
        user_id: account.user_id,
        type: 'mail_received',
        title: header(synced.newestMessage.payload, 'Subject') || 'Новое письмо',
        message: synced.newestMessage.snippet || 'Получено новое письмо',
        related_mail_thread_id: synced.threadId,
        related_mail_message_id: synced.newestMessageRowId,
        is_read: false,
      })
    }
  })
  await (createAdminClient() as any).from('mail_accounts').update({
    gmail_history_id: latestHistoryId,
    last_synced_at: new Date().toISOString(),
    sync_status: 'ready',
    sync_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', account.id)
}
