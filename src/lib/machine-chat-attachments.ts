export const MAX_MACHINE_CHAT_ATTACHMENTS = 5
export const MAX_MACHINE_CHAT_ATTACHMENT_SIZE = 20 * 1024 * 1024

export type MachineChatAttachmentKind = 'pdf' | 'image'

export type StoredMachineChatAttachment = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  kind: MachineChatAttachmentKind
  path: string
}

export type MachineChatAttachment = Omit<StoredMachineChatAttachment, 'path'> & {
  url: string
}

const ATTACHMENTS_MARKER_START = '\n\n[[machine-chat-attachments:'
const ATTACHMENTS_MARKER_END = ']]'
const ATTACHMENT_ONLY_BODY = 'Вложения'

function normalizeStoredAttachment(value: unknown): StoredMachineChatAttachment | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<StoredMachineChatAttachment>
  const kind = item.kind === 'pdf' || item.kind === 'image' ? item.kind : null
  if (
    !kind ||
    typeof item.id !== 'string' ||
    typeof item.fileName !== 'string' ||
    typeof item.mimeType !== 'string' ||
    typeof item.path !== 'string'
  ) {
    return null
  }

  const fileSize = Number(item.fileSize || 0)
  return {
    id: item.id,
    fileName: item.fileName,
    mimeType: item.mimeType,
    fileSize: Number.isFinite(fileSize) ? fileSize : 0,
    kind,
    path: item.path,
  }
}

export function stripMachineChatAttachmentMarker(value: string) {
  return value.replaceAll(ATTACHMENTS_MARKER_START, '[вложения:')
}

export function encodeMachineChatBody(text: string, attachments: StoredMachineChatAttachment[]) {
  const body = stripMachineChatAttachmentMarker(text).trim()
  if (attachments.length === 0) return body
  return `${body || ATTACHMENT_ONLY_BODY}${ATTACHMENTS_MARKER_START}${JSON.stringify(attachments)}${ATTACHMENTS_MARKER_END}`
}

export function decodeMachineChatBody(value: string) {
  const markerIndex = value.lastIndexOf(ATTACHMENTS_MARKER_START)
  if (markerIndex === -1) {
    return { text: value, attachments: [] as StoredMachineChatAttachment[] }
  }

  const payloadStart = markerIndex + ATTACHMENTS_MARKER_START.length
  const markerEnd = value.indexOf(ATTACHMENTS_MARKER_END, payloadStart)
  if (markerEnd === -1) {
    return { text: value, attachments: [] as StoredMachineChatAttachment[] }
  }

  const text = value.slice(0, markerIndex).trim()
  const payload = value.slice(payloadStart, markerEnd)

  try {
    const raw = JSON.parse(payload)
    const attachments = Array.isArray(raw)
      ? raw.map(normalizeStoredAttachment).filter((item): item is StoredMachineChatAttachment => Boolean(item))
      : []
    return {
      text: text === ATTACHMENT_ONLY_BODY && attachments.length > 0 ? '' : text,
      attachments,
    }
  } catch {
    return { text: value, attachments: [] as StoredMachineChatAttachment[] }
  }
}

export function toPublicMachineChatAttachment(messageId: string, attachment: StoredMachineChatAttachment): MachineChatAttachment {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    kind: attachment.kind,
    url: `/api/machine-chat/files/${messageId}/${attachment.id}`,
  }
}
