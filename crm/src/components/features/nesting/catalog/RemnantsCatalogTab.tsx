'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Info, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
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
import { deleteRemnant, type RemnantItem } from '@/lib/nesting/catalog-api'
import { RemnantDialog } from '@/components/features/nesting/catalog/RemnantDialog'
import {
  MATERIAL_OPTIONS,
  formatCatalogDate,
  formatMm,
  formatSize,
  getErrorMessage,
  useCatalogSearchUpdater,
} from '@/components/features/nesting/catalog/shared'
import { cn } from '@/lib/utils'

function remnantSource(item: RemnantItem) {
  if (item.sourceOrder && item.sourceSheet) return `${item.sourceOrder} ${item.sourceSheet}`
  return item.sourceOrder || item.sourceSheet || 'Вручную'
}

function RemnantStatus({ item }: { item: RemnantItem }) {
  if (item.isAvailable) {
    return (
      <Badge className="bg-emerald-50 text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Доступен
      </Badge>
    )
  }

  return (
    <div className="space-y-1">
      <Badge variant="outline" className="text-[#6B7280]">
        <span className="h-2 w-2 rounded-full bg-[#9CA3AF]" />
        Использован
      </Badge>
      <p className="text-xs text-[#6B7280]">
        {formatCatalogDate(item.usedAt)}{item.usedInOrder ? ` · ${item.usedInOrder}` : ''}
      </p>
    </div>
  )
}

function RemnantActions({
  item,
  onChanged,
}: {
  item: RemnantItem
  onChanged: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteRemnant(item.id)
      toast.success('Остаток удалён')
      onChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Не удалось удалить остаток'))
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
          <DropdownMenuItem disabled>Редактирование недоступно</DropdownMenuItem>
          <DropdownMenuSeparator />
          <AlertDialogTrigger className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm text-red-600 hover:bg-red-50 focus:outline-none">
            <Trash2 className="h-4 w-4" />
            Удалить
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent className="bg-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить остаток?</AlertDialogTitle>
          <AlertDialogDescription>
            Остаток {item.material} {formatMm(item.thickness)} {formatSize(item.width, item.height)} будет удалён без архивации.
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

export function RemnantsCatalogTab({
  items,
  material,
  thickness,
  availableOnly,
}: {
  items: RemnantItem[]
  material?: string
  thickness?: number
  availableOnly: boolean
}) {
  const router = useRouter()
  const updateParams = useCatalogSearchUpdater()
  const [createOpen, setCreateOpen] = useState(false)

  const thicknessOptions = useMemo(() => {
    const values = new Set(items.map((item) => item.thickness))
    if (thickness) values.add(thickness)
    return Array.from(values).sort((a, b) => a - b)
  }, [items, thickness])

  function refresh() {
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-[#1B3A6B]">Склад остатков</h2>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Добавить вручную
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[#E8ECF0] bg-white p-4 md:flex-row md:items-center">
        <Select
          value={material || 'all'}
          onValueChange={(value) => updateParams({ material: value, thickness: null })}
        >
          <SelectTrigger className="w-full bg-white md:w-[220px]">
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
          <SelectTrigger className="w-full bg-white md:w-[180px]">
            <SelectValue>{thickness ? formatMm(thickness) : 'Все толщины'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все толщины</SelectItem>
            {thicknessOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>{formatMm(option)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 md:ml-auto">
          <Switch
            checked={availableOnly}
            onCheckedChange={(checked) => updateParams({ availableOnly: checked ? null : false })}
          />
          <Label className="text-sm text-[#374151]">Только доступные</Label>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F8F9FA]">
                <TableHead>Материал</TableHead>
                <TableHead>Толщ.</TableHead>
                <TableHead>Размер</TableHead>
                <TableHead>Источник</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className={cn(!item.isAvailable && 'bg-[#F8F9FA] text-[#6B7280]')}>
                  <TableCell className="font-medium text-[#1B3A6B]">{item.material}</TableCell>
                  <TableCell>{formatMm(item.thickness)}</TableCell>
                  <TableCell>{formatSize(item.width, item.height)}</TableCell>
                  <TableCell>{remnantSource(item)}</TableCell>
                  <TableCell>{formatCatalogDate(item.createdAt)}</TableCell>
                  <TableCell><RemnantStatus item={item} /></TableCell>
                  <TableCell><RemnantActions item={item} onChanged={refresh} /></TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-[#9CA3AF]">
                    Остатки не найдены
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
          Остатки автоматически добавляются после раскладки как деловой отход. При новом расчёте система сначала пробует разместить детали на остатках, потом берёт новый лист.
        </p>
      </div>

      <RemnantDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={refresh} />
    </div>
  )
}
