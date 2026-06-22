'use client'

import { useState } from 'react'
import { Building2, Crown, GitBranch, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getDepartmentMembers } from '@/app/(protected)/admin/settings/departments/actions'
import type { DepartmentMember, DepartmentTreeNode } from '@/lib/types/departments'

interface OrgChartProps {
  tree: DepartmentTreeNode[]
}

type MemberLoadState = {
  data: DepartmentMember[] | null
  error: string | null
  loading: boolean
}

interface ChartNodeProps {
  node: DepartmentTreeNode
  selectedId: string | null
  onSelect: (node: DepartmentTreeNode) => void
}

function ChartNode({ node, selectedId, onSelect }: ChartNodeProps) {
  return (
    <div className="flex flex-col items-stretch md:items-center">
      <button
        type="button"
        onClick={() => onSelect(node)}
        aria-pressed={selectedId === node.id}
        className={cn(
          'w-full min-w-0 rounded-xl border-2 bg-white p-3 text-left shadow transition-colors md:w-[220px]',
          selectedId === node.id
            ? 'border-[#1B3A6B] ring-2 ring-[#1B3A6B]/10'
            : 'border-[#1B3A6B]/20 hover:border-[#1B3A6B]/50'
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF]">
            <Building2 className="h-4 w-4 text-[#1B3A6B]" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-[#1B3A6B]">{node.name}</span>
            <span className="mt-1 block text-sm text-[#6B7280]">
              {node.head?.full_name ? `Начальник: ${node.head.full_name}` : 'Начальник не назначен'}
            </span>
          </span>
        </div>
        <span className="mt-3 flex items-center gap-1.5 text-xs text-[#6B7280]">
          <Users className="h-3.5 w-3.5" />
          {node.members_count ?? 0} сотрудников
        </span>
      </button>

      {node.children.length > 0 && (
        <div className="ml-5 mt-3 space-y-3 border-l-2 border-[#1B3A6B]/20 pl-4 md:relative md:ml-0 md:mt-5 md:flex md:flex-row md:items-start md:gap-6 md:space-y-0 md:border-l-0 md:border-t-2 md:px-6 md:pt-5">
          {node.children.map((child) => (
            <div
              key={child.id}
              className="md:relative md:before:absolute md:before:-top-5 md:before:left-1/2 md:before:h-5 md:before:border-l-2 md:before:border-[#1B3A6B]/20"
            >
              <ChartNode node={child} selectedId={selectedId} onSelect={onSelect} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OrgChart({ tree }: OrgChartProps) {
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentTreeNode | null>(null)
  const [memberStates, setMemberStates] = useState<Record<string, MemberLoadState>>({})

  async function selectDepartment(node: DepartmentTreeNode, force = false) {
    setSelectedDepartment(node)

    const currentState = memberStates[node.id]
    if (!force && (currentState?.loading || currentState?.data)) return

    setMemberStates((current) => ({
      ...current,
      [node.id]: { data: current[node.id]?.data || null, error: null, loading: true },
    }))

    const result = await getDepartmentMembers(node.id)

    setMemberStates((current) => ({
      ...current,
      [node.id]: {
        data: result.data,
        error: result.error,
        loading: false,
      },
    }))
  }

  if (tree.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white p-12 text-center">
        <GitBranch className="mx-auto h-11 w-11 text-[#9CA3AF]" />
        <p className="mt-3 font-medium text-[#1B3A6B]">Оргструктура пока пуста</p>
        <p className="mt-1 text-sm text-[#6B7280]">Добавьте первый отдел во вкладке «Отделы».</p>
      </div>
    )
  }

  const selectedState = selectedDepartment ? memberStates[selectedDepartment.id] : undefined

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#E8ECF0] bg-[#F8F9FA] p-4">
        <div className="overflow-x-auto pb-2">
          <div className="grid gap-4 md:flex md:min-w-max md:items-start md:justify-center md:gap-10">
            {tree.map((node) => (
              <ChartNode
                key={node.id}
                node={node}
                selectedId={selectedDepartment?.id || null}
                onSelect={(department) => void selectDepartment(department)}
              />
            ))}
          </div>
        </div>
      </div>

      {selectedDepartment && (
        <section className="rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-[#1B3A6B]">Сотрудники: {selectedDepartment.name}</h2>
              <p className="mt-0.5 text-sm text-[#6B7280]">Состав выбранного отдела.</p>
            </div>
            <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-xs text-[#1B3A6B]">
              {selectedDepartment.members_count ?? 0} сотрудников
            </span>
          </div>

          {selectedState?.loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-[#6B7280]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка сотрудников...
            </div>
          ) : selectedState?.error ? (
            <div className="mt-4 rounded-lg bg-red-500/10 p-4 text-sm text-[#DC2626]">
              <p>{selectedState.error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void selectDepartment(selectedDepartment, true)}
              >
                Повторить
              </Button>
            </div>
          ) : selectedState?.data?.length ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {selectedState.data.map((member) => (
                <div key={member.id} className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                  <div className="flex items-center gap-2">
                    {member.is_department_head && <Crown className="h-4 w-4 shrink-0 text-amber-500" />}
                    <span className="font-medium text-[#1B3A6B]">{member.user?.full_name || 'Пользователь'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#6B7280]">
                    <span className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[#1B3A6B]">
                      {member.position?.name || 'Без должности'}
                    </span>
                    {member.reports_to?.full_name && (
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="h-3.5 w-3.5" />
                        {member.reports_to.full_name}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-[#F8F9FA] px-3 py-5 text-center text-sm text-[#6B7280]">
              В отделе пока нет сотрудников.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
