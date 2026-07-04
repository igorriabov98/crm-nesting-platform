import 'server-only'

import { NextResponse } from 'next/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { getProject } from '@/lib/nesting/api'
import { requirePermission } from '@/lib/permissions/server'
import type { NestingProxyContext } from '@/lib/nesting/proxy-auth'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'

type AccessContext = {
  supabase: unknown
  userId: string
  role?: UserRole | null
  isDirector?: boolean
}

type LooseResult = {
  data: unknown
  error: { message?: string } | null
}

type LooseQuery = PromiseLike<LooseResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  limit: (count: number) => LooseQuery
}

type LooseDb = {
  from: (table: string) => LooseQuery
}

export class NestingProjectAccessError extends Error {
  readonly status = 403

  constructor() {
    super('Нет доступа к проекту раскладки')
    this.name = 'NestingProjectAccessError'
  }
}

async function hasCrmProjectLink(context: AccessContext, projectId: string) {
  const db = context.supabase as LooseDb
  const [runResult, batchResult] = await Promise.all([
    db
      .from('machine_item_nesting_runs')
      .select('id')
      .eq('nesting_project_id', projectId)
      .limit(1),
    db
      .from('nesting_batches')
      .select('id')
      .eq('nesting_project_id', projectId)
      .limit(1),
  ])

  if (runResult.error) throw new Error(runResult.error.message || 'Не удалось проверить связь раскладки с CRM')
  if (batchResult.error) throw new Error(batchResult.error.message || 'Не удалось проверить пакет раскладки в CRM')

  return hasRows(runResult.data) || hasRows(batchResult.data)
}

async function hasServiceProjectOwner(context: AccessContext, projectId: string) {
  const project = await getProject(projectId)
  return project.data.createdBy === context.userId
}

export async function canAccessNestingProject(context: AccessContext, projectId: string) {
  if (context.isDirector || (context.role && DIRECTOR_ROLES.includes(context.role))) return true
  if (await hasCrmProjectLink(context, projectId)) return true
  return hasServiceProjectOwner(context, projectId)
}

export async function assertCanAccessNestingProject(projectId: string, operation: PermissionOperation = 'view') {
  const context = await requirePermission('nesting', operation)
  if (await canAccessNestingProject(context, projectId)) return context
  throw new NestingProjectAccessError()
}

export async function requireNestingProjectProxyAccess(projectId: string, context: NestingProxyContext) {
  try {
    if (await canAccessNestingProject(context, projectId)) return null
    return NextResponse.json({ error: 'Нет доступа к проекту раскладки' }, { status: 403 })
  } catch (error) {
    if (error instanceof NestingProjectAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      {
        error: `Не удалось проверить доступ к проекту раскладки: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`,
      },
      { status: 503 }
    )
  }
}

function hasRows(value: unknown) {
  return Array.isArray(value) && value.length > 0
}
