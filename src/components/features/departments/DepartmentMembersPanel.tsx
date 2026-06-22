'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, GitBranch, Pencil, Plus, RefreshCw, Trash2, UserRound, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  getActiveUsers,
  getDepartmentMembers,
  getPositions,
  removeMember,
} from '@/app/(protected)/admin/settings/departments/actions'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { DepartmentMember, Position } from '@/lib/types/departments'
import { AddMemberDialog } from './AddMemberDialog'
import { EditMemberDialog } from './EditMemberDialog'

interface DepartmentMembersPanelProps {
  departmentId: string
  canManage: boolean
}

type UserOption = { id: string; full_name: string }

export function DepartmentMembersPanel({
  departmentId,
  canManage,
}: DepartmentMembersPanelProps) {
  const router = useRouter()
  const [members, setMembers] = useState<DepartmentMember[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<DepartmentMember | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<DepartmentMember | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    const [membersResult, positionsResult, usersResult] = await Promise.all([
      getDepartmentMembers(departmentId),
      getPositions(),
      getActiveUsers(),
    ])

    const errors = [membersResult.error, positionsResult.error, usersResult.error].filter(
      (message): message is string => Boolean(message)
    )

    if (errors.length > 0 || !membersResult.data || !positionsResult.data || !usersResult.data) {
      setError(errors.join('; ') || 'Не удалось загрузить сотрудников отдела')
      setIsLoading(false)
      return
    }

    setMembers(membersResult.data)
    setPositions(positionsResult.data)
    setUsers(usersResult.data)
    setIsLoading(false)
  }, [departmentId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function handleMutationSuccess() {
    await loadData()
    router.refresh()
  }

  async function handleRemoveMember() {
    if (!memberToRemove) return

    setIsRemoving(true)
    setRemoveError(null)

    try {
      const result = await removeMember(memberToRemove.id)
      if (!result.success) {
        throw new Error(result.error || 'Не удалось убрать сотрудника из отдела')
      }

      toast.success('Сотрудник убран из отдела')
      setMemberToRemove(null)
      await handleMutationSuccess()
    } catch (removeMemberError: unknown) {
      setRemoveError(
        removeMemberError instanceof Error
          ? removeMemberError.message
          : 'Не удалось убрать сотрудника из отдела'
      )
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="mt-4 border-t border-[#E8ECF0] pt-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[#1B3A6B]" />
          <h4 className="font-medium text-[#1B3A6B]">Сотрудники отдела</h4>
        </div>
        {canManage && !isLoading && !error && (
          <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Добавить сотрудника
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg bg-[#F8F9FA] p-4 text-sm text-[#6B7280]">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Загрузка сотрудников...
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 p-3 text-sm text-[#DC2626]">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void loadData()}>
            Повторить
          </Button>
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-lg bg-[#F8F9FA] p-5 text-center text-sm text-[#6B7280]">
          В этом отделе пока нет сотрудников.
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white">
                  <UserRound className="h-4 w-4 text-[#1B3A6B]" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[#1B3A6B]">
                      {member.user?.full_name || 'Пользователь'}
                    </span>
                    {member.is_department_head && (
                      <Crown className="h-4 w-4 text-amber-500" aria-label="Начальник отдела" />
                    )}
                    <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-xs text-[#1B3A6B]">
                      {member.position?.name || 'Без должности'}
                    </span>
                  </div>
                  {member.reports_to && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-[#6B7280]">
                      <GitBranch className="h-3.5 w-3.5" />
                      Руководитель: {member.reports_to.full_name}
                    </p>
                  )}
                </div>
              </div>

              {canManage && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setEditingMember(member)}
                    title="Редактировать назначение"
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Редактировать назначение</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => {
                      setRemoveError(null)
                      setMemberToRemove(member)
                    }}
                    className="text-[#DC2626] hover:bg-red-500/10 hover:text-[#DC2626]"
                    title="Убрать из отдела"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Убрать из отдела</span>
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        departmentId={departmentId}
        existingMemberIds={members.map((member) => member.user_id)}
        departmentMembers={members}
        users={users}
        positions={positions}
        onSuccess={() => void handleMutationSuccess()}
      />

      {editingMember && (
        <EditMemberDialog
          open={true}
          onOpenChange={(open) => !open && setEditingMember(null)}
          member={editingMember}
          departmentMembers={members}
          positions={positions}
          onSuccess={() => void handleMutationSuccess()}
        />
      )}

      {memberToRemove && (
        <AlertDialog
          open={true}
          onOpenChange={(open) => {
            if (!open && !isRemoving) setMemberToRemove(null)
          }}
        >
          <AlertDialogContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
            <AlertDialogHeader>
              <AlertDialogTitle>Убрать сотрудника из отдела?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#6B7280]">
                Назначение сотрудника{' '}
                <strong className="text-[#1B3A6B]">
                  {memberToRemove.user?.full_name || 'Пользователь'}
                </strong>{' '}
                в этом отделе будет удалено.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {removeError && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-[#DC2626]">{removeError}</div>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRemoving}>Отмена</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                variant="destructive"
                disabled={isRemoving}
                onClick={handleRemoveMember}
              >
                {isRemoving ? 'Удаление...' : 'Убрать из отдела'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
