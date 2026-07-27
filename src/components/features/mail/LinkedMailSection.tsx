'use client'

import { useState } from 'react'
import { ChevronDown, File, Loader2, Mail, MessageSquareText, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  getMailThread,
  unlinkDepartmentRequestMailLink,
  unlinkProductProjectMailLink,
} from '@/lib/actions/mail'
import type { CrmMailLink, MailThreadDetails } from '@/lib/mail/types'
import { cn } from '@/lib/utils'

export function LinkedMailSection({
  target,
  targetId,
  links,
  canUnlink,
  emptyText = 'Почтовая переписка пока не привязана.',
}: {
  target: 'product_project' | 'department_request'
  targetId: string
  links: CrmMailLink[]
  canUnlink: boolean
  emptyText?: string
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, MailThreadDetails>>({})

  async function toggle(link: CrmMailLink) {
    if (expanded === link.link_id) {
      setExpanded(null)
      return
    }
    setExpanded(link.link_id)
    if (details[link.link_id]) return
    setLoading(link.link_id)
    try {
      const thread = await getMailThread(
        link.preview.thread_id,
        link.kind === 'message' ? link.preview.id : null,
      )
      setDetails((current) => ({ ...current, [link.link_id]: thread }))
    } catch (error) {
      setExpanded(null)
      toast.error(error instanceof Error ? error.message : 'Не удалось открыть письмо')
    } finally {
      setLoading(null)
    }
  }

  async function unlink(link: CrmMailLink) {
    const result = target === 'product_project'
      ? await unlinkProductProjectMailLink(link.kind, link.link_id, targetId)
      : await unlinkDepartmentRequestMailLink(link.kind, link.link_id, targetId)
    if (!result.success) return toast.error(result.error)
    toast.success('Связь с почтой удалена')
    router.refresh()
  }

  if (links.length === 0) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
  }

  return (
    <div className="space-y-3">
      {links.map((link) => {
        const thread = details[link.link_id]
        const isExpanded = expanded === link.link_id
        return (
          <article key={link.link_id} className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                {link.kind === 'thread' ? <MessageSquareText className="size-5" /> : <Mail className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{link.preview.subject}</p>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    {link.kind === 'thread' ? 'Вся цепочка' : 'Одно письмо'}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{link.preview.sender} · {link.preview.snippet}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {format(new Date(link.preview.received_at), 'd MMMM yyyy, HH:mm', { locale: ru })}
                  {link.kind === 'thread' ? ` · ${link.preview.message_count} сообщений` : ''}
                  {link.preview.has_attachments ? ' · есть вложения' : ''}
                </p>
              </div>
              <Button type="button" variant="outline" className="min-h-11 gap-2" aria-expanded={isExpanded} onClick={() => void toggle(link)}>
                {loading === link.link_id ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className={cn('size-4 transition-transform', isExpanded && 'rotate-180')} />}
                {isExpanded ? 'Свернуть' : 'Открыть'}
              </Button>
              {canUnlink && (
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Удалить связь с почтой" onClick={() => void unlink(link)}>
                  <Trash2 className="size-4 text-red-600" />
                </Button>
              )}
            </div>

            {isExpanded && thread && (
              <div className="space-y-3 border-t bg-muted/20 p-4">
                {thread.messages.map((message) => (
                  <div key={message.id} className="rounded-xl border bg-background p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="font-semibold">{message.from_name || message.from_address}</p>
                        <p className="text-xs text-muted-foreground">Кому: {message.to_addresses.join(', ')}</p>
                      </div>
                      <time className="text-xs text-muted-foreground">{format(new Date(message.received_at), 'd MMMM yyyy, HH:mm', { locale: ru })}</time>
                    </div>
                    {message.body_text ? (
                      <div className="mt-4 whitespace-pre-wrap text-sm leading-6">{message.body_text}</div>
                    ) : message.body_html_sanitized ? (
                      <div className="mt-4 break-words text-sm leading-6 [&_a]:text-blue-700 [&_a]:underline" dangerouslySetInnerHTML={{ __html: message.body_html_sanitized }} />
                    ) : (
                      <p className="mt-4 text-sm">{message.subject}</p>
                    )}
                    {message.attachments.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {message.attachments.map((attachment) => (
                          <a key={attachment.id} href={`/api/mail/attachments/${attachment.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-muted">
                            <File className="size-4" />{attachment.file_name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
