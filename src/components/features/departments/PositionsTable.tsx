'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { POSITION_LEVELS } from '@/lib/constants/departments'
import type { Position } from '@/lib/types/departments'
import { PositionDialog } from './PositionDialog'
import { DeletePositionDialog } from './DeletePositionDialog'

interface PositionsTableProps {
  positions: Position[]
  canManage: boolean
}

function getPositionLevelLabel(level: number) {
  return POSITION_LEVELS[level as keyof typeof POSITION_LEVELS] || `Уровень ${level}`
}

function truncateDescription(description: string | null) {
  if (!description) return '—'
  return description.length > 50 ? `${description.slice(0, 50)}…` : description
}

export function PositionsTable({ positions, canManage }: PositionsTableProps) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPosition, setEditingPosition] = useState<Position | null>(null)
  const [deletingPosition, setDeletingPosition] = useState<Position | null>(null)

  function openCreateDialog() {
    setEditingPosition(null)
    setDialogOpen(true)
  }

  function openEditDialog(position: Position) {
    setEditingPosition(position)
    setDialogOpen(true)
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open)
    if (!open) setEditingPosition(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-[#1B3A6B]" />
            <h2 className="text-lg font-semibold text-[#1B3A6B]">Должности</h2>
          </div>
          <p className="mt-1 text-sm text-[#6B7280]">
            Уровни ответственности и должности сотрудников.
          </p>
        </div>
        {canManage && (
          <Button type="button" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить должность
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
        <Table>
          <TableHeader className="bg-[#F8F9FA]">
            <TableRow className="border-[#E8ECF0] hover:bg-transparent">
              <TableHead className="text-[#6B7280]">Название</TableHead>
              <TableHead className="text-[#6B7280]">Уровень</TableHead>
              <TableHead className="text-[#6B7280]">Описание</TableHead>
              {canManage && <TableHead className="w-[120px] text-right text-[#6B7280]">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow className="border-[#E8ECF0]">
                <TableCell colSpan={canManage ? 4 : 3} className="h-28 text-center text-[#9CA3AF]">
                  Должности пока не созданы.
                </TableCell>
              </TableRow>
            ) : (
              positions.map((position) => (
                <TableRow key={position.id} className="border-[#E8ECF0] hover:bg-[#F8F9FA]">
                  <TableCell className="font-medium text-[#1B3A6B]">{position.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-[#1B3A6B]/10 text-[#1B3A6B]">
                      {getPositionLevelLabel(position.level)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md text-[#6B7280]" title={position.description || undefined}>
                    {truncateDescription(position.description)}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => openEditDialog(position)}
                          title={`Редактировать ${position.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Редактировать</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setDeletingPosition(position)}
                          className="text-[#DC2626] hover:bg-red-500/10 hover:text-[#DC2626]"
                          title={`Удалить ${position.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Удалить</span>
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <PositionDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        position={editingPosition || undefined}
        onSuccess={() => router.refresh()}
      />

      {deletingPosition && (
        <DeletePositionDialog
          open={true}
          onOpenChange={(open) => !open && setDeletingPosition(null)}
          position={deletingPosition}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  )
}
