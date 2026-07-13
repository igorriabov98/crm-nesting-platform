'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { requireAccessSettingsPermission } from '@/lib/permissions/server'
import { PERMISSION_RESOURCES } from '@/lib/permissions/resources'
import { ROUTES } from '@/lib/constants/routes'
import { getAccessPreviewForUser, type UserAccessPreview } from '@/lib/actions/role-permissions'
import {
  backupOriginalSession,
  clearImpersonationSession,
  getImpersonationContext,
  restoreOriginalSession,
} from '@/lib/auth/impersonation'
import type { ImpersonationMarker } from '@/lib/auth/impersonation-state'

type QueryError = { message?: string } | null
type QueryResult<T> = { data: T | null; error: QueryError }
type LooseQuery<T = unknown> = PromiseLike<QueryResult<T>> & {
  insert: (values: unknown) => LooseQuery<T>
  update: (values: unknown) => LooseQuery<T>
  select: (columns?: string) => LooseQuery<T>
  eq: (column: string, value: unknown) => LooseQuery<T>
  maybeSingle: () => LooseQuery<T>
}
type LooseDb = { from: <T = unknown>(table: string) => LooseQuery<T> }

type TargetUser = {
  id: string
  email: string
  full_name: string | null
  is_active: boolean | null
}

export async function startUserImpersonation(targetUserId: string) {
  let marker: ImpersonationMarker | null = null
  let auditId: string | null = null
  const adminSupabase = createAdminClient()
  const auditDb = adminSupabase as unknown as LooseDb

  try {
    const context = await requireAccessSettingsPermission()
    if (!context.permissionDetails.isAdminPosition) {
      throw new Error('Войти от лица сотрудника может только Администратор CRM')
    }
    if (await getImpersonationContext()) {
      throw new Error('Сначала завершите текущий режим проверки доступа')
    }
    if (!targetUserId || targetUserId === context.userId) {
      throw new Error('Выберите другого пользователя')
    }

    const { data: targetData, error: targetError } = await adminSupabase
      .from('users')
      .select('id, email, full_name, is_active')
      .eq('id', targetUserId)
      .maybeSingle()
    const target = targetData as TargetUser | null
    if (targetError || !target) throw new Error('Пользователь не найден')
    if (target.is_active === false) throw new Error('Нельзя войти от лица заблокированного пользователя')

    const { data: authTarget, error: authTargetError } = await adminSupabase.auth.admin.getUserById(target.id)
    if (authTargetError || !authTarget.user?.email || authTarget.user.id !== target.id) {
      throw new Error('Для пользователя не найдена учётная запись входа')
    }

    const previewResult = await getAccessPreviewForUser(target.id)
    if (!previewResult.data) {
      throw new Error(previewResult.error || 'Не удалось определить стартовую страницу пользователя')
    }

    const { data: auditData, error: auditError } = await auditDb
      .from<{ id: string }>('user_impersonation_audit')
      .insert({
        admin_user_id: context.userId,
        target_user_id: target.id,
        status: 'active',
      })
      .select('id')
      .maybeSingle()
    if (auditError || !auditData?.id) {
      throw new Error(auditError?.message || 'Не удалось создать запись аудита')
    }
    auditId = auditData.id

    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: authTarget.user.email,
    })
    if (linkError || !linkData.properties?.hashed_token) {
      throw new Error(linkError?.message || 'Не удалось открыть сессию пользователя')
    }

    marker = await backupOriginalSession({
      version: 1,
      auditId,
      adminUserId: context.userId,
      adminName: context.user.full_name || context.user.email,
      targetUserId: target.id,
      targetName: target.full_name || target.email,
      startedAt: new Date().toISOString(),
    })

    const supabase = await createServerSupabaseClient()
    const { data: verification, error: verificationError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    })
    if (verificationError || verification.user?.id !== target.id) {
      throw new Error(verificationError?.message || 'Сессия открылась не для выбранного пользователя')
    }

    return {
      success: true as const,
      error: null,
      redirectTo: getTargetLandingPath(previewResult.data),
    }
  } catch (error) {
    let requiresLogin = false
    if (marker) {
      const restored = await restoreOriginalSession(marker)
      requiresLogin = !restored.success
    }
    if (auditId) {
      await updateAudit(auditDb, auditId, 'failed', errorMessage(error))
    }
    return {
      success: false as const,
      error: errorMessage(error, 'Не удалось открыть CRM от лица пользователя'),
      redirectTo: requiresLogin ? ROUTES.LOGIN : null,
    }
  }
}

export async function stopUserImpersonation() {
  const marker = await getImpersonationContext()
  if (!marker) {
    return {
      success: false as const,
      error: 'Режим проверки доступа уже завершён',
      redirectTo: ROUTES.LOGIN,
    }
  }

  const auditDb = createAdminClient() as unknown as LooseDb
  try {
    const restored = await restoreOriginalSession(marker)
    if (!restored.success) {
      await updateAudit(auditDb, marker.auditId, 'failed', restored.error)
      return { success: false as const, error: restored.error, redirectTo: ROUTES.LOGIN }
    }

    await updateAudit(auditDb, marker.auditId, 'completed', null)
    return { success: true as const, error: null, redirectTo: ROUTES.ADMIN_ACCESS_SETTINGS }
  } catch (error) {
    await clearImpersonationSession(marker)
    await updateAudit(auditDb, marker.auditId, 'failed', errorMessage(error))
    return {
      success: false as const,
      error: errorMessage(error, 'Не удалось вернуть сессию администратора'),
      redirectTo: ROUTES.LOGIN,
    }
  }
}

export async function stopUserImpersonationAndRedirect() {
  const result = await stopUserImpersonation()
  redirect(result.redirectTo || ROUTES.LOGIN)
}

function getTargetLandingPath(preview: UserAccessPreview) {
  const permissions = new Map(preview.permissions.map((permission) => [permission.resourceKey, permission]))
  if (permissions.get('tasks')?.canView) return ROUTES.TASKS
  if (permissions.get('dashboard')?.canView) return ROUTES.DASHBOARD
  const firstAllowed = PERMISSION_RESOURCES.find((resource) =>
    permissions.get(resource.key)?.canView
    && 'defaultHref' in resource
    && typeof resource.defaultHref === 'string'
  )
  return firstAllowed && 'defaultHref' in firstAllowed ? firstAllowed.defaultHref : ROUTES.PROFILE
}

async function updateAudit(
  db: LooseDb,
  auditId: string,
  status: 'completed' | 'failed',
  failureReason: string | null,
) {
  await db
    .from('user_impersonation_audit')
    .update({
      status,
      ended_at: new Date().toISOString(),
      failure_reason: failureReason?.slice(0, 500) || null,
    })
    .eq('id', auditId)
}

function errorMessage(error: unknown, fallback = 'Неизвестная ошибка') {
  return error instanceof Error ? error.message : fallback
}
