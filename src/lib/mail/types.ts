export type MailFolder = string

export type MailAccountStatus = {
  connected: boolean
  emailAddress: string | null
  syncStatus: 'pending' | 'syncing' | 'ready' | 'error' | 'disconnected' | null
  syncError: string | null
  lastSyncedAt: string | null
}

export type MailThreadListItem = {
  id: string
  gmail_thread_id: string
  subject: string
  snippet: string
  participants: Array<{ name?: string; email: string }>
  label_ids: string[]
  last_message_at: string
  message_count: number
  is_unread: boolean
  is_starred: boolean
  has_attachments: boolean
}

export type MailMessageItem = {
  id: string
  gmail_message_id: string
  from_address: string
  from_name: string | null
  to_addresses: string[]
  cc_addresses: string[]
  subject: string
  body_text: string | null
  body_html_sanitized: string | null
  received_at: string
  is_incoming: boolean
  is_unread: boolean
  is_starred: boolean
  attachments: Array<{
    id: string
    file_name: string
    mime_type: string
    size_bytes: number
  }>
}

export type MailThreadDetails = MailThreadListItem & {
  messages: MailMessageItem[]
}

export type MailPageResult = {
  items: MailThreadListItem[]
  nextCursor: string | null
  hasMore: boolean
}
