'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Plus, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ACTIVE_MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, defaultMaterialNameForCategory } from '@/lib/constants/procurement'
import { createMaterial, updateMaterial, type MaterialWithSupplier } from '@/lib/actions/materials'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import type { MaterialCategory } from '@/lib/types'

type Props = {
  materials: MaterialWithSupplier[]
  suppliers: SupplierWithRelations[]
  page: number
  pageSize: number
  total: number
}

export function MaterialsAdminPage({ materials, suppliers, page, pageSize, total }: Props) {
  const [rows, setRows] = useState(materials)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [supplier, setSupplier] = useState<string>('all')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNameTouched, setNewNameTouched] = useState(false)
  const [newCategory, setNewCategory] = useState<MaterialCategory>('sheet_metal')
  const [newComment, setNewComment] = useState('')
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => rows.filter((row) => {
    if (search && !row.name.toLowerCase().includes(search.toLowerCase())) return false
    if (category !== 'all' && row.category !== category) return false
    if (supplier === 'none' && row.default_supplier_id) return false
    if (supplier !== 'all' && supplier !== 'none' && row.default_supplier_id !== supplier) return false
    return true
  }), [category, rows, search, supplier])

  const getCategoryLabel = (value: string) => {
    if (value === 'all') return 'Все категории'
    return MATERIAL_CATEGORY_LABELS[value as keyof typeof MATERIAL_CATEGORY_LABELS] || value || 'Категория'
  }

  const getSupplierLabel = (value: string | null | undefined, emptyLabel = 'Не назначен') => {
    if (!value || value === 'none') return emptyLabel
    if (value === 'all') return 'Все поставщики'
    return suppliers.find((item) => item.id === value)?.name || 'Поставщик не найден'
  }

  const save = (id: string, values: Partial<MaterialWithSupplier>) => {
    startTransition(async () => {
      const result = await updateMaterial(id, values)
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось сохранить материал')
        return
      }
      const supplierName = suppliers.find((item) => item.id === result.data?.default_supplier_id)?.name || null
      setRows((current) => current.map((row) => row.id === id ? { ...row, ...result.data!, supplier_name: supplierName } : row))
      toast.success('Материал сохранен')
    })
  }

  const resetCreateForm = () => {
    setNewName(defaultMaterialNameForCategory('sheet_metal') ?? '')
    setNewNameTouched(false)
    setNewCategory('sheet_metal')
    setNewComment('')
  }

  const openCreateDialog = () => {
    resetCreateForm()
    setIsCreateOpen(true)
  }

  const handleNewCategoryChange = (value: MaterialCategory | null) => {
    if (!value) return
    const nextCategory = value
    const defaultName = defaultMaterialNameForCategory(nextCategory)
    setNewCategory(nextCategory)
    setNewName((current) => {
      if (!newNameTouched) return defaultName ?? ''
      if (defaultName && !current.trim()) return defaultName
      return current
    })
  }

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) {
      toast.error('Введите название материала')
      return
    }

    startTransition(async () => {
      const result = await createMaterial({
        name,
        category: newCategory,
        comment: newComment.trim() || null,
      })
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось создать материал')
        return
      }

      const created: MaterialWithSupplier = {
        ...result.data,
        supplier_name: null,
        variants_count: 0,
        last_used_at: null,
        sheet_grades: [],
        sheet_thicknesses: [],
        sheet_sizes: [],
      }
      setRows((current) => [created, ...current.filter((row) => row.id !== created.id)])
      resetCreateForm()
      setIsCreateOpen(false)
      toast.success('Материал добавлен')
    })
  }

  const list = (values?: Array<string | number>) => {
    if (!values?.length) return <span className="text-slate-400">-</span>
    return <span title={values.join(', ')}>{values.slice(0, 3).join(', ')}{values.length > 3 ? ` +${values.length - 3}` : ''}</span>
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить материал
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 md:flex-row">
        <Input placeholder="Поиск по названию" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={category} onValueChange={(value) => setCategory(value || 'all')}>
          <SelectTrigger className="w-full md:w-[220px]">
            <SelectValue placeholder="Все категории">
              <span className="block truncate">{getCategoryLabel(category)}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории</SelectItem>
            {ACTIVE_MATERIAL_CATEGORIES.map((item) => <SelectItem key={item} value={item}>{MATERIAL_CATEGORY_LABELS[item]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={supplier} onValueChange={(value) => setSupplier(value || 'all')}>
          <SelectTrigger className="w-full md:w-[240px]">
            <SelectValue placeholder="Все поставщики">
              <span className="block truncate">{getSupplierLabel(supplier, 'Без поставщика')}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все поставщики</SelectItem>
            <SelectItem value="none">Без поставщика</SelectItem>
            {suppliers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-[#E8ECF0] bg-white px-4 py-3 text-sm text-[#6B7280] sm:flex-row sm:items-center sm:justify-between">
        <span>
          Материалы {currentFrom}-{currentTo} из {total}. Страница {page + 1} из {pageCount}.
        </span>
        <div className="flex gap-2">
          <Link
            href={`/admin/materials?page=${page}`}
            className={page <= 0 ? 'pointer-events-none rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B]'}
          >
            Назад
          </Link>
          <Link
            href={`/admin/materials?page=${page + 2}`}
            className={page + 1 >= pageCount ? 'pointer-events-none rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B] opacity-50' : 'rounded-md border border-[#E8ECF0] px-3 py-1.5 font-medium text-[#1B3A6B]'}
          >
            Вперед
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#E8ECF0] bg-[#F8F9FA] text-[#6B7280]">
              <tr>
                <th className="min-w-[240px] px-4 py-3">Название</th>
                <th className="min-w-[150px] px-4 py-3">Категория</th>
                <th className="min-w-[260px] px-4 py-3">Поставщик</th>
                <th className="min-w-[150px] px-4 py-3">Марка</th>
                <th className="min-w-[140px] px-4 py-3">Толщина, мм</th>
                <th className="min-w-[170px] px-4 py-3">Размер листа</th>
                <th className="min-w-[220px] px-4 py-3">Комментарий</th>
                <th className="min-w-[120px] px-4 py-3">Варианты</th>
                <th className="w-32 px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8ECF0]">
              {filtered.map((row) => (
                <tr key={row.id} className={!row.default_supplier_id ? 'bg-amber-50/70' : undefined}>
                  <td className="px-4 py-3 font-medium text-[#1B3A6B]">
                    {row.name}
                    {!row.default_supplier_id && (
                      <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-100 text-amber-800">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Без поставщика
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">{MATERIAL_CATEGORY_LABELS[row.category] ?? row.category}</td>
                  <td className="px-4 py-3">
                    <Select value={row.default_supplier_id || 'none'} onValueChange={(value) => save(row.id, { default_supplier_id: value === 'none' ? null : value })}>
                      <SelectTrigger className="w-full min-w-[240px]">
                        <SelectValue placeholder="Не назначен">
                          <span className="block truncate">{getSupplierLabel(row.default_supplier_id, 'Не назначен')}</span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Не назначен</SelectItem>
                        {suppliers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">{row.category === 'sheet_metal' ? list(row.sheet_grades) : <span className="text-slate-400">-</span>}</td>
                  <td className="px-4 py-3">{row.category === 'sheet_metal' ? list(row.sheet_thicknesses) : <span className="text-slate-400">-</span>}</td>
                  <td className="px-4 py-3">{row.category === 'sheet_metal' ? list(row.sheet_sizes) : <span className="text-slate-400">-</span>}</td>
                  <td className="px-4 py-3">
                    <Input
                      defaultValue={row.comment || ''}
                      onBlur={(event) => {
                        if (event.target.value !== (row.comment || '')) save(row.id, { comment: event.target.value || null })
                      }}
                    />
                  </td>
                  <td className="px-4 py-3">{row.variants_count || 0}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => save(row.id, { is_active: !row.is_active })}>
                      <Save className="mr-1 h-3.5 w-3.5" />
                      {row.is_active ? 'Скрыть' : 'Включить'}
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[#9CA3AF]">Материалы не найдены</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Новый материал</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="material-name">Название материала *</Label>
              <Input
                id="material-name"
                value={newName}
                onChange={(event) => {
                  setNewNameTouched(true)
                  setNewName(event.target.value)
                }}
                placeholder="Например: Лист 20мм S355"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Категория *</Label>
              <Select value={newCategory} onValueChange={handleNewCategoryChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите категорию">
                    <span className="block truncate">{getCategoryLabel(newCategory)}</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACTIVE_MATERIAL_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {MATERIAL_CATEGORY_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="material-comment">Комментарий</Label>
              <Textarea
                id="material-comment"
                value={newComment}
                onChange={(event) => setNewComment(event.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setIsCreateOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={isPending} onClick={handleCreate}>
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
