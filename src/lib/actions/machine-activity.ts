'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import {
  MAX_MACHINE_CHAT_ATTACHMENTS,
  MAX_MACHINE_CHAT_ATTACHMENT_SIZE,
  decodeMachineChatBody,
  encodeMachineChatBody,
  toPublicMachineChatAttachment,
  type MachineChatAttachment,
  type MachineChatAttachmentKind,
  type StoredMachineChatAttachment,
} from '@/lib/machine-chat-attachments'
import type { CurrentUser, UserRole } from '@/lib/types'

const DIRECTOR_ROLES: readonly UserRole[] = ['planning_director', 'financial_director', 'commercial_director']
const MACHINE_CHAT_NOTIFICATION_TYPE = 'machine_chat_message'
const RECIPIENT_KEYWORDS = [
  'финанс',
  'бухгалтер',
  'finance',
  'account',
  'снаб',
  'закуп',
  'постач',
  'supply',
  'procurement',
  'purchase',
  'технолог',
  'technolog',
  'инженер',
  'конструкт',
  'engineer',
] as const

const machineIdSchema = z.string().uuid('Некорректный ID машины')
const updateIdSchema = z.string().uuid('Некорректный ID обновления')
const bodySchema = z.string().trim().min(1, 'Введите текст').max(4000, 'Текст не должен превышать 4000 символов')
const chatBodySchema = z.string().trim().max(4000, 'Текст не должен превышать 4000 символов')
const mentionIdsSchema = z.array(z.string().uuid()).max(50).optional().default([])

type DbError = { message?: string; code?: string; details?: string; hint?: string }
type DbResult<T = unknown> = { data: T | null; error: DbError | null }
type LooseQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select: (columns?: string) => LooseQuery<T>
  insert: (values: unknown) => LooseQuery<T>
  update: (values: unknown) => LooseQuery<T>
  eq: (column: string, value: unknown) => LooseQuery<T>
  in: (column: string, values: unknown[]) => LooseQuery<T>
  is: (column: string, value: unknown) => LooseQuery<T>
  or: (filters: string) => LooseQuery<T>
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery<T>
  limit: (count: number) => LooseQuery<T>
  maybeSingle: () => Promise<DbResult<T>>
  single: () => Promise<DbResult<T>>
}
type LooseDb = {
  from: (table: string) => LooseQuery
}

type Relation<T> = T | T[] | null
type UserSummaryRow = {
  id: string
  full_name: string
  role?: UserRole | null
}
type MachineAccessRow = {
  id: string
  name: string
  created_by: string
  factory_id: string | null
  is_archived: boolean | null
}
type MachineUpdateRow = {
  id: string
  machine_id: string
  body: string
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  message_kind?: string | null
  system_event_key?: string | null
}
type MachineChatMessageRow = {
  id: string
  machine_id: string
  body: string
  created_by: string | null
  message_kind?: string | null
  system_event_key?: string | null
  created_at: string
}
type MachineChatMentionRow = {
  id: string
  message_id: string
  machine_id: string
  user_id: string
  created_at: string
}
type DepartmentRelation = {
  id: string
  name: string
  parent_id: string | null
  is_active: boolean
}
type PositionRelation = {
  id: string
  name: string
  level: number | null
  is_active?: boolean | null
}
type DepartmentMemberRecipientRow = {
  user_id: string
  user: Relation<UserSummaryRow & { is_active?: boolean | null }>
  department: Relation<DepartmentRelation>
  position: Relation<PositionRelation>
}

export type MachineMentionUser = {
  id: string
  full_name: string
  role: UserRole | null
  department_names: string[]
  position_names: string[]
}

export type MachineUpdateItem = {
  id: string
  body: string
  created_at: string
  updated_at: string
  author: { id: string; full_name: string } | null
  editor: { id: string; full_name: string } | null
  message_kind: 'user' | 'system'
  system_event_key: string | null
}

export type MachineChatMessageItem = {
  id: string
  body: string
  created_at: string
  message_kind: 'user' | 'system'
  system_event_key: string | null
  author: { id: string; full_name: string } | null
  mentions: Array<{ id: string; full_name: string }>
  attachments: MachineChatAttachment[]
}

export type MachineActivityPayload = {
  updates: MachineUpdateItem[]
  messages: MachineChatMessageItem[]
  mentionUsers: MachineMentionUser[]
  canManageUpdates: boolean
  canSendChat: boolean
}

function relationOne<T>(value: Relation<T> | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function dbFrom(value: unknown): LooseDb {
  return value as LooseDb
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function hasRecipientKeyword(...values: Array<string | null | undefined>) {
  const haystack = values.map(normalizeText).join(' ')
  return RECIPIENT_KEYWORDS.some((keyword) => haystack.includes(keyword))
}

function normalizeFileName(value: string) {
  return value
    .replace(/[\\/]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'file'
}

function fileExtension(name: string, kind: MachineChatAttachmentKind) {
  const match = name.match(/\.([A-Za-z0-9]{1,12})$/)
  if (match) return `.${match[1].toLowerCase()}`
  return kind === 'pdf' ? '.pdf' : '.jpg'
}

function detectAttachmentKind(file: File): MachineChatAttachmentKind | null {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)) return 'image'
  return null
}

function assertChatAttachmentFile(file: File) {
  if (!file || file.size === 0) throw new Error('Выберите файл для чата')
  if (file.size > MAX_MACHINE_CHAT_ATTACHMENT_SIZE) {
    throw new Error('Файл чата не должен превышать 20 МБ')
  }
  const kind = detectAttachmentKind(file)
  if (!kind) throw new Error('В чат машины можно загрузить только PDF или фото')
  return kind
}

async function uploadChatAttachments(
  admin: ReturnType<typeof createAdminClient>,
  machineId: string,
  files: File[],
) {
  if (files.length > MAX_MACHINE_CHAT_ATTACHMENTS) {
    throw new Error(`Можно прикрепить не больше ${MAX_MACHINE_CHAT_ATTACHMENTS} файлов`)
  }

  const attachments: StoredMachineChatAttachment[] = []
  const uploadedPaths: string[] = []
  try {
    for (const file of files) {
      const kind = assertChatAttachmentFile(file)
      const fileName = normalizeFileName(file.name)
      const mimeType = file.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream')
      const path = `machine-chat/${machineId}/${Date.now()}-${randomUUID()}${fileExtension(fileName, kind)}`
      const { error } = await admin.storage.from('product-files').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeType,
      })

      if (error) throw new Error(error.message || 'Не удалось загрузить файл в чат')
      uploadedPaths.push(path)
      attachments.push({
        id: randomUUID(),
        fileName,
        mimeType,
        fileSize: file.size,
        kind,
        path,
      })
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await admin.storage.from('product-files').remove(uploadedPaths).catch(() => undefined)
    }
    throw error
  }

  return attachments
}

function canManageMachineUpdates(user: CurrentUser, machine: MachineAccessRow) {
  return machine.created_by === user.id || DIRECTOR_ROLES.includes(user.role)
}

function applyProductionManagerMachineScope<T>(query: T, factoryId: string | null): T {
  const scopedQuery = query as { or: (filters: string) => T; is: (column: string, value: unknown) => T }
  if (!factoryId) return scopedQuery.is('factory_id', null)
  return scopedQuery.or(`factory_id.eq.${factoryId},factory_id.is.null`)
}

async function requireMachineAccess(machineId: string) {
  const parsedMachineId = machineIdSchema.parse(machineId)
  const context = await requirePermission('sales_plan', 'view')

  let query = context.supabase
    .from('machines')
    .select('id, name, created_by, factory_id, is_archived')
    .eq('id', parsedMachineId)

  if (context.role === 'production_manager') {
    query = applyProductionManagerMachineScope(query, context.factoryId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Машина не найдена или недоступна')

  return {
    machine: data as MachineAccessRow,
    user: context.user,
  }
}

function assertMachineWritable(machine: MachineAccessRow) {
  if (machine.is_archived) {
    throw new Error('Машина архивирована. Действия с ней остановлены.')
  }
}

function assertCanManageUpdates(user: CurrentUser, machine: MachineAccessRow) {
  if (!canManageMachineUpdates(user, machine)) {
    throw new Error('Последние обновления может вести менеджер машины или директор')
  }
}

async function loadUsersByIds(db: LooseDb, userIds: string[]) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)))
  const usersById = new Map<string, UserSummaryRow>()
  if (uniqueIds.length === 0) return usersById

  const { data, error } = await db
    .from('users')
    .select('id, full_name, role')
    .in('id', uniqueIds)

  if (error) throw error
  for (const user of ((data || []) as UserSummaryRow[])) {
    usersById.set(user.id, user)
  }
  return usersById
}

async function loadMentionUsers(db: LooseDb): Promise<MachineMentionUser[]> {
  const [{ data: usersData, error: usersError }, { data: membersData, error: membersError }] = await Promise.all([
    db.from('users').select('id, full_name, role').eq('is_active', true).order('full_name', { ascending: true }),
    db
      .from('department_members')
      .select(`
        user_id,
        user:users!department_members_user_id_fkey!inner(id, full_name, role, is_active),
        department:departments!inner(id, name, parent_id, is_active),
        position:positions(id, name, level)
      `)
      .eq('user.is_active', true)
      .eq('department.is_active', true),
  ])

  if (usersError) throw usersError
  if (membersError) throw membersError

  const metaByUser = new Map<string, { departments: Set<string>; positions: Set<string> }>()
  for (const row of ((membersData || []) as DepartmentMemberRecipientRow[])) {
    const department = relationOne(row.department)
    const position = relationOne(row.position)
    const meta = metaByUser.get(row.user_id) || { departments: new Set<string>(), positions: new Set<string>() }
    if (department?.name) meta.departments.add(department.name)
    if (position?.name) meta.positions.add(position.name)
    metaByUser.set(row.user_id, meta)
  }

  return ((usersData || []) as UserSummaryRow[])
    .map((user) => {
      const meta = metaByUser.get(user.id)
      return {
        id: user.id,
        full_name: user.full_name,
        role: user.role || null,
        department_names: meta ? Array.from(meta.departments).sort((a, b) => a.localeCompare(b, 'ru')) : [],
        position_names: meta ? Array.from(meta.positions).sort((a, b) => a.localeCompare(b, 'ru')) : [],
      }
    })
    .sort((left, right) => left.full_name.localeCompare(right.full_name, 'ru'))
}

async function loadStructureRecipientIds(db: LooseDb) {
  const [{ data: membersData, error: membersError }, { data: departmentsData, error: departmentsError }] = await Promise.all([
    db
      .from('department_members')
      .select(`
        user_id,
        user:users!department_members_user_id_fkey!inner(id, full_name, role, is_active),
        department:departments!inner(id, name, parent_id, is_active),
        position:positions(id, name, level)
      `)
      .eq('user.is_active', true)
      .eq('department.is_active', true),
    db.from('departments').select('id, name, parent_id, is_active').eq('is_active', true),
  ])

  if (membersError) throw membersError
  if (departmentsError) throw departmentsError

  const departmentsById = new Map<string, DepartmentRelation>()
  for (const department of ((departmentsData || []) as DepartmentRelation[])) {
    departmentsById.set(department.id, department)
  }

  const recipientIds = new Set<string>()
  for (const row of ((membersData || []) as DepartmentMemberRecipientRow[])) {
    const department = relationOne(row.department)
    const position = relationOne(row.position)
    const parent = department?.parent_id ? departmentsById.get(department.parent_id) || null : null
    if (hasRecipientKeyword(department?.name, parent?.name, position?.name)) {
      recipientIds.add(row.user_id)
    }
  }

  return recipientIds
}

function mapUpdate(row: MachineUpdateRow, usersById: Map<string, UserSummaryRow>): MachineUpdateItem {
  const author = usersById.get(row.created_by)
  const editor = row.updated_by ? usersById.get(row.updated_by) : null
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: author ? { id: author.id, full_name: author.full_name } : null,
    editor: editor ? { id: editor.id, full_name: editor.full_name } : null,
    message_kind: row.message_kind === 'system' ? 'system' : 'user',
    system_event_key: row.system_event_key || null,
  }
}

function mapMessage(
  row: MachineChatMessageRow,
  usersById: Map<string, UserSummaryRow>,
  mentionsByMessage: Map<string, MachineChatMentionRow[]>,
): MachineChatMessageItem {
  const decodedBody = decodeMachineChatBody(row.body)
  const author = row.created_by ? usersById.get(row.created_by) : null
  const mentions = (mentionsByMessage.get(row.id) || [])
    .map((mention) => usersById.get(mention.user_id))
    .filter((user): user is UserSummaryRow => Boolean(user))
    .map((user) => ({ id: user.id, full_name: user.full_name }))

  return {
    id: row.id,
    body: decodedBody.text,
    created_at: row.created_at,
    message_kind: row.message_kind === 'system' ? 'system' : 'user',
    system_event_key: row.system_event_key || null,
    author: author ? { id: author.id, full_name: author.full_name } : null,
    mentions,
    attachments: decodedBody.attachments.map((attachment) => toPublicMachineChatAttachment(row.id, attachment)),
  }
}

function notificationMessage(authorName: string, body: string) {
  const compactBody = body.replace(/\s+/g, ' ').trim()
  const preview = compactBody.length > 180 ? `${compactBody.slice(0, 177)}...` : compactBody
  return `${authorName}: ${preview}`
}

function activityPaths(machineId: string) {
  return [`${ROUTES.SALES_PLAN}/${machineId}`, ROUTES.NOTIFICATIONS]
}

function revalidateActivity(machineId: string) {
  for (const path of activityPaths(machineId)) {
    revalidatePath(path)
  }
}

export async function getMachineActivity(machineId: string): Promise<{ data: MachineActivityPayload | null; error: string | null }> {
  try {
    const { machine, user } = await requireMachineAccess(machineId)
    const db = dbFrom(createAdminClient())

    const [{ data: updatesData, error: updatesError }, { data: messagesData, error: messagesError }, mentionUsers] = await Promise.all([
      db
        .from('machine_updates')
        .select('id, machine_id, body, created_by, updated_by, created_at, updated_at, message_kind, system_event_key')
        .eq('machine_id', machine.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10),
      db
        .from('machine_chat_messages')
        .select('id, machine_id, body, created_by, message_kind, system_event_key, created_at')
        .eq('machine_id', machine.id)
        .order('created_at', { ascending: false })
        .limit(50),
      loadMentionUsers(db),
    ])

    if (updatesError) throw updatesError
    if (messagesError) throw messagesError

    const updates = (updatesData || []) as MachineUpdateRow[]
    const messages = ((messagesData || []) as MachineChatMessageRow[]).reverse()
    const messageIds = messages.map((message) => message.id)

    let mentions: MachineChatMentionRow[] = []
    if (messageIds.length > 0) {
      const { data: mentionsData, error: mentionsError } = await db
        .from('machine_chat_mentions')
        .select('id, message_id, machine_id, user_id, created_at')
        .in('message_id', messageIds)

      if (mentionsError) throw mentionsError
      mentions = (mentionsData || []) as MachineChatMentionRow[]
    }

    const userIds = [
      ...updates.flatMap((update) => [update.created_by, update.updated_by].filter((id): id is string => Boolean(id))),
      ...messages.map((message) => message.created_by).filter((id): id is string => Boolean(id)),
      ...mentions.map((mention) => mention.user_id),
    ]
    const usersById = await loadUsersByIds(db, userIds)
    const mentionsByMessage = new Map<string, MachineChatMentionRow[]>()
    for (const mention of mentions) {
      const list = mentionsByMessage.get(mention.message_id) || []
      list.push(mention)
      mentionsByMessage.set(mention.message_id, list)
    }

    return {
      data: {
        updates: updates.map((update) => mapUpdate(update, usersById)),
        messages: messages.map((message) => mapMessage(message, usersById, mentionsByMessage)),
        mentionUsers,
        canManageUpdates: !machine.is_archived && canManageMachineUpdates(user, machine),
        canSendChat: !machine.is_archived,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createMachineUpdate(machineId: string, body: string) {
  try {
    const parsedBody = bodySchema.parse(body)
    const { machine, user } = await requireMachineAccess(machineId)
    assertMachineWritable(machine)
    assertCanManageUpdates(user, machine)

    const db = dbFrom(createAdminClient())
    const { error } = await db.from('machine_updates').insert({
      machine_id: machine.id,
      body: parsedBody,
      created_by: user.id,
      updated_by: user.id,
    })

    if (error) throw error
    revalidateActivity(machine.id)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function editMachineUpdate(machineId: string, updateId: string, body: string) {
  try {
    const parsedUpdateId = updateIdSchema.parse(updateId)
    const parsedBody = bodySchema.parse(body)
    const { machine, user } = await requireMachineAccess(machineId)
    assertMachineWritable(machine)
    assertCanManageUpdates(user, machine)

    const db = dbFrom(createAdminClient())
    const { data: existing, error: existingError } = await db
      .from('machine_updates')
      .select('id')
      .eq('id', parsedUpdateId)
      .eq('machine_id', machine.id)
      .eq('message_kind', 'user')
      .is('deleted_at', null)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) throw new Error('Обновление не найдено')

    const { error } = await db
      .from('machine_updates')
      .update({ body: parsedBody, updated_by: user.id })
      .eq('id', parsedUpdateId)
      .eq('machine_id', machine.id)
      .eq('message_kind', 'user')

    if (error) throw error
    revalidateActivity(machine.id)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function deleteMachineUpdate(machineId: string, updateId: string) {
  try {
    const parsedUpdateId = updateIdSchema.parse(updateId)
    const { machine, user } = await requireMachineAccess(machineId)
    assertMachineWritable(machine)
    assertCanManageUpdates(user, machine)

    const db = dbFrom(createAdminClient())
    const { data: existing, error: existingError } = await db
      .from('machine_updates')
      .select('id')
      .eq('id', parsedUpdateId)
      .eq('machine_id', machine.id)
      .eq('message_kind', 'user')
      .is('deleted_at', null)
      .maybeSingle()

    if (existingError) throw existingError
    if (!existing) throw new Error('Обновление не найдено')

    const { error } = await db
      .from('machine_updates')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
      })
      .eq('id', parsedUpdateId)
      .eq('machine_id', machine.id)
      .eq('message_kind', 'user')

    if (error) throw error
    revalidateActivity(machine.id)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function sendMachineChatMessage(machineId: string, formData: FormData) {
  let uploadedPaths: string[] = []
  let messageCreated = false

  try {
    const rawBody = String(formData.get('body') || '')
    const parsedBody = chatBodySchema.parse(rawBody)
    const parsedMentionIds = Array.from(new Set(mentionIdsSchema.parse(
      formData.getAll('mention_user_ids').map((value) => String(value)),
    )))
    const files = formData
      .getAll('attachments')
      .filter((value): value is File => value instanceof File && value.size > 0)

    if (!parsedBody && files.length === 0) {
      throw new Error('Введите сообщение или добавьте файл')
    }

    const { machine, user } = await requireMachineAccess(machineId)
    assertMachineWritable(machine)

    const admin = createAdminClient()
    const db = dbFrom(admin)
    const activeMentionIds = new Set<string>()
    if (parsedMentionIds.length > 0) {
      const { data: activeUsers, error: activeUsersError } = await db
        .from('users')
        .select('id')
        .in('id', parsedMentionIds)
        .eq('is_active', true)

      if (activeUsersError) throw activeUsersError
      for (const activeUser of ((activeUsers || []) as Array<{ id: string }>)) {
        activeMentionIds.add(activeUser.id)
      }
    }

    const attachments = await uploadChatAttachments(admin, machine.id, files)
    uploadedPaths = attachments.map((attachment) => attachment.path)
    const storedBody = bodySchema.parse(encodeMachineChatBody(parsedBody, attachments))

    const { data: createdMessage, error: messageError } = await db
      .from('machine_chat_messages')
      .insert({
        machine_id: machine.id,
        body: storedBody,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (messageError) throw messageError
    messageCreated = true
    const messageId = (createdMessage as { id: string }).id

    if (activeMentionIds.size > 0) {
      const { error: mentionsError } = await db.from('machine_chat_mentions').insert(
        Array.from(activeMentionIds).map((mentionedUserId) => ({
          message_id: messageId,
          machine_id: machine.id,
          user_id: mentionedUserId,
        })),
      )

      if (mentionsError) throw mentionsError
    }

    const structureRecipientIds = await loadStructureRecipientIds(db)
    const recipientIds = new Set<string>([...structureRecipientIds, ...activeMentionIds])
    recipientIds.delete(user.id)

    if (recipientIds.size > 0) {
      const previewBody = parsedBody || `Вложений: ${attachments.length}`
      const { error: notificationError } = await db.from('notifications').insert(
        Array.from(recipientIds).map((recipientId) => ({
          user_id: recipientId,
          type: MACHINE_CHAT_NOTIFICATION_TYPE,
          title: 'Новое сообщение в чате машины',
          message: notificationMessage(user.full_name, previewBody),
          related_machine_id: machine.id,
        })),
      )

      if (notificationError) throw notificationError
    }

    await dispatchPendingTelegramDeliveries({ machineId: machine.id })
    revalidateActivity(machine.id)
    return { success: true, error: null }
  } catch (error) {
    if (!messageCreated && uploadedPaths.length > 0) {
      await createAdminClient().storage.from('product-files').remove(uploadedPaths).catch(() => undefined)
    }
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function createSystemMachineChatMessage(input: {
  machineId: string
  body: string
  eventKey?: string | null
  excludeUserId?: string | null
}) {
  const parsedMachineId = machineIdSchema.parse(input.machineId)
  const parsedBody = bodySchema.parse(input.body)
  const db = dbFrom(createAdminClient())

  const { data: machineData, error: machineError } = await db
    .from('machines')
    .select('id, is_archived')
    .eq('id', parsedMachineId)
    .maybeSingle()

  if (machineError) throw machineError
  if (!machineData) throw new Error('Машина не найдена')

  const { error: messageError } = await db.from('machine_chat_messages').insert({
    machine_id: parsedMachineId,
    body: parsedBody,
    created_by: null,
    message_kind: 'system',
    system_event_key: input.eventKey || null,
  })

  if (messageError) throw messageError

  const recipientIds = await loadStructureRecipientIds(db)
  if (input.excludeUserId) recipientIds.delete(input.excludeUserId)

  if (recipientIds.size > 0) {
    const { error: notificationError } = await db.from('notifications').insert(
      Array.from(recipientIds).map((recipientId) => ({
        user_id: recipientId,
        type: MACHINE_CHAT_NOTIFICATION_TYPE,
        title: 'Системное сообщение в чате машины',
        message: notificationMessage('Система', parsedBody),
        related_machine_id: parsedMachineId,
      })),
    )

    if (notificationError) throw notificationError
  }

  await dispatchPendingTelegramDeliveries({ machineId: parsedMachineId })
  revalidateActivity(parsedMachineId)
}
