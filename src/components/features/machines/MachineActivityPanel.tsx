'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AtSign, Check, ChevronsUpDown, History, MessageSquare, Pencil, Save, Send, Trash2, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  createMachineUpdate,
  deleteMachineUpdate,
  editMachineUpdate,
  sendMachineChatMessage,
  type MachineActivityPayload,
  type MachineMentionUser,
  type MachineUpdateItem,
} from '@/lib/actions/machine-activity'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingButton } from '@/components/ui/loading-button'
import { Textarea } from '@/components/ui/textarea'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type MachineActivityPanelProps = {
  machineId: string
  activity: MachineActivityPayload
}

function activityDate(value: string) {
  return format(new Date(value), 'dd MMM, HH:mm', { locale: ru })
}

function userMeta(user: MachineMentionUser) {
  const departments = user.department_names.join(', ')
  const positions = user.position_names.join(', ')
  return [departments, positions].filter(Boolean).join(' · ')
}

function normalizedUserSearch(user: MachineMentionUser) {
  return [
    user.full_name,
    user.role || '',
    ...user.department_names,
    ...user.position_names,
  ].join(' ').toLowerCase()
}

function MentionPicker({
  users,
  selectedIds,
  disabled,
  onSelect,
}: {
  users: MachineMentionUser[]
  selectedIds: string[]
  disabled?: boolean
  onSelect: (user: MachineMentionUser) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const normalizedSearch = search.trim().toLowerCase()
  const filteredUsers = useMemo(() => {
    if (!normalizedSearch) return users
    return users.filter((user) => normalizedUserSearch(user).includes(normalizedSearch))
  }, [normalizedSearch, users])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }

  function handleSelect(user: MachineMentionUser) {
    onSelect(user)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            aria-label="Отметить пользователя"
            className="h-10 min-w-32 justify-between border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <span className="inline-flex items-center gap-2">
              <AtSign className="h-4 w-4" />
              Отметить
            </span>
            <ChevronsUpDown className="h-4 w-4 text-slate-400" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-80 max-w-[calc(100vw-2rem)] border-slate-200 bg-white p-0 shadow-xl">
        <Command shouldFilter={false} className="rounded-xl bg-white">
          <CommandInput autoFocus value={search} onValueChange={setSearch} placeholder="Поиск сотрудника" />
          <CommandList className="max-h-72">
            <CommandEmpty>Сотрудник не найден</CommandEmpty>
            <CommandGroup>
              {filteredUsers.map((user) => {
                const selected = selectedSet.has(user.id)
                return (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    onSelect={() => handleSelect(user)}
                    className="items-start gap-3 py-2.5"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{user.full_name}</span>
                      <span className="mt-0.5 block line-clamp-2 text-xs text-slate-500">{userMeta(user) || 'Без отдела'}</span>
                    </span>
                    <Check className={cn('mt-1 h-4 w-4 shrink-0 text-blue-600', selected ? 'opacity-100' : 'opacity-0')} />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function MachineActivityPanel({ machineId, activity }: MachineActivityPanelProps) {
  const router = useRouter()
  const [updates, setUpdates] = useState(activity.updates)
  const [messages, setMessages] = useState(activity.messages)
  const [updateDraft, setUpdateDraft] = useState('')
  const [chatDraft, setChatDraft] = useState('')
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([])
  const [savingUpdate, setSavingUpdate] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [busyUpdateId, setBusyUpdateId] = useState<string | null>(null)

  useEffect(() => {
    setUpdates(activity.updates)
    setMessages(activity.messages)
  }, [activity.updates, activity.messages])

  const selectedMentionUsers = useMemo(
    () => selectedMentionIds
      .map((id) => activity.mentionUsers.find((user) => user.id === id))
      .filter((user): user is MachineMentionUser => Boolean(user)),
    [activity.mentionUsers, selectedMentionIds],
  )

  function toggleMention(user: MachineMentionUser) {
    setSelectedMentionIds((current) => {
      if (current.includes(user.id)) return current.filter((id) => id !== user.id)
      return [...current, user.id]
    })
    const token = `@${user.full_name}`
    setChatDraft((current) => current.includes(token) ? current : `${current}${current.trim() ? ' ' : ''}${token} `)
  }

  async function handleCreateUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingUpdate(true)
    try {
      const result = await createMachineUpdate(machineId, updateDraft)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить обновление')
      setUpdateDraft('')
      toast.success('Обновление добавлено')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить обновление')
    } finally {
      setSavingUpdate(false)
    }
  }

  function startEdit(update: MachineUpdateItem) {
    setEditingUpdateId(update.id)
    setEditingBody(update.body)
  }

  async function handleSaveEdit(updateId: string) {
    setBusyUpdateId(updateId)
    try {
      const result = await editMachineUpdate(machineId, updateId, editingBody)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить запись')
      setEditingUpdateId(null)
      setEditingBody('')
      toast.success('Обновление сохранено')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить запись')
    } finally {
      setBusyUpdateId(null)
    }
  }

  async function handleDeleteUpdate(updateId: string) {
    if (!window.confirm('Удалить обновление из ленты?')) return

    setBusyUpdateId(updateId)
    try {
      const result = await deleteMachineUpdate(machineId, updateId)
      if (!result.success) throw new Error(result.error || 'Не удалось удалить обновление')
      setUpdates((current) => current.filter((update) => update.id !== updateId))
      toast.success('Обновление удалено')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить обновление')
    } finally {
      setBusyUpdateId(null)
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSendingMessage(true)
    try {
      const result = await sendMachineChatMessage(machineId, chatDraft, selectedMentionIds)
      if (!result.success) throw new Error(result.error || 'Не удалось отправить сообщение')
      setChatDraft('')
      setSelectedMentionIds([])
      toast.success('Сообщение отправлено')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить сообщение')
    } finally {
      setSendingMessage(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <History className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Последние обновления</h2>
              <p className="mt-0.5 text-sm text-slate-500">Официальная лента менеджера по этой машине.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {activity.canManageUpdates && (
            <form onSubmit={handleCreateUpdate} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <Textarea
                value={updateDraft}
                onChange={(event) => setUpdateDraft(event.target.value)}
                placeholder="Что изменилось по машине?"
                className="min-h-24 resize-none border-slate-200 bg-white text-slate-900"
                maxLength={4000}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">{updateDraft.trim().length}/4000</span>
                <LoadingButton
                  type="submit"
                  loading={savingUpdate}
                  disabled={!updateDraft.trim()}
                  className="min-h-10 bg-blue-950 text-white hover:bg-blue-900"
                >
                  <Save className="h-4 w-4" />
                  Добавить
                </LoadingButton>
              </div>
            </form>
          )}

          {updates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Пока нет обновлений по этой машине.
            </div>
          ) : (
            <div className="space-y-3">
              {updates.map((update) => {
                const isEditing = editingUpdateId === update.id
                return (
                  <article key={update.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {update.author?.full_name || 'Неизвестный пользователь'}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {activityDate(update.created_at)}
                          {update.updated_at !== update.created_at && ' · изменено'}
                        </div>
                      </div>
                      {activity.canManageUpdates && (
                        <div className="flex shrink-0 items-center gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Отменить редактирование"
                                onClick={() => {
                                  setEditingUpdateId(null)
                                  setEditingBody('')
                                }}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                              <LoadingButton
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                loading={busyUpdateId === update.id}
                                aria-label="Сохранить обновление"
                                onClick={() => handleSaveEdit(update.id)}
                              >
                                <Save className="h-4 w-4" />
                              </LoadingButton>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Редактировать обновление"
                                onClick={() => startEdit(update)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <LoadingButton
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                loading={busyUpdateId === update.id}
                                aria-label="Удалить обновление"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => handleDeleteUpdate(update.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </LoadingButton>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <Textarea
                        value={editingBody}
                        onChange={(event) => setEditingBody(event.target.value)}
                        className="min-h-28 resize-none border-slate-200 bg-white text-slate-900"
                        maxLength={4000}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{update.body}</p>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <MessageSquare className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Чат машины</h2>
              <p className="mt-0.5 text-sm text-slate-500">Обсуждение с уведомлениями для структуры и отмеченных пользователей.</p>
            </div>
          </div>
        </div>

        <div className="flex min-h-[520px] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-sm text-slate-500">
                В чате пока нет сообщений.
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    'rounded-xl border px-4 py-3',
                    message.message_kind === 'system'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-slate-200 bg-slate-50'
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {message.message_kind === 'system' ? 'Система' : message.author?.full_name || 'Неизвестный пользователь'}
                        </div>
                        {message.message_kind === 'system' && (
                          <Badge variant="outline" className="border-amber-200 bg-white/70 text-amber-800">
                            Автоматически
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{activityDate(message.created_at)}</div>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{message.body}</p>
                  {message.mentions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {message.mentions.map((mention) => (
                        <Badge key={`${message.id}-${mention.id}`} variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                          @{mention.full_name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <form onSubmit={handleSendMessage} className="space-y-3 border-t border-slate-100 bg-white p-5">
            {selectedMentionUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedMentionUsers.map((user) => (
                  <Badge key={user.id} variant="outline" className="h-7 gap-1 border-blue-200 bg-blue-50 text-blue-700">
                    @{user.full_name}
                    <button
                      type="button"
                      aria-label={`Убрать ${user.full_name}`}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-blue-100"
                      onClick={() => setSelectedMentionIds((current) => current.filter((id) => id !== user.id))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <Textarea
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder="Напишите сообщение по машине"
              className="min-h-24 resize-none border-slate-200 bg-white text-slate-900"
              maxLength={4000}
              disabled={!activity.canSendChat}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <MentionPicker
                users={activity.mentionUsers}
                selectedIds={selectedMentionIds}
                disabled={!activity.canSendChat || sendingMessage}
                onSelect={toggleMention}
              />
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-xs text-slate-500">{chatDraft.trim().length}/4000</span>
                <LoadingButton
                  type="submit"
                  loading={sendingMessage}
                  disabled={!activity.canSendChat || !chatDraft.trim()}
                  className="min-h-10 bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Send className="h-4 w-4" />
                  Отправить
                </LoadingButton>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
  )
}
