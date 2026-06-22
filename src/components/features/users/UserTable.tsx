'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Plus, MoreHorizontal, Pencil, KeyRound, Ban, Trash2, CheckCircle2, Crown } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { ROLES } from '@/lib/constants/roles'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CurrentUser, FactorySummary, UserDepartmentMembershipSummary } from '@/lib/types'
import { UserEditDialog } from './UserEditDialog'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { DeleteUserDialog } from './DeleteUserDialog'
import { updateUser } from '@/app/(protected)/admin/users/actions'
import { toast } from 'sonner'

interface UserTableProps {
  users: CurrentUser[]
  factories: FactorySummary[]
  currentUser: { id: string }
}

const userStatusFilterLabels: Record<string, string> = {
  all: 'Любой статус',
  active: 'Активен',
  banned: 'Заблокирован',
}

function getUserRoleLabel(user: CurrentUser) {
  if (user.role === 'production_manager') {
    return user.factory?.name
      ? `Начальник производства ${user.factory.name}`
      : 'Начальник производства: завод не выбран'
  }

  return ROLES[user.role]?.label || user.role
}

function getPrimaryPosition(user: CurrentUser) {
  return (user.department_memberships || []).reduce<UserDepartmentMembershipSummary['position']>(
    (primary, membership) => {
      if (!membership.position) return primary
      if (!primary || membership.position.level > primary.level) return membership.position
      return primary
    },
    null
  )
}

export function UserTable({ users, factories, currentUser }: UserTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Стэйты диалогов
  const [editUser, setEditUser] = useState<CurrentUser | null>(null)
  const [resetUser, setResetUser] = useState<CurrentUser | null>(null)
  const [deleteUserObj, setDeleteUserObj] = useState<CurrentUser | null>(null)

  // Фильтрация
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesRole = roleFilter === 'all' || u.role === roleFilter
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && u.is_active) ||
      (statusFilter === 'banned' && !u.is_active)

    return matchesSearch && matchesRole && matchesStatus
  })

  // Блокировка/Разблокировка
  const toggleBanStatus = async (user: CurrentUser) => {
    if (user.id === currentUser.id) {
      toast.error('Невозможно заблокировать свой собственный аккаунт')
      return
    }

    try {
      const res = await updateUser(user.id, { is_active: !user.is_active })
      if (!res.success) throw new Error(res.error || 'Не удалось изменить статус пользователя')
      toast.success(user.is_active ? 'Пользователь заблокирован' : 'Пользователь разблокирован')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось изменить статус пользователя')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <Input
            placeholder="Поиск по имени или email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:max-w-xs bg-white border-[#E8ECF0] text-[#1B3A6B] placeholder:text-[#9CA3AF]"
          />
          <Select value={roleFilter} onValueChange={(val) => setRoleFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[180px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{roleFilter === 'all' ? 'Все роли' : ROLES[roleFilter as keyof typeof ROLES]?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Все роли</SelectItem>
              {Object.entries(ROLES).map(([key, def]) => (
                <SelectItem key={key} value={key}>{def.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val || 'all')}>
            <SelectTrigger className="w-full sm:w-[180px] bg-white border-[#E8ECF0] text-[#1B3A6B]">
              <SelectValue>{userStatusFilterLabels[statusFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
              <SelectItem value="all">Любой статус</SelectItem>
              <SelectItem value="active">Активен</SelectItem>
              <SelectItem value="banned">Заблокирован</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Link href={ROUTES.ADMIN_USERS_NEW}>
          <Button className="bg-[#1B3A6B] hover:bg-[#152D54] text-white w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Новый пользователь
          </Button>
        </Link>
      </div>

      <div className="rounded-md border border-[#E8ECF0] bg-white overflow-hidden">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow className="border-[#E8ECF0] hover:bg-transparent">
              <TableHead className="text-[#6B7280]">Имя и Email</TableHead>
              <TableHead className="text-[#6B7280]">Роль</TableHead>
              <TableHead className="text-[#6B7280]">Отдел</TableHead>
              <TableHead className="text-[#6B7280]">Должность</TableHead>
              <TableHead className="text-[#6B7280]">Статус</TableHead>
              <TableHead className="text-[#6B7280]">Регистрация</TableHead>
              <TableHead className="text-[#6B7280]">Завод</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow className="border-[#E8ECF0]">
                <TableCell colSpan={8} className="h-24 text-center text-[#9CA3AF]">
                  Пользователи не найдены.
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((u) => {
                const roleDef = ROLES[u.role]
                const roleLabel = getUserRoleLabel(u)
                const isMe = u.id === currentUser.id
                const memberships = u.department_memberships || []
                const departmentMemberships = memberships.filter((membership) => membership.department)
                const primaryPosition = getPrimaryPosition(u)
                
                return (
                  <TableRow key={u.id} className="border-[#E8ECF0] hover:bg-[#F8F9FA]">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-[#1B3A6B]">
                          {u.full_name} {isMe && <span className="text-blue-500 ml-1 text-xs">(Вы)</span>}
                        </span>
                        <span className="text-sm text-[#6B7280]">{u.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="secondary" 
                        className={`bg-[#F8F9FA] border-none ${roleDef.color}`}
                      >
                        {roleLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] text-sm text-[#374151]">
                      {departmentMemberships.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                          {departmentMemberships.map((membership, index) => (
                            <Fragment key={membership.department?.id || index}>
                              {index > 0 && <span className="text-[#9CA3AF]">,</span>}
                              <span className="inline-flex items-center gap-1">
                                {membership.is_department_head && (
                                  <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Начальник отдела" />
                                )}
                                {membership.department?.name}
                              </span>
                            </Fragment>
                          ))}
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-[#374151]">
                      {primaryPosition?.name || '—'}
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge variant="outline" className="text-[#16A34A] border-emerald-400/20 bg-emerald-400/10">Активен</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[#DC2626] border-red-400/20 bg-red-400/10">Заблокирован</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-[#6B7280]">
                      {format(new Date(u.created_at), 'dd.MM.yyyy', { locale: ru })}
                    </TableCell>
                    <TableCell className="text-[#6B7280]">
                      {u.role === 'production_manager' ? u.factory?.name || 'Завод не выбран' : '—'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:text-[#1B3A6B] hover:bg-[#F8F9FA] focus:outline-none">
                          <span className="sr-only">Действия</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[#F8F9FA] border-[#E8ECF0] text-[#374151]">
                          <DropdownMenuLabel>Действия</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-[#E8ECF0]" />
                          <DropdownMenuItem onClick={() => setEditUser(u)} className="hover:bg-[#E8ECF0] focus:bg-[#E8ECF0] cursor-pointer">
                            <Pencil className="mr-2 h-4 w-4" />
                            Редактировать
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setResetUser(u)} className="hover:bg-[#E8ECF0] focus:bg-[#E8ECF0] cursor-pointer">
                            <KeyRound className="mr-2 h-4 w-4" />
                            Сбросить пароль
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-[#E8ECF0]" />
                          <DropdownMenuItem 
                            onClick={() => toggleBanStatus(u)} 
                            disabled={isMe}
                            className={`cursor-pointer focus:bg-[#E8ECF0] ${u.is_active ? 'text-orange-400 focus:text-orange-400' : 'text-[#16A34A] focus:text-[#16A34A]'}`}
                          >
                            {u.is_active ? (
                              <><Ban className="mr-2 h-4 w-4" /> Заблокировать</>
                            ) : (
                              <><CheckCircle2 className="mr-2 h-4 w-4" /> Разблокировать</>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => setDeleteUserObj(u)}
                            disabled={isMe}
                            className="text-[#DC2626] focus:text-[#DC2626] focus:bg-red-50 cursor-pointer"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Диалоги (Рендерятся только когда активны) */}
      {editUser && (
        <UserEditDialog 
          user={editUser}
          factories={factories}
          isOpen={!!editUser}
          onClose={() => setEditUser(null)}
          isMe={editUser.id === currentUser.id}
        />
      )}
      
      {resetUser && (
        <ResetPasswordDialog 
          user={resetUser}
          isOpen={!!resetUser}
          onClose={() => setResetUser(null)}
        />
      )}

      {deleteUserObj && (
        <DeleteUserDialog 
          user={deleteUserObj}
          isOpen={!!deleteUserObj}
          onClose={() => setDeleteUserObj(null)}
        />
      )}
    </div>
  )
}
