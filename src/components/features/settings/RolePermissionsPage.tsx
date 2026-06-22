"use client"

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Search, ShieldCheck, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import {
  getAccessPreviewForUser,
  saveDepartmentAccessPermissions,
  type DepartmentAccessPermissionInput,
  type DepartmentAccessSubjectScope,
  type RolePermissionsPageData,
  type UserAccessPreview,
} from '@/lib/actions/role-permissions'
import type { ResourceKey } from '@/lib/permissions/resources'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

function permissionKey(departmentId: string, subjectScope: DepartmentAccessSubjectScope, resourceKey: ResourceKey) {
  return `${departmentId}:${subjectScope}:${resourceKey}`
}

function subjectLabel(subjectScope: DepartmentAccessSubjectScope) {
  return subjectScope === 'head' ? 'Начальник отдела' : 'Подчинённые отдела'
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

function buildState(permissions: DepartmentAccessPermissionInput[]) {
  return Object.fromEntries(
    permissions.map((permission) => [permissionKey(permission.departmentId, permission.subjectScope, permission.resourceKey), {
      canView: permission.canView || permission.canManage,
      canManage: permission.canManage,
    }])
  ) as Record<string, { canView: boolean; canManage: boolean }>
}

export function RolePermissionsPage({ data }: RolePermissionsPageProps) {
  const router = useRouter()
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(data.departments[0]?.id || '')
  const [selectedPreviewUserId, setSelectedPreviewUserId] = useState(data.previewUsers[0]?.id || '')
  const [permissions, setPermissions] = useState(() => buildState(data.permissions))
  const [preview, setPreview] = useState<UserAccessPreview | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)

  const selectedDepartment = data.departments.find((department) => department.id === selectedDepartmentId) || data.departments[0] || null

  const groupedResources = useMemo(() => {
    const groups = new Map<string, typeof data.resources>()
    for (const resource of data.resources) {
      groups.set(resource.group, [...(groups.get(resource.group) || []), resource])
    }
    return Array.from(groups.entries())
  }, [data.resources])

  const groupedPreview = useMemo(() => {
    const groups = new Map<string, NonNullable<UserAccessPreview['permissions']>>()
    for (const permission of preview?.permissions || []) {
      groups.set(permission.group, [...(groups.get(permission.group) || []), permission])
    }
    return Array.from(groups.entries())
  }, [preview])

  function updatePermission(
    departmentId: string,
    subjectScope: DepartmentAccessSubjectScope,
    resourceKey: ResourceKey,
    field: 'view' | 'manage',
    checked: boolean,
  ) {
    setPermissions((current) => {
      const key = permissionKey(departmentId, subjectScope, resourceKey)
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
      const payload: DepartmentAccessPermissionInput[] = data.departments.flatMap((department) =>
        (['head', 'member'] as const).flatMap((subjectScope) =>
          data.resources.map((resource) => {
            const state = permissions[permissionKey(department.id, subjectScope, resource.key)] || { canView: false, canManage: false }
            return {
              departmentId: department.id,
              subjectScope,
              resourceKey: resource.key,
              canView: state.canView || state.canManage,
              canManage: state.canManage,
            }
          })
        )
      )

      const result = await saveDepartmentAccessPermissions(payload)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить права доступа')
      toast.success('Права доступа сохранены')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSaving(false)
    }
  }

  async function onLoadPreview() {
    if (!selectedPreviewUserId) return
    setIsPreviewLoading(true)
    try {
      const result = await getAccessPreviewForUser(selectedPreviewUserId)
      if (!result.data) throw new Error(result.error || 'Не удалось проверить доступ пользователя')
      setPreview(result.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsPreviewLoading(false)
    }
  }

  function renderMatrix(subjectScope: DepartmentAccessSubjectScope) {
    if (!selectedDepartment) return null

    return (
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-[#1B3A6B]">{subjectLabel(subjectScope)}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-30 min-w-[280px] bg-white">Раздел</TableHead>
                <TableHead className="w-[120px] text-center">Вид</TableHead>
                <TableHead className="w-[120px] text-center">Упр</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedResources.map(([group, resources]) => (
                <Fragment key={`${subjectScope}-${group}`}>
                  <TableRow className="bg-[#F8F9FA] hover:bg-[#F8F9FA]">
                    <TableCell colSpan={3} className="sticky left-0 z-20 bg-[#F8F9FA] font-semibold text-[#1B3A6B]">
                      {group}
                    </TableCell>
                  </TableRow>
                  {resources.map((resource) => {
                    const state = permissions[permissionKey(selectedDepartment.id, subjectScope, resource.key)] || {
                      canView: false,
                      canManage: false,
                    }
                    return (
                      <TableRow key={`${subjectScope}-${resource.key}`}>
                        <TableCell className="sticky left-0 z-20 bg-white">
                          <div className="space-y-1">
                            <span className="font-medium text-[#374151]">{resource.label}</span>
                            {resource.description && (
                              <p className="max-w-[360px] text-xs font-normal text-[#6B7280]">
                                {resource.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            size="sm"
                            checked={state.canView}
                            onCheckedChange={(checked) =>
                              updatePermission(selectedDepartment.id, subjectScope, resource.key, 'view', checked === true)
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            size="sm"
                            checked={state.canManage}
                            onCheckedChange={(checked) =>
                              updatePermission(selectedDepartment.id, subjectScope, resource.key, 'manage', checked === true)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
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
              <h1 className="text-2xl font-bold text-[#1B3A6B]">Управление доступом</h1>
              <p className="mt-1 text-sm text-[#6B7280]">
                Доступ настраивается по отделу и статусу в отделе: отдельно начальник отдела и подчинённые.
                Должность «Администратор CRM» всегда даёт полный доступ.
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
          <CardTitle className="text-lg text-[#1B3A6B]">Администратор CRM</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3 text-sm text-[#374151]">
            Эта должность имеет полный доступ ко всем разделам и не управляется переключателями матрицы.
          </div>
          {data.adminUsers.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Пользователи с должностью «Администратор CRM» не найдены.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.adminUsers.map((user) => (
                <Badge key={user.id} variant="outline" className="gap-1">
                  <UserCog className="h-3.5 w-3.5" />
                  {user.fullName || user.email}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-[#1B3A6B]">Матрица отделов</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.departments.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Нет отделов для настройки доступа.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:max-w-sm">
                <label className="text-sm font-medium text-[#374151]">Отдел</label>
                <Select value={selectedDepartmentId} onValueChange={(value) => setSelectedDepartmentId(value || '')}>
                  <SelectTrigger className="w-full bg-white border-[#E8ECF0] text-[#1B3A6B]">
                    <SelectValue>
                      {selectedDepartment?.name || 'Выберите отдел'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                    {data.departments.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}{!department.isActive ? ' · неактивен' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {renderMatrix('head')}
                {renderMatrix('member')}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-[#1B3A6B]">Проверка доступа пользователя</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <label className="text-sm font-medium text-[#374151]">Пользователь</label>
              <Select value={selectedPreviewUserId} onValueChange={(value) => setSelectedPreviewUserId(value || '')}>
                <SelectTrigger className="w-full bg-white border-[#E8ECF0] text-[#1B3A6B]">
                  <SelectValue>
                    {data.previewUsers.find((user) => user.id === selectedPreviewUserId)?.fullName
                      || data.previewUsers.find((user) => user.id === selectedPreviewUserId)?.email
                      || 'Выберите пользователя'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                  {data.previewUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.fullName || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <LoadingButton onClick={onLoadPreview} loading={isPreviewLoading} disabled={!selectedPreviewUserId}>
              <Search className="mr-2 h-4 w-4" />
              Проверить
            </LoadingButton>
          </div>

          {preview && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3 text-sm text-[#374151]">
                <div className="font-semibold text-[#1B3A6B]">{preview.fullName || preview.email}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={preview.isActive ? 'outline' : 'destructive'}>
                    {preview.isActive ? 'Активен' : 'Заблокирован'}
                  </Badge>
                  {preview.isAdminPosition && <Badge>Администратор CRM</Badge>}
                  {preview.usedLegacyFallback && <Badge variant="outline">Legacy fallback</Badge>}
                </div>
                <div className="mt-3 space-y-1 text-xs text-[#6B7280]">
                  {preview.memberships.length === 0 ? (
                    <div>Нет назначений в отделах.</div>
                  ) : (
                    preview.memberships.map((membership, index) => (
                      <div key={`${membership.departmentId}-${membership.positionId || index}`}>
                        {membership.departmentName || 'Отдел'} · {membership.positionName || 'Без должности'} · {membership.isDepartmentHead ? 'начальник' : 'подчинённый'}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Раздел</TableHead>
                      <TableHead className="text-center">Вид</TableHead>
                      <TableHead className="text-center">Упр</TableHead>
                      <TableHead>Источник</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedPreview.map(([group, permissions]) => (
                      <Fragment key={`preview-${group}`}>
                        <TableRow className="bg-[#F8F9FA] hover:bg-[#F8F9FA]">
                          <TableCell colSpan={4} className="font-semibold text-[#1B3A6B]">{group}</TableCell>
                        </TableRow>
                        {permissions.map((permission) => (
                          <TableRow key={`preview-${permission.resourceKey}`}>
                            <TableCell className="font-medium text-[#374151]">{permission.label}</TableCell>
                            <TableCell className="text-center">{permission.canView ? 'да' : 'нет'}</TableCell>
                            <TableCell className="text-center">{permission.canManage ? 'да' : 'нет'}</TableCell>
                            <TableCell className="text-xs text-[#6B7280]">
                              {permission.sources.length > 0 ? permission.sources.join(', ') : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
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
                    <span className="font-medium">{item.departmentName || item.departmentId}</span>
                    <span className="text-[#9CA3AF]"> · </span>
                    <span>{subjectLabel(item.subjectScope)}</span>
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
