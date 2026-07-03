'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Info, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createKFactor, deleteKFactor, updateKFactor, type KFactorItem } from '@/lib/nesting/catalog-api'
import { RangeRuleDialog } from '@/components/features/nesting/catalog/RangeRuleDialog'
import {
  MATERIAL_OPTIONS,
  formatMm,
  getErrorMessage,
  useCatalogSearchUpdater,
} from '@/components/features/nesting/catalog/shared'

function KFactorActions({
  item,
  onEdit,
  onChanged,
}: {
  item: KFactorItem
  onEdit: () => void
  onChanged: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteKFactor(item.id)
      toast.success('K-фактор удалён')
      onChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Не удалось удалить K-фактор'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#F4F6F9] hover:text-[#1B3A6B] focus:outline-none">
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-white">
          <DropdownMenuLabel>Действия</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Редактировать
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <AlertDialogTrigger className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm text-red-600 hover:bg-red-50 focus:outline-none">
            <Trash2 className="h-4 w-4" />
            Удалить
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent className="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить K-фактор?</AlertDialogTitle>
          <AlertDialogDescription>
            Правило для {item.material}, {formatMm(item.thicknessMin)} - {formatMm(item.thicknessMax)}, будет удалено.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" disabled={deleting} onClick={handleDelete}>
            {deleting ? 'Удаление...' : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function KFactorsCatalogTab({
  items,
  material,
}: {
  items: KFactorItem[]
  material?: string
}) {
  const router = useRouter()
  const updateParams = useCatalogSearchUpdater()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<KFactorItem | undefined>()

  function refresh() {
    router.refresh()
  }

  function validateKFactor(value: number) {
    if (value < 0.1 || value > 0.9) {
      throw new Error('K-фактор должен быть от 0.1 до 0.9')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-[#1B3A6B]">K-факторы</h2>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </div>

      <div className="rounded-lg border border-[#E8ECF0] bg-white p-4">
        <Select value={material || 'all'} onValueChange={(value) => updateParams({ material: value })}>
          <SelectTrigger className="w-full bg-white sm:w-[220px]">
            <SelectValue>{material || 'Все материалы'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все материалы</SelectItem>
            {MATERIAL_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F8F9FA]">
                <TableHead>Материал</TableHead>
                <TableHead>Толщина от</TableHead>
                <TableHead>Толщина до</TableHead>
                <TableHead>K-фактор</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium text-[#1B3A6B]">{item.material}</TableCell>
                  <TableCell>{formatMm(item.thicknessMin)}</TableCell>
                  <TableCell>{formatMm(item.thicknessMax)}</TableCell>
                  <TableCell>{item.kFactor.toFixed(2)}</TableCell>
                  <TableCell>
                    <KFactorActions item={item} onEdit={() => setEditingItem(item)} onChanged={refresh} />
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-[#9CA3AF]">
                    K-факторы не найдены
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex gap-2 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Справочник используется при расчёте B-Rep развёрток. Стандартные значения: сталь 0.35-0.45, нержавейка 0.35-0.42, алюминий 0.33-0.38.
        </p>
      </div>

      <RangeRuleDialog<KFactorItem>
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={{ create: 'Добавить K-фактор', edit: 'Редактировать K-фактор' }}
        valueLabel="K-фактор"
        value={{ get: (item) => item.kFactor, field: 'kFactor', successCreate: 'K-фактор добавлен', successUpdate: 'K-фактор сохранён' }}
        validateValue={validateKFactor}
        create={(data) => createKFactor(data as { material: string; thicknessMin: number; thicknessMax: number; kFactor: number })}
        update={(id, data) => updateKFactor(id, data as { material: string; thicknessMin: number; thicknessMax: number; kFactor: number })}
        onSaved={refresh}
      />
      <RangeRuleDialog<KFactorItem>
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) setEditingItem(undefined)
        }}
        item={editingItem}
        title={{ create: 'Добавить K-фактор', edit: 'Редактировать K-фактор' }}
        valueLabel="K-фактор"
        value={{ get: (item) => item.kFactor, field: 'kFactor', successCreate: 'K-фактор добавлен', successUpdate: 'K-фактор сохранён' }}
        validateValue={validateKFactor}
        create={(data) => createKFactor(data as { material: string; thicknessMin: number; thicknessMax: number; kFactor: number })}
        update={(id, data) => updateKFactor(id, data as { material: string; thicknessMin: number; thicknessMax: number; kFactor: number })}
        onSaved={refresh}
      />
    </div>
  )
}
