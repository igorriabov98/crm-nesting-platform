"use client"

import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardPenLine,
  Mail,
  Paperclip,
  Trash2,
  UserRoundCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { createProductProjectWithPhoto, updateProductProject } from '@/lib/actions/products'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { Client, ProductProject, UserSummary } from '@/lib/types'
import type { ProductProjectInput } from '@/lib/types/schemas'
import { linkMailToProductProject } from '@/lib/actions/mail'
import type { MailLinkInput, MailLinkPreview } from '@/lib/mail/types'
import { ProductProjectLifecycle, productProjectStatusLabels } from './ProductProjectLifecycle'

const AttachedMailConversation = dynamic(
  () => import('./AttachedMailConversation').then((module) => module.AttachedMailConversation),
  { loading: () => <div className="h-40 animate-pulse rounded-xl bg-muted" aria-label="Загрузка прикреплённой переписки" /> },
)

type ProjectState = {
  title: string
  client_id: string
  description: string
  characteristics: string
  client_wishes: string
  assigned_engineer_id: string
}

function initialState(project?: ProductProject | null, initialTitle = ''): ProjectState {
  return {
    title: project?.title || initialTitle,
    client_id: project?.client_id || 'none',
    description: project?.description || '',
    characteristics: project?.characteristics || '',
    client_wishes: project?.client_wishes || '',
    assigned_engineer_id: project?.assigned_engineer_id || '',
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function SectionHeading({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <div>
        <h2 className="font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function ProductProjectForm({
  project,
  clients,
  engineers,
  initialMailLink,
}: {
  project?: ProductProject | null
  clients: Pick<Client, 'id' | 'name'>[]
  engineers: UserSummary[]
  initialMailLink?: MailLinkPreview | null
}) {
  const router = useRouter()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<ProjectState>(() => initialState(project, initialMailLink?.subject))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [attachedMailLink, setAttachedMailLink] = useState<MailLinkPreview | null>(initialMailLink || null)
  const [mailExpanded, setMailExpanded] = useState(false)
  const isEdit = Boolean(project?.id)
  const status = project?.status || 'new_project'
  const selectedClientLabel = values.client_id === 'none'
    ? 'Без клиента'
    : clients.find((client) => client.id === values.client_id)?.name || 'Выберите клиента'
  const selectedEngineerLabel = engineers.find((engineer) => engineer.id === values.assigned_engineer_id)?.full_name || 'Выберите инженера'

  function setField<K extends keyof ProjectState>(field: K, value: ProjectState[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const payload: ProductProjectInput = {
        title: values.title,
        client_id: values.client_id === 'none' ? null : values.client_id,
        description: values.description,
        characteristics: values.characteristics,
        client_wishes: values.client_wishes,
        assigned_engineer_id: values.assigned_engineer_id,
        status,
      }
      const result = isEdit && project
        ? await updateProductProject(project.id, payload)
        : await createProjectWithPhoto(payload, photoInputRef.current?.files?.[0] || null)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить проект')
      toast.success(isEdit ? 'Проект обновлён' : 'Проект создан. Инженеру назначена задача.')
      const createdProject = 'project' in result ? result.project as { id?: string } | null : null
      if (!isEdit && createdProject?.id) {
        const mailLinks: MailLinkInput[] = attachedMailLink
          ? [{ kind: attachedMailLink.kind, id: attachedMailLink.id }]
          : []
        const linkResults = await Promise.all(mailLinks.map((mailLink) =>
          linkMailToProductProject(mailLink, createdProject.id!)
        ))
        const failedIndex = linkResults.findIndex((linkResult) => !linkResult.success)
        if (failedIndex >= 0) {
          const failedLink = linkResults[failedIndex]
          const retryLink = mailLinks[failedIndex]
          toast.error(`Проект создан, но письмо не добавлено: ${failedLink.error}`, {
            duration: 10000,
            action: {
              label: 'Повторить',
              onClick: () => void linkMailToProductProject(retryLink, createdProject.id!),
            },
          })
        }
        router.push(`${ROUTES.PRODUCT_PROJECTS}/${createdProject.id}`)
      } else {
        router.refresh()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function createProjectWithPhoto(payload: ProductProjectInput, photo: File | null) {
    const formData = new FormData()
    formData.append('title', payload.title)
    if (payload.client_id) formData.append('client_id', payload.client_id)
    formData.append('description', payload.description || '')
    formData.append('characteristics', payload.characteristics || '')
    formData.append('client_wishes', payload.client_wishes || '')
    formData.append('assigned_engineer_id', payload.assigned_engineer_id)
    formData.append('status', status)
    if (photo) formData.append('photo', photo)

    return createProductProjectWithPhoto(formData)
  }

  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/25 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ClipboardPenLine className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">{isEdit ? 'Карточка проекта' : 'Данные нового изделия'}</p>
              <p className="text-sm text-muted-foreground">Статусы меняются автоматически по действиям команды.</p>
            </div>
          </div>
          <div className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary">
            {productProjectStatusLabels[status]}
          </div>
        </div>
        {!isEdit && (
          <div className="mt-4">
            <ProductProjectLifecycle status={status} compact />
          </div>
        )}
      </div>

      <div className={cn('grid', !isEdit && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
        <div className="space-y-7 p-4 sm:p-6">
          <section className="space-y-5">
            <SectionHeading
              number={1}
              title="Основная информация"
              description="Название, клиент и ответственный инженер — всё необходимое для запуска проекта."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="title">Название проекта *</Label>
                <Input
                  id="title"
                  className="min-h-11 text-base"
                  value={values.title}
                  onChange={(event) => setField('title', event.target.value)}
                  placeholder="Например, корпус блока управления"
                  autoFocus={!initialMailLink}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project_client">Клиент</Label>
                <Select value={values.client_id} onValueChange={(value) => setField('client_id', value || 'none')}>
                  <SelectTrigger id="project_client" className="min-h-11 w-full">
                    <SelectValue>{selectedClientLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без клиента</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project_engineer">Инженер *</Label>
                <Select value={values.assigned_engineer_id} onValueChange={(value) => setField('assigned_engineer_id', value || '')}>
                  <SelectTrigger id="project_engineer" className="min-h-11 w-full">
                    <SelectValue placeholder="Выберите инженера">{selectedEngineerLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {engineers.map((engineer) => (
                      <SelectItem key={engineer.id} value={engineer.id}>{engineer.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
                  <UserRoundCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  После создания инженер сразу получит задачу в CRM.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-5 border-t border-border pt-6">
            <SectionHeading
              number={2}
              title="Требования к изделию"
              description="Сначала главное. Дополнительные детали можно дополнять уже в карточке проекта."
            />
            <div className="space-y-2">
              <Label htmlFor="description">Описание продукта</Label>
              <Textarea
                id="description"
                rows={5}
                className="min-h-32 resize-y"
                value={values.description}
                onChange={(event) => setField('description', event.target.value)}
                placeholder="Что нужно изготовить, назначение и ожидаемый результат"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="characteristics">Характеристики</Label>
                <Textarea
                  id="characteristics"
                  rows={4}
                  className="resize-y"
                  value={values.characteristics}
                  onChange={(event) => setField('characteristics', event.target.value)}
                  placeholder="Размеры, материал, покрытие, особенности"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client_wishes">Пожелания клиента</Label>
                <Textarea
                  id="client_wishes"
                  rows={4}
                  className="resize-y"
                  value={values.client_wishes}
                  onChange={(event) => setField('client_wishes', event.target.value)}
                  placeholder="Сроки, внешний вид и другие пожелания"
                />
              </div>
            </div>
          </section>
        </div>

        {!isEdit && (
          <aside className="space-y-4 border-t border-border bg-muted/15 p-4 sm:p-6 xl:border-l xl:border-t-0">
            <section className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Camera className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Фото изделия</h2>
                  <p className="text-xs text-muted-foreground">Необязательно, можно добавить позже</p>
                </div>
              </div>
              <Input
                id="project_photo"
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="mt-4 min-h-11 cursor-pointer"
                aria-label="Фото изделия"
                disabled={isSubmitting}
              />
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Mail className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">Почтовая переписка</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {attachedMailLink ? 'Прикреплено: 1' : 'Не прикреплена'}
                  </span>
                </span>
              </div>

              {attachedMailLink ? (
                <>
                  <div className="mx-4 mb-3 flex items-stretch overflow-hidden rounded-xl border border-blue-200 bg-blue-50">
                    <button
                      type="button"
                      className="flex min-h-20 min-w-0 flex-1 cursor-pointer items-start gap-3 p-3 text-left transition-colors hover:bg-blue-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-inset"
                      aria-expanded={mailExpanded}
                      aria-controls="attached-mail-conversation"
                      aria-label={`${mailExpanded ? 'Свернуть' : 'Открыть'} прикреплённую переписку: ${attachedMailLink.subject}`}
                      onClick={() => setMailExpanded((current) => !current)}
                    >
                      <Paperclip className="mt-0.5 size-4 shrink-0 text-blue-700" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                          {attachedMailLink.kind === 'thread' ? 'Вся цепочка' : 'Одно письмо'}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-sm font-medium text-blue-950">{attachedMailLink.subject}</span>
                        <span className="mt-1 block truncate text-xs text-blue-800/75">{attachedMailLink.sender}</span>
                      </span>
                      <ChevronDown className={cn('mt-1 size-4 shrink-0 text-blue-700 transition-transform duration-200', mailExpanded && 'rotate-180')} aria-hidden="true" />
                    </button>
                    <div className="flex items-start border-l border-blue-200 p-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11 text-blue-800 hover:bg-blue-100"
                        aria-label="Убрать письмо"
                        onClick={() => {
                          setAttachedMailLink(null)
                          setMailExpanded(false)
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {mailExpanded && (
                    <div id="attached-mail-conversation" className="max-h-[32rem] overflow-y-auto border-t border-border bg-muted/20 p-4">
                      <AttachedMailConversation link={attachedMailLink} />
                    </div>
                  )}
                </>
              ) : (
                <div className="border-t border-border px-4 py-5 text-center text-xs leading-5 text-muted-foreground">
                  Чтобы прикрепить письмо, откройте его в разделе «Почта» и выберите создание проекта изделия.
                </div>
              )}
            </section>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex gap-2 font-semibold">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                После создания
              </div>
              <p className="mt-2 text-xs leading-5 text-emerald-800">
                Проект получит статус «Ожидает инженера», а выбранному специалисту автоматически создастся задача.
              </p>
            </div>
          </aside>
        )}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-end sm:px-6">
        <Button type="button" variant="outline" className="min-h-11 sm:min-w-28" onClick={() => router.push(ROUTES.PRODUCT_PROJECTS)} disabled={isSubmitting}>
          Отмена
        </Button>
        <LoadingButton type="submit" loading={isSubmitting} className="min-h-11 bg-primary px-6 text-primary-foreground hover:bg-primary/90 sm:min-w-44">
          {isEdit ? 'Сохранить изменения' : 'Создать проект'}
        </LoadingButton>
      </div>
    </form>
  )
}
