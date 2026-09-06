'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BriefcaseBusiness, Building2, Check, Link2, Loader2, Mail, MessageSquareText, PencilRuler, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CreateDepartmentRequestForm } from '@/components/features/department-requests/CreateDepartmentRequestForm'
import { ROUTES } from '@/lib/constants/routes'
import type { MailLinkPreview, MailMessageItem, MailThreadDetails } from '@/lib/mail/types'
import { cn } from '@/lib/utils'
import {
  getCorrectableProductProjectOptions,
  type CorrectableProductProjectOption,
} from '@/lib/actions/products'
import { Input } from '@/components/ui/input'

type Destination = 'request' | 'project' | 'correction'
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
  const [projects, setProjects] = useState<CorrectableProductProjectOption[]>([])
  const [projectSearch, setProjectSearch] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  const selectedLink = useMemo(() => {
    if (scope === 'thread') return threadPreview(thread)
    const message = thread.messages.find((item) => item.id === messageId) || thread.messages.at(-1)
    return message ? messagePreview(thread, message) : threadPreview(thread)
  }, [messageId, scope, thread])

  async function selectDestination(nextDestination: Destination) {
    setDestination(nextDestination)
    if (nextDestination !== 'correction' || projects.length > 0 || projectsLoading) return
    setProjectsLoading(true)
    setProjectsError(null)
    try {
      const result = await getCorrectableProductProjectOptions()
      if (result.error) setProjectsError(result.error)
      else setProjects(result.data || [])
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : 'Не удалось загрузить проекты')
    } finally {
      setProjectsLoading(false)
    }
  }

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase('ru')
    if (!query) return projects
    return projects.filter((project) => project.title.toLocaleLowerCase('ru').includes(query))
  }, [projectSearch, projects])

  function continueFlow() {
    if (destination === 'project') {
      const params = new URLSearchParams({ mailKind: selectedLink.kind, mailId: selectedLink.id })
      router.push(`${ROUTES.PRODUCT_PROJECTS_NEW}?${params.toString()}`)
      return
    }
    if (destination === 'correction') {
      if (!selectedProjectId) return
      const params = new URLSearchParams({
        correctionMailKind: selectedLink.kind,
        correctionMailId: selectedLink.id,
      })
      router.push(`${ROUTES.PRODUCT_PROJECTS}/${selectedProjectId}?${params.toString()}`)
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
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] min-w-0 w-screen max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-xl">
          <DialogHeader className="border-b px-5 pb-4 pt-5 pr-14 sm:px-6 sm:pr-14">
            <DialogTitle className="text-xl">Использовать письмо в CRM</DialogTitle>
            <DialogDescription>Выберите, что создать и какую часть переписки прикрепить.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-5 py-4 sm:px-6">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Что создать</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <ChoiceCard
                  selected={destination === 'request'}
                  title="Запрос отделу"
                  description="Выбрать отдел и пройти стандартную форму запроса"
                  icon={Building2}
                  onClick={() => void selectDestination('request')}
                />
                <ChoiceCard
                  selected={destination === 'project'}
                  title="Проект изделия"
                  description="Открыть форму нового проекта с прикреплённой почтой"
                  icon={BriefcaseBusiness}
                  onClick={() => void selectDestination('project')}
                />
                <ChoiceCard
                  selected={destination === 'correction'}
                  title="Корректировка"
                  description="Добавить письмо к новой версии существующего проекта"
                  icon={PencilRuler}
                  onClick={() => void selectDestination('correction')}
                />
              </div>
            </fieldset>

            {destination === 'correction' && (
              <fieldset className="min-w-0 space-y-3">
                <legend className="text-sm font-semibold">Какой проект корректировать</legend>
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    className="min-h-11 pl-9"
                    placeholder="Найти проект по названию"
                  />
                </div>
                <div className="max-h-56 min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border">
                  {projectsLoading ? (
                    <div className="flex min-h-24 items-center justify-center"><Loader2 className="size-5 animate-spin" aria-label="Загрузка проектов" /></div>
                  ) : projectsError ? (
                    <p className="p-4 text-sm text-destructive">{projectsError}</p>
                  ) : filteredProjects.length === 0 ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">Доступные проекты не найдены</p>
                  ) : filteredProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      aria-pressed={selectedProjectId === project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      className={cn(
                        'flex min-h-14 min-w-0 w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        selectedProjectId === project.id && 'bg-blue-50',
                      )}
                    >
                      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border', selectedProjectId === project.id && 'border-blue-600 bg-blue-600 text-white')}>
                        {selectedProjectId === project.id && <Check className="size-4" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block break-words text-sm font-medium">{project.title}</span>
                        <span className="block text-xs text-muted-foreground">Текущая версия: {project.latest_version_number}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

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

          <DialogFooter className="mx-0 mb-0 mt-auto shrink-0 rounded-none border-t bg-background px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={destination === 'correction' && !selectedProjectId} onClick={continueFlow}>Продолжить</Button>
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
      aria-pressed={selected}
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
