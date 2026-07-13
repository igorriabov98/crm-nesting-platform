"use client"

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Building2,
  Check,
  Clock3,
  Eye,
  History,
  Layers3,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  saveDepartmentAccessPermissions,
  type DepartmentAccessPermissionInput,
  type DepartmentAccessSubjectScope,
  type RolePermissionsPageData,
} from '@/lib/actions/role-permissions'
import { startUserImpersonation } from '@/lib/actions/impersonation'
import type { ResourceKey } from '@/lib/permissions/resources'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

type PermissionState = {
  canView: boolean
  canManage: boolean
}

type PermissionStateMap = Record<string, PermissionState>
type PermissionField = 'view' | 'manage'
type Resource = RolePermissionsPageData['resources'][number]

const SUBJECT_SCOPES = ['head', 'member'] as const satisfies readonly DepartmentAccessSubjectScope[]
const EMPTY_PERMISSION: PermissionState = { canView: false, canManage: false }

function permissionKey(departmentId: string, subjectScope: DepartmentAccessSubjectScope, resourceKey: ResourceKey) {
  return `${departmentId}:${subjectScope}:${resourceKey}`
}

function subjectLabel(subjectScope: DepartmentAccessSubjectScope) {
  return subjectScope === 'head' ? 'Начальник отдела' : 'Сотрудники отдела'
}

function subjectShortLabel(subjectScope: DepartmentAccessSubjectScope) {
  return subjectScope === 'head' ? 'Начальник' : 'Сотрудники'
}

function operationLabel(field: PermissionField) {
  return field === 'view' ? 'просмотр' : 'управление'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
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
  ) as PermissionStateMap
}

function getState(
  permissions: PermissionStateMap,
  departmentId: string,
  subjectScope: DepartmentAccessSubjectScope,
  resourceKey: ResourceKey,
) {
  return permissions[permissionKey(departmentId, subjectScope, resourceKey)] || EMPTY_PERMISSION
}

function PermissionSwitch({
  resource,
  scope,
  field,
  checked,
  disabled,
  onCheckedChange,
}: {
  resource: Resource
  scope: DepartmentAccessSubjectScope
  field: PermissionField
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="inline-flex min-h-11 min-w-11 items-center justify-center">
      <Switch
        size="default"
        className="cursor-pointer after:-inset-3"
        checked={checked}
        disabled={disabled}
        aria-label={`${resource.label}: ${subjectLabel(scope)}, ${operationLabel(field)}`}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: typeof Users
  label: string
  value: string | number
  detail: string
  tone?: 'default' | 'success'
}) {
  return (
    <Card className="gap-2 py-3 shadow-none">
      <CardContent className="flex items-start justify-between gap-3 px-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          tone === 'success' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
        )}>
          <Icon className="size-4.5" />
        </div>
      </CardContent>
    </Card>
  )
}

export function RolePermissionsPage({ data }: RolePermissionsPageProps) {
  const router = useRouter()
  const initialPermissions = useMemo(() => buildState(data.permissions), [data.permissions])
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(data.departments[0]?.id || '')
  const [selectedPreviewUserId, setSelectedPreviewUserId] = useState(data.previewUsers[0]?.id || '')
  const [permissions, setPermissions] = useState(() => buildState(data.permissions))
  const [isSaving, setIsSaving] = useState(false)
  const [isStartingUserSession, setIsStartingUserSession] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState('all')
  const [showAllAudit, setShowAllAudit] = useState(false)

  const selectedDepartment = data.departments.find((department) => department.id === selectedDepartmentId)
    || data.departments[0]
    || null

  const groupedResources = useMemo(() => {
    const groups = new Map<string, Resource[]>()
    for (const resource of data.resources) {
      groups.set(resource.group, [...(groups.get(resource.group) || []), resource])
    }
    return Array.from(groups.entries())
  }, [data.resources])

  const filteredGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ru-RU')
    return groupedResources
      .filter(([group]) => activeGroup === 'all' || group === activeGroup)
      .map(([group, resources]) => [
        group,
        resources.filter((resource) => {
          if (!normalizedQuery) return true
          return `${resource.label} ${resource.description || ''} ${resource.key}`
            .toLocaleLowerCase('ru-RU')
            .includes(normalizedQuery)
        }),
      ] as const)
      .filter(([, resources]) => resources.length > 0)
  }, [activeGroup, groupedResources, searchQuery])

  const filteredResourceCount = useMemo(
    () => filteredGroups.reduce((total, [, resources]) => total + resources.length, 0),
    [filteredGroups],
  )

  const changeCount = useMemo(() => {
    let count = 0
    for (const department of data.departments) {
      for (const scope of SUBJECT_SCOPES) {
        for (const resource of data.resources) {
          const key = permissionKey(department.id, scope, resource.key)
          const before = initialPermissions[key] || EMPTY_PERMISSION
          const current = permissions[key] || EMPTY_PERMISSION
          if (before.canView !== current.canView || before.canManage !== current.canManage) count += 1
        }
      }
    }
    return count
  }, [data.departments, data.resources, initialPermissions, permissions])

  const selectedDepartmentStats = useMemo(() => {
    const stats = {
      head: { view: 0, manage: 0 },
      member: { view: 0, manage: 0 },
    }
    if (!selectedDepartment) return stats

    for (const scope of SUBJECT_SCOPES) {
      for (const resource of data.resources) {
        const state = getState(permissions, selectedDepartment.id, scope, resource.key)
        if (state.canView) stats[scope].view += 1
        if (state.canManage) stats[scope].manage += 1
      }
    }
    return stats
  }, [data.resources, permissions, selectedDepartment])

  const selectedPreviewUser = data.previewUsers.find((user) => user.id === selectedPreviewUserId) || null

  const visibleAudit = showAllAudit ? data.auditLog : data.auditLog.slice(0, 6)

  function updatePermission(
    departmentId: string,
    subjectScope: DepartmentAccessSubjectScope,
    resourceKey: ResourceKey,
    field: PermissionField,
    checked: boolean,
  ) {
    setPermissions((current) => {
      const key = permissionKey(departmentId, subjectScope, resourceKey)
      const previous = current[key] || EMPTY_PERMISSION
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

  function resetChanges() {
    setPermissions(initialPermissions)
    toast.info('Несохранённые изменения отменены')
  }

  async function onSave() {
    setIsSaving(true)
    try {
      const payload: DepartmentAccessPermissionInput[] = data.departments.flatMap((department) =>
        SUBJECT_SCOPES.flatMap((subjectScope) =>
          data.resources.map((resource) => {
            const state = getState(permissions, department.id, subjectScope, resource.key)
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

  async function onStartUserSession() {
    if (!selectedPreviewUserId) return
    setIsStartingUserSession(true)
    try {
      const result = await startUserImpersonation(selectedPreviewUserId)
      if (!result.success) {
        if (result.redirectTo) window.location.assign(result.redirectTo)
        throw new Error(result.error || 'Не удалось открыть CRM пользователя')
      }
      toast.success('Открываем CRM с правами выбранного пользователя')
      window.location.assign(result.redirectTo)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsStartingUserSession(false)
    }
  }

  function renderPermissionSwitch(resource: Resource, scope: DepartmentAccessSubjectScope, field: PermissionField) {
    if (!selectedDepartment) return null
    const state = getState(permissions, selectedDepartment.id, scope, resource.key)
    return (
      <PermissionSwitch
        resource={resource}
        scope={scope}
        field={field}
        checked={field === 'view' ? state.canView : state.canManage}
        disabled={isSaving}
        onCheckedChange={(checked) => updatePermission(selectedDepartment.id, scope, resource.key, field, checked)}
      />
    )
  }

  return (
    <div className={cn(
      'mx-auto w-full max-w-[1680px] space-y-4 md:pb-8',
      changeCount > 0 ? 'pb-24' : 'pb-8',
    )}>
      <section className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <ShieldCheck className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Управление доступом</h1>
                <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                  {data.resources.length} ресурс
                </Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Настройте, какие разделы видят руководители и сотрудники каждого отдела. Управление автоматически включает просмотр.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {changeCount > 0 && (
              <Badge className="h-8 bg-warning/10 px-3 text-warning hover:bg-warning/10">
                {changeCount} несохранённых изменений
              </Badge>
            )}
            <Button
              variant="outline"
              size="lg"
              aria-label="Обновить данные страницы"
              title="Обновить данные"
              onClick={() => router.refresh()}
            >
              <RefreshCw className="size-4" />
              <span className="hidden sm:inline">Обновить</span>
            </Button>
            {changeCount > 0 && (
              <Button variant="ghost" size="lg" onClick={resetChanges} disabled={isSaving}>
                <RotateCcw className="size-4" />
                Отменить
              </Button>
            )}
            <LoadingButton
              size="lg"
              onClick={onSave}
              loading={isSaving}
              loadingText="Сохраняем…"
              disabled={changeCount === 0}
            >
              <Save className="size-4" />
              Сохранить{changeCount > 0 ? ` · ${changeCount}` : ''}
            </LoadingButton>
          </div>
        </div>
      </section>

      <section aria-label="Сводка по отделу" className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(320px,1.35fr)_repeat(3,minmax(170px,0.65fr))]">
        <Card className="gap-3 py-3 shadow-none">
          <CardContent className="px-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Building2 className="size-4 text-primary" />
                Отдел
              </div>
              <Link
                href="/admin/settings/departments"
                className="rounded-md text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Структура отделов
              </Link>
            </div>
            {data.departments.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Нет отделов для настройки доступа.</p>
            ) : (
              <Select value={selectedDepartmentId} onValueChange={(value) => setSelectedDepartmentId(value || '')}>
                <SelectTrigger className="mt-3 h-11 w-full bg-background text-foreground">
                  <SelectValue>{selectedDepartment?.name || 'Выберите отдел'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {data.departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}{!department.isActive ? ' · неактивен' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        <MetricCard
          icon={UserCheck}
          label="Начальник отдела"
          value={selectedDepartmentStats.head.manage}
          detail={`${selectedDepartmentStats.head.view} доступно для просмотра`}
        />
        <MetricCard
          icon={Users}
          label="Сотрудники"
          value={selectedDepartmentStats.member.manage}
          detail={`${selectedDepartmentStats.member.view} доступно для просмотра`}
        />
        <MetricCard
          icon={UserCog}
          label="Администраторы CRM"
          value={data.adminUsers.length}
          detail="Всегда имеют полный доступ"
          tone="success"
        />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 gap-0 overflow-visible py-0 shadow-sm">
          <CardHeader className="gap-4 border-b px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Layers3 className="size-5 text-primary" />
                  Матрица модулей
                </CardTitle>
                <CardDescription className="mt-1">
                  Одна строка показывает права сразу для двух уровней выбранного отдела.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="size-3.5 text-primary" />
                  <strong className="font-medium text-foreground">Вид</strong> — открыть и читать
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <PencilLine className="size-3.5 text-primary" />
                  <strong className="font-medium text-foreground">Упр</strong> — изменять и запускать
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="relative max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Найти модуль или раздел…"
                  aria-label="Поиск по модулям доступа"
                  className="h-10 bg-background pl-9 pr-16 text-base sm:text-sm"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-muted-foreground">
                  {filteredResourceCount}/{data.resources.length}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Фильтр по разделам">
                <Button
                  type="button"
                  size="sm"
                  variant={activeGroup === 'all' ? 'default' : 'outline'}
                  aria-pressed={activeGroup === 'all'}
                  onClick={() => setActiveGroup('all')}
                >
                  Все
                </Button>
                {groupedResources.map(([group, resources]) => (
                  <Button
                    key={group}
                    type="button"
                    size="sm"
                    variant={activeGroup === group ? 'default' : 'outline'}
                    aria-pressed={activeGroup === group}
                    onClick={() => setActiveGroup(group)}
                  >
                    {group}
                    <span className={cn(
                      'rounded-full px-1.5 text-[10px] tabular-nums',
                      activeGroup === group ? 'bg-primary-foreground/15' : 'bg-muted text-muted-foreground',
                    )}>
                      {resources.length}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-0 py-0">
            {!selectedDepartment ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <Building2 className="size-9 text-muted-foreground/50" />
                <p className="mt-3 font-medium text-foreground">Сначала добавьте отдел</p>
                <p className="mt-1 text-sm text-muted-foreground">Матрица появится после создания организационной структуры.</p>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
                <Search className="size-9 text-muted-foreground/50" />
                <p className="mt-3 font-medium text-foreground">Ничего не найдено</p>
                <p className="mt-1 text-sm text-muted-foreground">Измените запрос или выберите другой раздел.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery('')
                    setActiveGroup('all')
                  }}
                >
                  Сбросить фильтры
                </Button>
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <Table className="min-w-[860px] table-fixed">
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_var(--border)]">
                      <TableRow className="hover:bg-transparent">
                        <TableHead rowSpan={2} className="w-[44%] min-w-[320px] bg-card px-4 align-bottom">
                          Модуль
                        </TableHead>
                        <TableHead colSpan={2} className="border-l bg-primary/[0.035] text-center text-primary">
                          <span className="inline-flex items-center gap-1.5"><UserCheck className="size-3.5" />Начальник</span>
                        </TableHead>
                        <TableHead colSpan={2} className="border-l bg-primary/[0.07] text-center text-primary">
                          <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />Сотрудники</span>
                        </TableHead>
                      </TableRow>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[14%] border-l bg-primary/[0.035] text-center text-xs">Вид</TableHead>
                        <TableHead className="w-[14%] bg-primary/[0.035] text-center text-xs">Упр</TableHead>
                        <TableHead className="w-[14%] border-l bg-primary/[0.07] text-center text-xs">Вид</TableHead>
                        <TableHead className="w-[14%] bg-primary/[0.07] text-center text-xs">Упр</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredGroups.map(([group, resources]) => (
                        <Fragment key={group}>
                          <TableRow className="border-y bg-muted/70 hover:bg-muted/70">
                            <TableCell colSpan={5} className="px-4 py-2">
                              <div className="flex items-center gap-2">
                                <Layers3 className="size-3.5 text-primary" />
                                <span className="font-semibold text-foreground">{group}</span>
                                <Badge variant="outline" className="h-5 bg-card text-[10px] text-muted-foreground">
                                  {resources.length}
                                </Badge>
                              </div>
                            </TableCell>
                          </TableRow>
                          {resources.map((resource) => (
                            <TableRow key={resource.key} className="group/permission-row">
                              <TableCell className="whitespace-normal px-4 py-2.5">
                                <div className="font-medium text-foreground">{resource.label}</div>
                                {resource.description && (
                                  <p className="mt-0.5 max-w-xl text-xs leading-5 text-muted-foreground">{resource.description}</p>
                                )}
                              </TableCell>
                              <TableCell className="border-l bg-primary/[0.018] p-0 text-center group-hover/permission-row:bg-primary/[0.04]">
                                {renderPermissionSwitch(resource, 'head', 'view')}
                              </TableCell>
                              <TableCell className="bg-primary/[0.018] p-0 text-center group-hover/permission-row:bg-primary/[0.04]">
                                {renderPermissionSwitch(resource, 'head', 'manage')}
                              </TableCell>
                              <TableCell className="border-l bg-primary/[0.045] p-0 text-center group-hover/permission-row:bg-primary/[0.075]">
                                {renderPermissionSwitch(resource, 'member', 'view')}
                              </TableCell>
                              <TableCell className="bg-primary/[0.045] p-0 text-center group-hover/permission-row:bg-primary/[0.075]">
                                {renderPermissionSwitch(resource, 'member', 'manage')}
                              </TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-5 p-3 md:hidden">
                  {filteredGroups.map(([group, resources]) => (
                    <section key={`mobile-${group}`} aria-labelledby={`group-${group}`} className="space-y-2.5">
                      <div className="flex items-center gap-2 px-1">
                        <Layers3 className="size-4 text-primary" />
                        <h2 id={`group-${group}`} className="font-semibold text-foreground">{group}</h2>
                        <Badge variant="outline" className="bg-card text-muted-foreground">{resources.length}</Badge>
                      </div>

                      {resources.map((resource) => (
                        <article key={`mobile-${resource.key}`} className="rounded-xl border bg-card p-3 shadow-xs">
                          <div className="font-medium text-foreground">{resource.label}</div>
                          {resource.description && (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{resource.description}</p>
                          )}
                          <div className="mt-3 overflow-hidden rounded-lg border">
                            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px] bg-muted/60 px-3 text-[11px] font-medium text-muted-foreground">
                              <span className="py-2">Уровень</span>
                              <span className="py-2 text-center">Вид</span>
                              <span className="py-2 text-center">Упр</span>
                            </div>
                            {SUBJECT_SCOPES.map((scope) => (
                              <div key={`${resource.key}-${scope}`} className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center border-t px-3">
                                <span className="text-sm font-medium text-foreground">{subjectShortLabel(scope)}</span>
                                <span className="flex justify-center">{renderPermissionSwitch(resource, scope, 'view')}</span>
                                <span className="flex justify-center">{renderPermissionSwitch(resource, scope, 'manage')}</span>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </section>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-4 xl:sticky xl:top-4" aria-label="Проверка и история доступа">
          <Card className="shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="size-4.5 text-primary" />
                Проверить доступ
              </CardTitle>
              <CardDescription>Открывает CRM так, как её видит выбранный сотрудник.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="access-preview-user">Пользователь</label>
                <Select value={selectedPreviewUserId} onValueChange={(value) => setSelectedPreviewUserId(value || '')}>
                  <SelectTrigger id="access-preview-user" className="h-10 w-full bg-background text-foreground">
                    <SelectValue>
                      {data.previewUsers.find((user) => user.id === selectedPreviewUserId)?.fullName
                        || data.previewUsers.find((user) => user.id === selectedPreviewUserId)?.email
                        || 'Выберите пользователя'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {data.previewUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.fullName || user.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <LoadingButton
                className="h-10 w-full"
                onClick={onStartUserSession}
                loading={isStartingUserSession}
                loadingText="Открываем CRM…"
                disabled={!selectedPreviewUserId}
              >
                <UserCheck className="size-4" />
                Проверить доступ
              </LoadingButton>

              {selectedPreviewUser && (
                <div className="space-y-3 rounded-xl border bg-muted/35 p-3">
                  <div>
                    <div className="truncate font-semibold text-foreground">
                      {selectedPreviewUser.fullName || selectedPreviewUser.email}
                    </div>
                    {selectedPreviewUser.fullName && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{selectedPreviewUser.email}</p>
                    )}
                  </div>
                  <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                    {selectedPreviewUser.departments.length > 0 && (
                      <p>Отделы: {selectedPreviewUser.departments.join(', ')}</p>
                    )}
                    {selectedPreviewUser.positions.length > 0 && (
                      <p>Должности: {selectedPreviewUser.positions.join(', ')}</p>
                    )}
                  </div>
                  <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
                    Откроется настоящая сессия сотрудника с его задачами и данными. Все действия будут записаны от его имени. Вернуться можно через тонкую панель сверху.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <History className="size-4.5 text-primary" />
                Последние изменения
              </CardTitle>
              <CardDescription>Кто, когда и какое право изменил.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.auditLog.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">История изменений пока пустая.</div>
              ) : (
                <div className="space-y-3">
                  {visibleAudit.map((item) => {
                    const resource = data.resources.find((candidate) => candidate.key === item.resourceKey)
                    const permissionGranted = (!item.oldCanView && item.newCanView) || (!item.oldCanManage && item.newCanManage)
                    return (
                      <article key={item.id} className="relative pl-5">
                        <span className={cn(
                          'absolute left-0 top-1.5 size-2.5 rounded-full ring-4 ring-card',
                          permissionGranted ? 'bg-success' : 'bg-warning',
                        )} />
                        <div className="text-sm font-medium leading-5 text-foreground">{resource?.label || item.resourceKey}</div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {item.departmentName || item.departmentId} · {subjectShortLabel(item.subjectScope)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            Вид: {item.oldCanView ? 'да' : 'нет'} → {item.newCanView ? 'да' : 'нет'}
                          </Badge>
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            Упр: {item.oldCanManage ? 'да' : 'нет'} → {item.newCanManage ? 'да' : 'нет'}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock3 className="size-3" />
                          {item.changedByName || 'Пользователь'} · {formatDate(item.changedAt)}
                        </div>
                      </article>
                    )
                  })}

                  {data.auditLog.length > 6 && (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAllAudit((current) => !current)}>
                      {showAllAudit ? 'Свернуть историю' : `Показать ещё ${data.auditLog.length - 6}`}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/15 bg-primary/[0.035] py-3 shadow-none">
            <CardContent className="px-3">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="size-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">Администратор CRM вне матрицы</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Эта должность всегда имеет полный доступ. Переключатели выше на неё не влияют.
                  </p>
                  {data.adminUsers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.adminUsers.map((user) => (
                        <Badge key={user.id} variant="outline" className="bg-card">
                          <UserCog />{user.fullName || user.email}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {changeCount > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between gap-3 rounded-2xl border bg-card/95 p-3 shadow-xl backdrop-blur md:hidden">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Есть изменения</div>
            <div className="truncate text-xs text-muted-foreground">Изменено прав: {changeCount}</div>
          </div>
          <LoadingButton onClick={onSave} loading={isSaving} loadingText="Сохраняем…">
            <Check className="size-4" />
            Сохранить
          </LoadingButton>
        </div>
      )}
    </div>
  )
}
