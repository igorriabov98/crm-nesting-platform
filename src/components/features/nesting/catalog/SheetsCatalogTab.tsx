'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
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
import { deleteSheet, updateSheet, type SheetCatalogItem } from '@/lib/nesting/catalog-api'
import type { PaginatedResponse } from '@/lib/nesting/api'
import { InlineNumberEdit } from '@/components/features/nesting/catalog/InlineNumberEdit'
import { SheetDialog } from '@/components/features/nesting/catalog/SheetDialog'
import {
  MATERIAL_OPTIONS,
  formatMm,
  formatPrice,
  formatSize,
  getErrorMessage,
  useCatalogSearchUpdater,
} from '@/components/features/nesting/catalog/shared'

function SheetActions({
  sheet,
  onEdit,
  onChanged,
}: {
  sheet: SheetCatalogItem
  onEdit: () => void
  onChanged: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteSheet(sheet.id)
      toast.success('Лист удалён')
      onChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Не удалось удалить лист'))
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
          <AlertDialogTitle>Удалить лист?</AlertDialogTitle>
          <AlertDialogDescription>
            Лист {sheet.material} {formatMm(sheet.thickness)} {formatSize(sheet.width, sheet.height)} будет отправлен в архив.
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

function pageNumbers(page: number, totalPages: number) {
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 4)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

export function SheetsCatalogTab({
  result,
  material,
  thickness,
  thicknessOptions,
}: {
  result: PaginatedResponse<SheetCatalogItem>
  material?: string
  thickness?: number
  thicknessOptions: number[]
}) {
  const router = useRouter()
  const updateParams = useCatalogSearchUpdater()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingSheet, setEditingSheet] = useState<SheetCatalogItem | undefined>()

  function refresh() {
    router.refresh()
  }

  async function saveStock(sheet: SheetCatalogItem, value: number | null) {
    await updateSheet(sheet.id, { stock: value ?? 0 })
    toast.success('Остаток обновлён')
    refresh()
  }

  async function savePrice(sheet: SheetCatalogItem, value: number | null) {
    await updateSheet(sheet.id, { price: value })
    toast.success('Цена обновлена')
    refresh()
  }

  const from = result.total === 0 ? 0 : (result.page - 1) * 20 + 1
  const to = Math.min(result.total, (result.page - 1) * 20 + result.data.length)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-[#1B3A6B]">Листы</h2>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-white p-4 sm:flex-row">
        <Select
          value={material || 'all'}
          onValueChange={(value) => updateParams({ material: value, thickness: null })}
        >
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

        <Select
          value={thickness ? String(thickness) : 'all'}
          onValueChange={(value) => updateParams({ thickness: value })}
        >
          <SelectTrigger className="w-full bg-white sm:w-[180px]">
            <SelectValue>{thickness ? formatMm(thickness) : 'Все толщины'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все толщины</SelectItem>
            {thicknessOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>{formatMm(option)}</SelectItem>
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
                <TableHead>Толщина</TableHead>
                <TableHead>Размер</TableHead>
                <TableHead>Цена</TableHead>
                <TableHead>На складе</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map((sheet) => (
                <TableRow key={sheet.id}>
                  <TableCell className="font-medium text-[#1B3A6B]">{sheet.material}</TableCell>
                  <TableCell>{formatMm(sheet.thickness)}</TableCell>
                  <TableCell>{formatSize(sheet.width, sheet.height)}</TableCell>
                  <TableCell>
                    <InlineNumberEdit
                      value={sheet.price}
                      allowNull
                      displayValue={formatPrice(sheet.price)}
                      onSave={(value) => savePrice(sheet, value)}
                    />
                  </TableCell>
                  <TableCell>
                    <InlineNumberEdit
                      value={sheet.stock}
                      integer
                      displayValue={String(sheet.stock)}
                      onSave={(value) => saveStock(sheet, value)}
                    />
                  </TableCell>
                  <TableCell>
                    {sheet.isActive ? (
                      <Badge className="bg-emerald-50 text-emerald-700">Активен</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[#6B7280]">Архив</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <SheetActions sheet={sheet} onEdit={() => setEditingSheet(sheet)} onChanged={refresh} />
                  </TableCell>
                </TableRow>
              ))}
              {result.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-[#9CA3AF]">
                    Листы не найдены
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-3 text-sm text-[#6B7280] sm:flex-row sm:items-center sm:justify-between">
        <span>Показано {from}-{to} из {result.total}</span>
        {result.totalPages > 1 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => updateParams({ page: result.page - 1 }, false)}>
              Назад
            </Button>
            {pageNumbers(result.page, result.totalPages).map((page) => (
              <Button
                key={page}
                variant={page === result.page ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateParams({ page }, false)}
              >
                {page}
              </Button>
            ))}
            <Button variant="outline" size="sm" disabled={result.page >= result.totalPages} onClick={() => updateParams({ page: result.page + 1 }, false)}>
              Вперёд
            </Button>
          </div>
        )}
      </div>

      <SheetDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={refresh} />
      <SheetDialog
        open={Boolean(editingSheet)}
        onOpenChange={(open) => {
          if (!open) setEditingSheet(undefined)
        }}
        item={editingSheet}
        onSaved={refresh}
      />
    </div>
  )
}
