'use client'

import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  File,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { format, isToday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Textarea } from '@/components/ui/textarea'
import {
  disconnectGmail,
  getMailThread,
  getMailThreads,
  loadOlderMail,
  mutateMailThread,
  sendMail,
} from '@/lib/actions/mail'
import type {
  MailAccountStatus,
  MailFolder,
  MailPageResult,
  MailThreadDetails,
  MailThreadListItem,
} from '@/lib/mail/types'
import { cn } from '@/lib/utils'
import { mergeMailThreadPages } from '@/lib/mail/model'
import { MailCrmActions } from '@/components/features/mail/MailCrmActions'

const folders: Array<{ value: MailFolder; label: string; icon: React.ElementType }> = [
  { value: 'INBOX', label: 'Входящие', icon: Inbox },
  { value: 'STARRED', label: 'Отмеченные', icon: Star },
  { value: 'SENT', label: 'Отправленные', icon: Send },
  { value: 'DRAFT', label: 'Черновики', icon: File },
  { value: 'ALL', label: 'Вся почта', icon: Mail },
  { value: 'SPAM', label: 'Спам', icon: TriangleAlert },
  { value: 'TRASH', label: 'Корзина', icon: Trash2 },
]

export function MailPageClient({
  status,
  initial,
  initialThreadId,
  labels,
}: {
  status: MailAccountStatus
  initial: MailPageResult
  initialThreadId?: string | null
  labels: Array<{ gmail_label_id: string; name: string; label_type: string; messages_unread: number | null }>
}) {
  const [folder, setFolder] = useState<MailFolder>('INBOX')
  const [items, setItems] = useState(initial.items)
  const [query, setQuery] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [hasMore, setHasMore] = useState(initial.hasMore)
  const [pageToken, setPageToken] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<MailThreadDetails | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length + (hasMore ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 92,
    overscan: 8,
  })
  const visibleFolders = [
    ...folders,
    ...labels
      .filter((label) => label.label_type === 'user')
      .map((label) => ({ value: label.gmail_label_id, label: label.name, icon: Tag })),
  ]

  async function refreshList(nextFolder = folder, nextQuery = query) {
    setLoadingList(true)
    try {
      const page = await getMailThreads({ folder: nextFolder, query: nextQuery })
      setItems(page.items)
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setPageToken(null)
      scrollRef.current?.scrollTo({ top: 0 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить письма')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = searchDraft.trim()
      if (normalized !== query) {
        setQuery(normalized)
        void refreshList(folder, normalized)
      }
    }, 250)
    return () => window.clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  useEffect(() => {
    if (initialThreadId && status.connected) void openThreadByGmailId(initialThreadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThreadId, status.connected])

  const virtualRows = virtualizer.getVirtualItems()
  useEffect(() => {
    const last = virtualRows.at(-1)
    if (!last || last.index < items.length - 8 || !hasMore || loadingMore) return
    void loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualRows, hasMore, loadingMore])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const result = await loadOlderMail({
        folder,
        query,
        pageToken,
        before: nextCursor || items.at(-1)?.last_message_at || null,
      })
      setItems((current) => mergeMailThreadPages(current, result.items))
      setPageToken(result.nextPageToken)
      setNextCursor(result.nextCursor)
      setHasMore(result.hasMore)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось загрузить старые письма')
    } finally {
      setLoadingMore(false)
    }
  }

  async function openThread(thread: MailThreadListItem) {
    setLoadingThread(true)
    setItems((current) => current.map((item) => item.id === thread.id ? { ...item, is_unread: false } : item))
    try {
      const details = await getMailThread(thread.id)
      setSelected(details)
      if (thread.is_unread) void mutateMailThread(thread.id, 'read')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось открыть письмо')
    } finally {
      setLoadingThread(false)
    }
  }

  async function openThreadByGmailId(identifier: string) {
    const found = items.find((item) => item.gmail_thread_id === identifier || item.id === identifier)
    if (found) await openThread(found)
  }

  async function mutate(mutation: Parameters<typeof mutateMailThread>[1]) {
    if (!selected) return
    const snapshot = selected
    if (mutation === 'star' || mutation === 'unstar') {
      setSelected({ ...selected, is_starred: mutation === 'star' })
    }
    if (['archive', 'trash', 'spam'].includes(mutation)) setSelected(null)
    const result = await mutateMailThread(snapshot.id, mutation)
    if (!result.success) {
      setSelected(snapshot)
      toast.error(result.error)
      return
    }
    void refreshList()
  }

  if (!status.connected) {
    return (
      <div className="mx-auto flex min-h-[65vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-3xl border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><Mail className="size-8" /></span>
          <h1 className="mt-5 text-2xl font-semibold">Подключите Gmail</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Почта останется личной. CRM получит доступ только после подтверждения в Google.</p>
          <a href="/api/mail/oauth/start" className={cn(buttonVariants(), 'mt-6 min-h-11')}>Подключить Gmail</a>
        </div>
      </div>
    )
  }

  return (
    <div className="-m-6 flex h-[calc(100dvh-60px)] min-h-0 overflow-hidden bg-background">
      <aside className="hidden w-56 shrink-0 border-r bg-card p-3 md:block">
        <Button className="mb-4 min-h-11 w-full justify-start" onClick={() => setComposeOpen(true)}><PenLine className="size-4" /> Написать</Button>
        <nav className="space-y-1" aria-label="Папки почты">
          {visibleFolders.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => {
              setFolder(value)
              setSelected(null)
              void refreshList(value, query)
            }} className={cn('flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium', folder === value ? 'bg-blue-50 text-blue-800' : 'text-muted-foreground hover:bg-muted')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-5 border-t pt-4 text-xs text-muted-foreground">
          <p className="truncate font-medium text-foreground">{status.emailAddress}</p>
          <p className="mt-1">{status.syncStatus === 'ready' ? 'Синхронизировано' : 'Синхронизация…'}</p>
          <button type="button" className="mt-4 cursor-pointer text-red-600 hover:underline" onClick={async () => {
            const result = await disconnectGmail()
            if (!result.success) toast.error(result.error)
            else window.location.reload()
          }}>Отключить Gmail</button>
        </div>
      </aside>

      <section className={cn('flex min-w-0 flex-1 flex-col border-r bg-card', selected && 'hidden lg:flex')}>
        <div className="flex min-h-16 items-center gap-2 border-b px-3 sm:px-4">
          <Button className="md:hidden" size="icon" onClick={() => setComposeOpen(true)} aria-label="Написать письмо"><PenLine className="size-4" /></Button>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="min-h-11 pl-9" placeholder="Поиск в почте" />
          </div>
          <Button variant="ghost" size="icon" aria-label="Обновить" disabled={loadingList} onClick={() => void refreshList()}>
            <RefreshCw className={cn('size-4', loadingList && 'animate-spin')} />
          </Button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loadingList && items.length === 0 ? <MailListSkeleton /> : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <CheckCircle2 className="size-10 text-muted-foreground" />
              <p className="mt-3 font-medium">Писем здесь нет</p>
              <p className="mt-1 text-sm text-muted-foreground">Попробуйте другую папку или измените поиск.</p>
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualRows.map((row) => {
                if (row.index >= items.length) {
                  return <div key="loader" className="absolute left-0 top-0 flex w-full justify-center p-5" style={{ transform: `translateY(${row.start}px)` }}><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                }
                const item = items[row.index]
                return (
                  <button
                    key={item.id}
                    type="button"
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    onClick={() => void openThread(item)}
                    className={cn('absolute left-0 top-0 flex w-full cursor-pointer gap-3 border-b px-4 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', item.is_unread && 'bg-blue-50/60')}
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <span className={cn('mt-1 size-2 shrink-0 rounded-full', item.is_unread ? 'bg-blue-600' : 'bg-transparent')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('min-w-0 flex-1 truncate text-sm', item.is_unread ? 'font-semibold text-foreground' : 'font-medium')}>{participantLabel(item)}</span>
                        <time className="shrink-0 text-xs text-muted-foreground">{formatMailDate(item.last_message_at)}</time>
                      </div>
                      <div className={cn('mt-1 truncate text-sm', item.is_unread && 'font-semibold')}>{item.subject}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{item.snippet}</div>
                    </div>
                    {item.is_starred && <Star className="mt-1 size-4 fill-amber-400 text-amber-500" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className={cn('min-w-0 flex-[1.25] bg-background', !selected && 'hidden lg:block')}>
        {loadingThread ? <ThreadSkeleton /> : selected ? (
          <ThreadView thread={selected} onBack={() => setSelected(null)} onMutate={mutate} onReply={() => setComposeOpen(true)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground"><MailOpen className="size-12" /><p className="mt-3">Выберите письмо</p></div>
        )}
      </section>
      {composeOpen && <ComposeDialog open onOpenChange={setComposeOpen} thread={selected} />}
    </div>
  )
}

function participantLabel(item: MailThreadListItem) {
  return item.participants?.slice(0, 2).map((participant) => participant.name || participant.email).join(', ') || 'Неизвестный отправитель'
}

function formatMailDate(value: string) {
  const date = new Date(value)
  return format(date, isToday(date) ? 'HH:mm' : 'd MMM', { locale: ru })
}

function ThreadView({ thread, onBack, onMutate, onReply }: {
  thread: MailThreadDetails
  onBack: () => void
  onMutate: (mutation: Parameters<typeof mutateMailThread>[1]) => Promise<void>
  onReply: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-16 items-center gap-1 overflow-x-auto border-b bg-card px-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Назад"><ChevronLeft className="size-5" /></Button>
        <Button variant="ghost" size="icon" onClick={() => void onMutate('archive')} aria-label="Архивировать"><Archive className="size-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => void onMutate(thread.is_starred ? 'unstar' : 'star')} aria-label="Отметить"><Star className={cn('size-4', thread.is_starred && 'fill-amber-400 text-amber-500')} /></Button>
        <Button variant="ghost" size="icon" onClick={() => void onMutate('spam')} aria-label="В спам"><TriangleAlert className="size-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => void onMutate('trash')} aria-label="Удалить"><Trash2 className="size-4" /></Button>
        <MailCrmActions key={thread.id} thread={thread} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{thread.subject}</h1>
        <div className="mt-5 space-y-4">
          {thread.messages.map((message) => (
            <article key={message.id} className="rounded-2xl border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-semibold">{message.from_name || message.from_address}</p><p className="text-xs text-muted-foreground">Кому: {message.to_addresses.join(', ')}</p></div>
                <time className="text-xs text-muted-foreground">{format(new Date(message.received_at), 'd MMMM yyyy, HH:mm', { locale: ru })}</time>
              </div>
              {message.body_text ? (
                <div className="mt-4 max-w-none whitespace-pre-wrap text-sm leading-6 text-foreground">{message.body_text}</div>
              ) : message.body_html_sanitized ? (
                <div className="mt-4 max-w-none break-words text-sm leading-6 text-foreground [&_a]:text-blue-700 [&_a]:underline" dangerouslySetInnerHTML={{ __html: message.body_html_sanitized }} />
              ) : (
                <div className="mt-4 text-sm">{message.subject}</div>
              )}
              {message.attachments.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{message.attachments.map((attachment) => (
                <a key={attachment.id} href={`/api/mail/attachments/${attachment.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-muted"><File className="size-4" />{attachment.file_name}</a>
              ))}</div>}
            </article>
          ))}
        </div>
      </div>
      <div className="border-t bg-card p-3"><Button onClick={onReply}><Send className="size-4" /> Ответить</Button></div>
    </div>
  )
}

function ComposeDialog({ open, onOpenChange, thread }: { open: boolean; onOpenChange: (open: boolean) => void; thread: MailThreadDetails | null }) {
  const last = thread?.messages.at(-1)
  const [to, setTo] = useState(last?.from_address || '')
  const [subject, setSubject] = useState(thread ? `Re: ${thread.subject.replace(/^Re:\s*/i, '')}` : '')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  async function submit(draft = false) {
    setSending(true)
    const result = await sendMail({
      to: to.split(/[;,]/).map((value) => value.trim()).filter(Boolean),
      subject,
      text,
      gmailThreadId: thread?.gmail_thread_id,
      draft,
    })
    setSending(false)
    if (!result.success) return toast.error(result.error)
    toast.success(draft ? 'Черновик сохранён' : 'Письмо отправлено')
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{thread ? 'Ответить' : 'Новое письмо'}</DialogTitle><DialogDescription>Письмо будет отправлено через подключённый Gmail.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Кому *</Label><Input type="email" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <div className="space-y-2"><Label>Тема *</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div>
          <div className="space-y-2"><Label>Сообщение *</Label><Textarea rows={10} value={text} onChange={(event) => setText(event.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2"><LoadingButton variant="outline" loading={sending} onClick={() => void submit(true)}>Сохранить черновик</LoadingButton><LoadingButton loading={sending} onClick={() => void submit(false)}>Отправить</LoadingButton></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MailListSkeleton() {
  return <div className="space-y-px">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[92px] animate-pulse border-b bg-muted/40" />)}</div>
}

function ThreadSkeleton() {
  return <div className="space-y-4 p-6"><div className="h-8 w-2/3 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-2xl bg-muted" /></div>
}
