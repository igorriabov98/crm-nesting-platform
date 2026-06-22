'use client'

import { useMemo } from 'react'
import { Briefcase, Building2, Network } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PositionsTable } from './PositionsTable'
import { DepartmentTree } from './DepartmentTree'
import { OrgChart } from './OrgChart'
import { buildDepartmentTree } from '@/lib/utils/org-tree'
import type { Department, Position } from '@/lib/types/departments'
import type { UserRole } from '@/lib/types'

interface DepartmentsPageProps {
  departments: Department[]
  positions: Position[]
  users: { id: string; full_name: string }[]
  factories: { id: string; name: string }[]
  currentUser: { id: string; role: UserRole }
  canManage: boolean
}

export function DepartmentsPage({
  departments,
  positions,
  users,
  factories,
  canManage,
}: DepartmentsPageProps) {
  const tree = useMemo(() => buildDepartmentTree(departments), [departments])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Отделы и структура</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Управление подразделениями, должностями и организационной структурой завода.
        </p>
      </div>

      <Tabs defaultValue="departments" className="space-y-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-[#F3F4F6] p-1 sm:w-fit">
          <TabsTrigger value="departments" className="px-4 py-2">
            <Building2 className="h-4 w-4" />
            Отделы
          </TabsTrigger>
          <TabsTrigger value="positions" className="px-4 py-2">
            <Briefcase className="h-4 w-4" />
            Должности
          </TabsTrigger>
          <TabsTrigger value="structure" className="px-4 py-2">
            <Network className="h-4 w-4" />
            Структура
          </TabsTrigger>
        </TabsList>

        <TabsContent value="departments">
          <DepartmentTree
            departments={departments}
            users={users}
            factories={factories}
            canManage={canManage}
          />
        </TabsContent>

        <TabsContent value="positions">
          <PositionsTable positions={positions} canManage={canManage} />
        </TabsContent>

        <TabsContent value="structure">
          <OrgChart tree={tree} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
