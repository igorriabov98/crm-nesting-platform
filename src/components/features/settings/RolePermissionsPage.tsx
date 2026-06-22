"use client"

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { ROLES } from '@/lib/constants/roles'
import { saveRolePermissions, type RolePermissionInput, type RolePermissionsPageData } from '@/lib/actions/role-permissions'
import type { ResourceKey } from '@/lib/permissions/resources'
import type { UserRole } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingButton } from '@/components/ui/loading-button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type RolePermissionsPageProps = {
  data: RolePermissionsPageData
}

function permissionKey(role: UserRole, resourceKey: ResourceKey) {
  return `${role}:${resourceKey}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function buildState(permissions: RolePermissionInput[]) {
  return Object.fromEntries(
    permissions.map((permission) => [permissionKey(permission.role, permission.resourceKey), {
      canView: permission.canView || permission.canManage,
      canManage: permission.canManage,
    }])
  ) as Record<string, { canView: boolean; canManage: boolean }>
}

export function RolePermissionsPage({ data }: RolePermissionsPageProps) {
  const router = useRouter()
  const [permissions, setPermissions] = useState(() => buildState(data.permissions))
  const [isSaving, setIsSaving] = useState(false)

  const groupedResources = useMemo(() => {
    const groups = new Map<string, typeof data.resources>()
    for (const resource of data.resources) {
      groups.set(resource.group, [...(groups.get(resource.group) || []), resource])
    }
    return Array.from(groups.entries())
  }, [data.resources])

  function updatePermission(role: UserRole, resourceKey: ResourceKey, field: 'view' | 'manage', checked: boolean) {
    const resource = data.resources.find((item) => item.key === resourceKey)
    if (resource?.locked) return

    setPermissions((current) => {
      const key = permissionKey(role, resourceKey)
      const previous = current[key] || { canView: false, canManage: false }
      const next = { ...previous }

      if (field === 'view') {
        next.canView = checked
        if (!checked) next.canManage = false
      } else {
        next.canManage = checked
        if (checked) next.canView = true
      }

      return { ...current, [key]: next }
    })
  }

  async function onSave() {
    setIsSaving(true)
    try {
      const payload: RolePermissionInput[] = data.roles.flatMap((role) =>
        data.resources
          .filter((resource) => !resource.locked)
          .map((resource) => {
            const state = permissions[permissionKey(role, resource.key)] || { canView: false, canManage: false }
            return {
              role,
              resourceKey: resource.key,
              canView: state.canView || state.canManage,
              canManage: state.canManage,
            }
          })
      )

      const result = await saveRolePermissions(payload)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить права доступа')
      toast.success('Права доступа сохранены')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1B3A6B]/10 text-[#1B3A6B]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1B3A6B]">Права доступа</h1>
              <p className="mt-1 text-sm text-[#6B7280]">
                Управление доступом ролей к разделам CRM. Управление всегда включает просмотр.
              </p>
            </div>
          </div>
          <LoadingButton onClick={onSave} loading={isSaving} className="self-start">
            <Save className="mr-2 h-4 w-4" />
            Сохранить
          </LoadingButton>
        </div>
      </section>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-[#1B3A6B]">Матрица ролей</CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-30 min-w-[220px] bg-white">Раздел</TableHead>
                {data.roles.map((role) => (
                  <TableHead key={role} className="min-w-[150px] text-center">
                    <div className="text-xs font-semibold text-[#1B3A6B]">
                      {ROLES[role]?.label || role}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedResources.map(([group, resources]) => (
                <Fragment key={group}>
                  <TableRow key={`${group}-heading`} className="bg-[#F8F9FA] hover:bg-[#F8F9FA]">
                    <TableCell colSpan={data.roles.length + 1} className="sticky left-0 z-20 min-w-[220px] bg-[#F8F9FA] font-semibold text-[#1B3A6B]">
                      {group}
                    </TableCell>
                  </TableRow>
                  {resources.map((resource) => (
                    <TableRow key={resource.key}>
                      <TableCell className="sticky left-0 z-20 min-w-[220px] bg-white">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#374151]">{resource.label}</span>
                            {resource.locked && <Badge variant="outline">неснимаемо</Badge>}
                          </div>
                          {resource.description && (
                            <p className="max-w-[260px] text-xs font-normal text-[#6B7280]">
                              {resource.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      {data.roles.map((role) => {
                        const state = permissions[permissionKey(role, resource.key)] || { canView: false, canManage: false }
                        const disabled = resource.locked
                        return (
                          <TableCell key={`${role}-${resource.key}`} className="text-center">
                            <div className="flex items-center justify-center gap-3">
                              <label className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                                <Switch
                                  size="sm"
                                  checked={state.canView}
                                  disabled={disabled}
                                  onCheckedChange={(checked) => updatePermission(role, resource.key, 'view', checked === true)}
                                />
                                Вид
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                                <Switch
                                  size="sm"
                                  checked={state.canManage}
                                  disabled={disabled}
                                  onCheckedChange={(checked) => updatePermission(role, resource.key, 'manage', checked === true)}
                                />
                                Упр
                              </label>
                            </div>
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-[#1B3A6B]">Последние изменения</CardTitle>
        </CardHeader>
        <CardContent>
          {data.auditLog.length === 0 ? (
            <p className="text-sm text-[#6B7280]">История изменений пока пустая.</p>
          ) : (
            <div className="space-y-2">
              {data.auditLog.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-[#374151]">
                    <span className="font-medium">{ROLES[item.role]?.label || item.role}</span>
                    <span className="text-[#9CA3AF]"> · </span>
                    <span>{data.resources.find((resource) => resource.key === item.resourceKey)?.label || item.resourceKey}</span>
                    <span className="text-[#9CA3AF]"> · </span>
                    <span>
                      Вид: {item.oldCanView ? 'да' : 'нет'} → {item.newCanView ? 'да' : 'нет'},
                      {' '}Упр: {item.oldCanManage ? 'да' : 'нет'} → {item.newCanManage ? 'да' : 'нет'}
                    </span>
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    {item.changedByName || 'Пользователь'} · {formatDate(item.changedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => router.refresh()}>
          Обновить данные
        </Button>
      </div>
    </div>
  )
}
