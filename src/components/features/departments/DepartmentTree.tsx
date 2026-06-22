'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Factory,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildDepartmentTree } from '@/lib/utils/org-tree'
import type { Department, DepartmentTreeNode } from '@/lib/types/departments'
import { DepartmentDialog } from './DepartmentDialog'
import { DeleteDepartmentDialog } from './DeleteDepartmentDialog'
import { DepartmentMembersPanel } from './DepartmentMembersPanel'

interface DepartmentTreeProps {
  departments: Department[]
  users: { id: string; full_name: string }[]
  factories: { id: string; name: string }[]
  canManage: boolean
}

type DepartmentDialogState = {
  open: boolean
  department?: Department
  parentId?: string
}

function flattenVisibleNodes(
  nodes: DepartmentTreeNode[],
  collapsedIds: Set<string>
): DepartmentTreeNode[] {
  const result: DepartmentTreeNode[] = []

  function visit(currentNodes: DepartmentTreeNode[]) {
    for (const node of currentNodes) {
      result.push(node)
      if (!collapsedIds.has(node.id)) visit(node.children)
    }
  }

  visit(nodes)
  return result
}

export function DepartmentTree({
  departments,
  users,
  factories,
  canManage,
}: DepartmentTreeProps) {
  const router = useRouter()
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const [membersOpenIds, setMembersOpenIds] = useState<Set<string>>(() => new Set())
  const [dialogState, setDialogState] = useState<DepartmentDialogState>({ open: false })
  const [departmentToDelete, setDepartmentToDelete] = useState<DepartmentTreeNode | null>(null)

  const tree = useMemo(() => buildDepartmentTree(departments), [departments])
  const visibleNodes = useMemo(
    () => flattenVisibleNodes(tree, collapsedIds),
    [tree, collapsedIds]
  )

  function toggleSetValue(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ) {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function closeDepartmentDialog() {
    setDialogState({ open: false })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#1B3A6B]">Дерево отделов</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Подразделения, руководители и сотрудники организации.
          </p>
        </div>
        {canManage && (
          <Button
            type="button"
            onClick={() => setDialogState({ open: true, parentId: undefined })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Создать отдел
          </Button>
        )}
      </div>

      {visibleNodes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-[#9CA3AF]" />
          <p className="mt-3 font-medium text-[#1B3A6B]">Отделы пока не созданы</p>
          <p className="mt-1 text-sm text-[#6B7280]">
            Организационное дерево появится после добавления первого отдела.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleNodes.map((node) => {
            const hasChildren = node.children.length > 0
            const isCollapsed = collapsedIds.has(node.id)
            const membersOpen = membersOpenIds.has(node.id)
            const membersCount = node.members_count ?? 0

            return (
              <div
                key={node.id}
                id={`department-${node.id}`}
                className={node.depth > 0 ? 'border-l-2 border-[#E5E7EB] pl-4' : undefined}
                style={{ marginLeft: `${node.depth * 24}px` }}
              >
                <div className="rounded-lg border border-[#E8ECF0] bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <button
                        type="button"
                        disabled={!hasChildren}
                        onClick={() => toggleSetValue(setCollapsedIds, node.id)}
                        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#F3F4F6] disabled:invisible"
                        aria-label={isCollapsed ? 'Развернуть подотделы' : 'Свернуть подотделы'}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF]">
                        <Building2 className="h-5 w-5 text-[#1B3A6B]" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-[#1B3A6B]">{node.name}</h3>
                          <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-xs text-[#1B3A6B]">
                            {membersCount} сотрудников
                          </span>
                          {node.factory && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#EFF6FF] px-2 py-0.5 text-xs text-[#1B3A6B]">
                              <Factory className="h-3 w-3" />
                              {node.factory.name}
                            </span>
                          )}
                        </div>

                        {node.description && (
                          <p className="mt-1 text-sm text-[#6B7280]">{node.description}</p>
                        )}

                        {node.head_user_id && node.head && (
                          <p className="mt-2 flex items-center gap-1.5 text-sm text-[#374151]">
                            <UserRound className="h-4 w-4 text-[#6B7280]" />
                            Начальник: <span className="font-medium">{node.head.full_name}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => toggleSetValue(setMembersOpenIds, node.id)}
                        >
                          <Users className="mr-1.5 h-4 w-4" />
                          Сотрудники
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDialogState({ open: true, parentId: node.id })}
                        >
                          <Plus className="mr-1.5 h-4 w-4" />
                          Подотдел
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setDialogState({ open: true, department: node })}
                          title={`Редактировать ${node.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Редактировать</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setDepartmentToDelete(node)}
                          className="text-[#DC2626] hover:bg-red-500/10 hover:text-[#DC2626]"
                          title={`Удалить ${node.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Удалить</span>
                        </Button>
                      </div>
                    )}
                  </div>

                  {membersOpen && (
                    <DepartmentMembersPanel departmentId={node.id} canManage={canManage} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <DepartmentDialog
        open={dialogState.open}
        onOpenChange={(open) => {
          if (!open) closeDepartmentDialog()
        }}
        department={dialogState.department}
        parentId={dialogState.parentId}
        departments={departments}
        users={users}
        factories={factories}
        onSuccess={() => router.refresh()}
      />

      {departmentToDelete && (
        <DeleteDepartmentDialog
          open={true}
          onOpenChange={(open) => !open && setDepartmentToDelete(null)}
          department={departmentToDelete}
          childCount={departmentToDelete.children.length}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  )
}
