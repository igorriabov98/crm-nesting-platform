'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertCircle, File, MailOpen } from 'lucide-react'
import { getMailThread } from '@/lib/actions/mail'
import type { MailLinkPreview, MailThreadDetails } from '@/lib/mail/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function AttachedMailConversation({ link }: { link: MailLinkPreview }) {
  const [thread, setThread] = useState<MailThreadDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    getMailThread(link.thread_id, link.kind === 'message' ? link.id : null)
      .then((result) => {
        if (!cancelled) setThread(result)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Не удалось открыть переписку')
        }
      })

    return () => {
      cancelled = true
    }
  }, [link.id, link.kind, link.thread_id, retryKey])

  if (error) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-6 text-center">
        <AlertCircle className="size-6 text-destructive" aria-hidden="true" />
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-11"
          onClick={() => {
            setError(null)
            setThread(null)
            setRetryKey((current) => current + 1)
          }}
        >
          Повторить
        </Button>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="space-y-3" aria-label="Загрузка прикреплённой переписки">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    )
  }

  if (thread.messages.length === 0) {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center text-muted-foreground">
        <MailOpen className="size-7" aria-hidden="true" />
        <p className="mt-2 text-sm">В прикреплённой переписке нет доступных писем.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {thread.messages.map((message) => (
        <article key={message.id} className="rounded-xl border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{message.from_name || message.from_address}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">Кому: {message.to_addresses.join(', ')}</p>
            </div>
            <time className="shrink-0 text-xs text-muted-foreground">
              {format(new Date(message.received_at), 'd MMMM yyyy, HH:mm', { locale: ru })}
            </time>
          </div>
          {message.body_text ? (
            <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{message.body_text}</div>
          ) : message.body_html_sanitized ? (
            <div
              className="mt-4 break-words text-sm leading-6 text-foreground [&_a]:text-blue-700 [&_a]:underline [&_img]:hidden"
              dangerouslySetInnerHTML={{ __html: message.body_html_sanitized }}
            />
          ) : (
            <p className="mt-4 text-sm text-foreground">{message.subject}</p>
          )}
          {message.attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={`/api/mail/attachments/${attachment.id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <File className="size-4" aria-hidden="true" />
                  <span className="max-w-56 truncate">{attachment.file_name}</span>
                </a>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
