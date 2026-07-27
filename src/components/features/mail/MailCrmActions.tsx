'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BriefcaseBusiness, Building2, Check, Link2, Mail, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CreateDepartmentRequestForm } from '@/components/features/department-requests/CreateDepartmentRequestForm'
import { ROUTES } from '@/lib/constants/routes'
import type { MailLinkPreview, MailMessageItem, MailThreadDetails } from '@/lib/mail/types'
import { cn } from '@/lib/utils'

type Destination = 'request' | 'project'
type Scope = 'thread' | 'message'

function messagePreview(thread: MailThreadDetails, message: MailMessageItem): MailLinkPreview {
  return {
    kind: 'message',
    id: message.id,
    thread_id: thread.id,
    subject: message.subject || thread.subject,
    snippet: message.body_text?.slice(0, 240) || message.subject,
    sender: message.from_name || message.from_address || 'Неизвестный отправитель',
    received_at: message.received_at,
    message_count: 1,
    has_attachments: message.attachments.length > 0,
  }
}

function threadPreview(thread: MailThreadDetails): MailLinkPreview {
  const participant = thread.participants?.[0]
  return {
    kind: 'thread',
    id: thread.id,
    thread_id: thread.id,
    subject: thread.subject,
    snippet: thread.snippet,
    sender: participant?.name || participant?.email || 'Неизвестный отправитель',
    received_at: thread.last_message_at,
    message_count: thread.message_count,
    has_attachments: thread.has_attachments,
  }
}

export function MailCrmActions({ thread }: { thread: MailThreadDetails }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [destination, setDestination] = useState<Destination>('request')
  const [scope, setScope] = useState<Scope>('thread')
  const [messageId, setMessageId] = useState(thread.messages.at(-1)?.id || '')
  const [requestLink, setRequestLink] = useState<MailLinkPreview | null>(null)

  const selectedLink = useMemo(() => {
    if (scope === 'thread') return threadPreview(thread)
    const message = thread.messages.find((item) => item.id === messageId) || thread.messages.at(-1)
    return message ? messagePreview(thread, message) : threadPreview(thread)
  }, [messageId, scope, thread])

  function continueFlow() {
    if (destination === 'project') {
      const params = new URLSearchParams({ mailKind: selectedLink.kind, mailId: selectedLink.id })
      router.push(`${ROUTES.PRODUCT_PROJECTS_NEW}?${params.toString()}`)
      return
    }
    setRequestLink(selectedLink)
    setOpen(false)
    setRequestOpen(true)
  }

  return (
    <>
      <Button type="button" variant="outline" className="ml-auto min-h-11 gap-2 px-3" onClick={() => setOpen(true)}>
        <Link2 className="size-4" aria-hidden="true" />
        <span className="hidden xl:inline">Использовать в CRM</span>
        <span className="xl:hidden">В CRM</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-xl sm:rounded-xl">
          <DialogHeader className="border-b px-5 pb-4 pt-5 sm:px-6">
            <DialogTitle className="text-xl">Использовать письмо в CRM</DialogTitle>
            <DialogDescription>Выберите, что создать и какую часть переписки прикрепить.</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-5 py-2 sm:px-6">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Что создать</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  selected={destination === 'request'}
                  title="Запрос отделу"
                  description="Выбрать отдел и пройти стандартную форму запроса"
                  icon={Building2}
                  onClick={() => setDestination('request')}
                />
                <ChoiceCard
                  selected={destination === 'project'}
                  title="Проект изделия"
                  description="Открыть форму нового проекта с прикреплённой почтой"
                  icon={BriefcaseBusiness}
                  onClick={() => setDestination('project')}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Что прикрепить</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  selected={scope === 'thread'}
                  title="Всю цепочку"
                  description="Новые ответы появятся автоматически"
                  icon={MessageSquareText}
                  onClick={() => setScope('thread')}
                />
                <ChoiceCard
                  selected={scope === 'message'}
                  title="Только письмо"
                  description="Останется выбранное сообщение без будущих ответов"
                  icon={Mail}
                  onClick={() => setScope('message')}
                />
              </div>
            </fieldset>

            {scope === 'message' && thread.messages.length > 1 && (
              <div className="space-y-2">
                <label htmlFor="crm-mail-message" className="text-sm font-semibold">Выберите письмо</label>
                <select
                  id="crm-mail-message"
                  value={messageId}
                  onChange={(event) => setMessageId(event.target.value)}
                  className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {thread.messages.map((message) => (
                    <option key={message.id} value={message.id}>
                      {message.from_name || message.from_address} · {new Date(message.received_at).toLocaleString('ru-RU')}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="rounded-xl border bg-muted/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Будет прикреплено</p>
              <p className="mt-2 line-clamp-2 font-medium">{selectedLink.subject}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{selectedLink.sender}</p>
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 mt-auto rounded-none px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="button" className="min-h-11" onClick={continueFlow}>Продолжить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateDepartmentRequestForm
        open={requestOpen}
        onOpenChange={setRequestOpen}
        initialMailLink={requestLink}
        initialTitle={requestLink?.subject || thread.subject}
      />
    </>
  )
}

function ChoiceCard({
  selected,
  title,
  description,
  icon: Icon,
  onClick,
}: {
  selected: boolean
  title: string
  description: string
  icon: React.ElementType
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'relative min-h-24 cursor-pointer rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-blue-600 bg-blue-50 text-blue-950' : 'bg-background hover:bg-muted/60',
      )}
    >
      <span className="flex items-center gap-2 font-semibold"><Icon className="size-5" aria-hidden="true" />{title}</span>
      <span className="mt-2 block text-sm leading-5 text-muted-foreground">{description}</span>
      {selected && <Check className="absolute right-3 top-3 size-4 text-blue-700" aria-hidden="true" />}
    </button>
  )
}
