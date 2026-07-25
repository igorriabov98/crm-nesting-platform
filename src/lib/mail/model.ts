import type { MailThreadListItem } from './types'

export type MailMutation = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash' | 'spam' | 'inbox'

export const gmailLabelChanges: Record<MailMutation, { addLabelIds?: string[]; removeLabelIds?: string[] }> = {
  read: { removeLabelIds: ['UNREAD'] },
  unread: { addLabelIds: ['UNREAD'] },
  star: { addLabelIds: ['STARRED'] },
  unstar: { removeLabelIds: ['STARRED'] },
  archive: { removeLabelIds: ['INBOX'] },
  trash: { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX', 'SPAM'] },
  spam: { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX', 'TRASH'] },
  inbox: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH', 'SPAM'] },
}

export function mergeMailThreadPages(current: MailThreadListItem[], incoming: MailThreadListItem[]) {
  const byId = new Map(current.map((thread) => [thread.id, thread]))
  for (const thread of incoming) byId.set(thread.id, thread)
  return Array.from(byId.values()).sort(
    (left, right) => new Date(right.last_message_at).getTime() - new Date(left.last_message_at).getTime(),
  )
}
