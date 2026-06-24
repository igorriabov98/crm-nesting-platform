'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Archive,
  ArrowDownToLine,
  Boxes,
  ClipboardMinus,
  FolderPlus,
  PackagePlus,
  Pencil,
  RefreshCcw,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  IndustrialMetricCard,
  IndustrialSearchPicker,
  IndustrialSelectText,
  IndustrialStatusBadge,
  industrial,
  type IndustrialPickerOption,
} from '@/components/features/consumables/IndustrialConsumablesUI'
import {
  archiveConsumable,
  archiveConsumableCategory,
  createConsumable,
  createConsumableCategory,
  recordConsumableStockOperation,
  updateConsumable,
} from '@/lib/actions/consumables'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@/lib/utils'
import type {
  ConsumableCategory,
  ConsumableMovement,
  ConsumableStockRow,
  FactorySummary,
} from '@/lib/types'

type Props = {
  factories: FactorySummary[]
  selectedFactoryId: string
  categories: ConsumableCategory[]
  stock: ConsumableStockRow[]
  movements: ConsumableMovement[]
}

type ItemForm = {
  categoryId: string
  name: string
  characteristics: string
  article: string
  unit: string
  minimumQuantity: string
  initialQuantity: string
}

const emptyItemForm: ItemForm = {
  categoryId: '',
  name: '',
  characteristics: '',
  article: '',
  unit: 'шт',
  minimumQuantity: '0',
  initialQuantity: '0',
}

const MOVEMENT_LABELS: Record<string, string> = {
  initial: 'Начальный остаток',
  manual_receipt: 'Приход',
  request_receipt: 'Получение заявки',
  consumption: 'Расход',
  adjustment: 'Корректировка',
}

function quantity(value: number | string, unit?: string) {
  const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(Number(value || 0))
  return unit ? `${formatted} ${unit}` : formatted
}

export function ConsumablesWorkspace({ factories, selectedFactoryId, categories, stock, movements }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [itemOpen, setItemOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ConsumableStockRow | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm)
  const [operationItem, setOperationItem] = useState<ConsumableStockRow | null>(null)
  const [operation, setOperation] = useState<'manual_receipt' | 'consumption' | 'adjustment'>('manual_receipt')
  const [operationQuantity, setOperationQuantity] = useState('')
  const [operationComment, setOperationComment] = useState('')

  const activeCategories = useMemo(() => categories.filter((category) => category.is_active), [categories])
  const activeStock = useMemo(() => stock.filter((item) => item.is_active), [stock])
  const lowStock = activeStock.filter((item) => item.is_below_minimum)
  const factoryOptions = useMemo(
    () => factories.map((factory) => ({ value: factory.id, label: factory.name })),
    [factories],
  )
  const categoryOptions = useMemo<IndustrialPickerOption[]>(
    () => activeCategories.map((category) => ({
      value: category.id,
      label: category.name,
      description: category.description || 'Категория расходников',
    })),
    [activeCategories],
  )
  const selectedFactoryLabel = factoryOptions.find((factory) => factory.value === selectedFactoryId)?.label || 'Завод не найден'

  function refresh() {
    startTransition(() => router.refresh())
  }

  function switchFactory(factoryId: string | null) {
    if (!factoryId) return
    startTransition(() => router.push(`${ROUTES.PRODUCTION_CONSUMABLES}?factory=${factoryId}`))
  }

  function openNewItem() {
    setEditingItem(null)
    setItemForm({ ...emptyItemForm, categoryId: activeCategories[0]?.id || '' })
    setItemOpen(true)
  }

  function openEditItem(item: ConsumableStockRow) {
    setEditingItem(item)
    setItemForm({
      categoryId: item.category_id,
      name: item.name,
      characteristics: item.characteristics,
      article: item.article,
      unit: item.unit,
      minimumQuantity: String(item.minimum_quantity),
      initialQuantity: '0',
    })
    setItemOpen(true)
  }

  async function submitCategory() {
    const result = await createConsumableCategory({
      factoryId: selectedFactoryId,
      name: categoryName,
      description: categoryDescription,
    })
    if (!result.success) return toast.error(result.error)
    toast.success('Категория создана')
    setCategoryName('')
    setCategoryDescription('')
    setCategoryOpen(false)
    refresh()
  }

  async function submitItem() {
    const payload = {
      factoryId: selectedFactoryId,
      categoryId: itemForm.categoryId,
      name: itemForm.name,
      characteristics: itemForm.characteristics,
      article: itemForm.article,
      unit: itemForm.unit,
      minimumQuantity: Number(itemForm.minimumQuantity),
      initialQuantity: Number(itemForm.initialQuantity),
    }
    const result = editingItem
      ? await updateConsumable(editingItem.consumable_id, {
          categoryId: payload.categoryId,
          name: payload.name,
          characteristics: payload.characteristics,
          article: payload.article,
          unit: payload.unit,
          minimumQuantity: payload.minimumQuantity,
        })
      : await createConsumable(payload)

    if (!result.success) return toast.error(result.error)
    toast.success(editingItem ? 'Расходник обновлен' : 'Расходник создан')
    setItemOpen(false)
    refresh()
  }

  async function submitOperation() {
    if (!operationItem) return
    const result = await recordConsumableStockOperation({
      consumableId: operationItem.consumable_id,
      operation,
      quantity: operation === 'adjustment' ? 0 : Number(operationQuantity),
      newBalance: operation === 'adjustment' ? Number(operationQuantity) : null,
      comment: operationComment,
    })
    if (!result.success) return toast.error(result.error)
    toast.success('Операция сохранена')
    setOperationItem(null)
    setOperationQuantity('')
    setOperationComment('')
    refresh()
  }

  function openOperation(item: ConsumableStockRow, nextOperation: typeof operation) {
    setOperationItem(item)
    setOperation(nextOperation)
    setOperationQuantity(nextOperation === 'adjustment' ? String(item.current_quantity) : '')
    setOperationComment('')
  }

  return (
    <div className={industrial.shell}>
      <section className={industrial.hero}>
        <div className={industrial.heroGlow} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="relative">
            <div className={industrial.eyebrow}>Industrial consumables</div>
            <h1 className={industrial.title}>Расходники производства</h1>
            <p className={industrial.description}>
              Каталог, фактические остатки и журнал движения по выбранному заводу.
            </p>
          </div>
          <div className="relative flex flex-col gap-2 sm:flex-row">
            {factories.length > 1 && (
              <Select value={selectedFactoryId} onValueChange={switchFactory}>
                <SelectTrigger className={industrial.selectTrigger}>
                  <IndustrialSelectText>{selectedFactoryLabel}</IndustrialSelectText>
                </SelectTrigger>
                <SelectContent>
                  {factoryOptions.map((factory) => (
                    <SelectItem key={factory.value} value={factory.value}>{factory.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button className="border-white/20 bg-white/10 text-white hover:bg-white/20" variant="outline" onClick={() => setCategoryOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />Категория
            </Button>
            <Button className={industrial.primary} onClick={openNewItem} disabled={activeCategories.length === 0}>
              <PackagePlus className="mr-2 h-4 w-4" />Расходник
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <IndustrialMetricCard label="Активных позиций" value={activeStock.length} icon={<Boxes className="h-5 w-5" />} />
        <IndustrialMetricCard label="Ниже минимума" value={lowStock.length} tone={lowStock.length ? 'warning' : 'success'} icon={<TriangleAlert className="h-5 w-5" />} />
        <IndustrialMetricCard label="Операций в журнале" value={movements.length} icon={<RefreshCcw className="h-5 w-5" />} />
      </div>

      <Tabs defaultValue="catalog">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          <TabsTrigger value="catalog" className="min-h-10 px-4 data-[state=active]:bg-slate-950 data-[state=active]:text-amber-300">Каталог</TabsTrigger>
          <TabsTrigger value="stock" className="min-h-10 px-4 data-[state=active]:bg-slate-950 data-[state=active]:text-amber-300">Остатки</TabsTrigger>
          <TabsTrigger value="consumption" className="min-h-10 px-4 data-[state=active]:bg-slate-950 data-[state=active]:text-amber-300">Расход</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4 space-y-4">
          <Card className={industrial.panel}>
            <CardHeader><CardTitle className="text-lg text-slate-950">Категории</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {categories.length === 0 && <EmptyText text="Категории еще не созданы." />}
              {categories.map((category) => (
                <div key={category.id} className="flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3">
                  <span className={category.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}>{category.name}</span>
                  {category.is_active && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Архивировать категорию ${category.name}`}
                      onClick={async () => {
                        const result = await archiveConsumableCategory(category.id)
                        if (!result.success) return toast.error(result.error)
                        toast.success('Категория архивирована')
                        refresh()
                      }}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          <StockTable
            rows={stock}
            mode="catalog"
            onEdit={openEditItem}
            onArchive={async (item) => {
              const result = await archiveConsumable(item.consumable_id)
              if (!result.success) return toast.error(result.error)
              toast.success('Расходник архивирован')
              refresh()
            }}
          />
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <StockTable rows={activeStock} mode="stock" onOperation={openOperation} />
        </TabsContent>

        <TabsContent value="consumption" className="mt-4 space-y-4">
          <Card className={industrial.panel}>
            <CardHeader><CardTitle className="text-lg text-slate-950">Списать расходник</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeStock.map((item) => (
                  <button
                    key={item.consumable_id}
                    type="button"
                    onClick={() => openOperation(item, 'consumption')}
                    className="min-h-24 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    <div className="font-semibold text-slate-950">{item.name}</div>
                    <div className={cn('mt-1 text-xs text-slate-500', industrial.mono)}>{item.article}</div>
                    <div className="mt-2 text-sm text-slate-600">Доступно: {quantity(item.current_quantity, item.unit)}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <MovementHistory movements={movements} />
        </TabsContent>
      </Tabs>

      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-950">Новая категория</DialogTitle>
            <DialogDescription>Категория создается только для выбранного завода.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Название *"><Input className={industrial.input} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></Field>
            <Field label="Описание"><Textarea value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} /></Field>
          </div>
          <DialogFooter>
            <Button className={industrial.action} variant="outline" onClick={() => setCategoryOpen(false)}>Отмена</Button>
            <Button className={industrial.primary} onClick={submitCategory} disabled={!categoryName.trim()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-slate-200 bg-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-slate-950">{editingItem ? 'Редактировать расходник' : 'Новый расходник'}</DialogTitle>
            <DialogDescription>Артикул должен быть уникальным внутри выбранного завода.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Категория *">
              <IndustrialSearchPicker
                value={itemForm.categoryId}
                options={categoryOptions}
                placeholder="Выберите категорию"
                searchPlaceholder="Поиск категории"
                emptyText="Категория не найдена"
                onValueChange={(value) => setItemForm((current) => ({ ...current, categoryId: value }))}
              />
            </Field>
            <Field label="Название *"><Input className={industrial.input} value={itemForm.name} onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field label="Артикул *"><Input className={cn(industrial.input, industrial.mono)} value={itemForm.article} onChange={(event) => setItemForm((current) => ({ ...current, article: event.target.value }))} /></Field>
            <Field label="Единица учета *"><Input className={industrial.input} value={itemForm.unit} onChange={(event) => setItemForm((current) => ({ ...current, unit: event.target.value }))} placeholder="шт, кг, л, м, упаковка" /></Field>
            <div className="sm:col-span-2">
              <Field label="Характеристика *"><Textarea value={itemForm.characteristics} onChange={(event) => setItemForm((current) => ({ ...current, characteristics: event.target.value }))} /></Field>
            </div>
            <Field label="Минимальный остаток *"><Input className={cn(industrial.input, industrial.mono)} type="number" min="0" step="0.001" value={itemForm.minimumQuantity} onChange={(event) => setItemForm((current) => ({ ...current, minimumQuantity: event.target.value }))} /></Field>
            {!editingItem && (
              <Field label="Начальный остаток"><Input className={cn(industrial.input, industrial.mono)} type="number" min="0" step="0.001" value={itemForm.initialQuantity} onChange={(event) => setItemForm((current) => ({ ...current, initialQuantity: event.target.value }))} /></Field>
            )}
          </div>
          <DialogFooter>
            <Button className={industrial.action} variant="outline" onClick={() => setItemOpen(false)}>Отмена</Button>
            <Button className={industrial.primary} onClick={submitItem}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(operationItem)} onOpenChange={(open) => !open && setOperationItem(null)}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-slate-950">
              {operation === 'manual_receipt' ? 'Приход' : operation === 'consumption' ? 'Расход' : 'Корректировка'}: {operationItem?.name}
            </DialogTitle>
            <DialogDescription>
              Текущий остаток: {operationItem ? quantity(operationItem.current_quantity, operationItem.unit) : '—'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={operation === 'adjustment' ? 'Новый фактический остаток *' : 'Количество *'}>
              <Input className={cn(industrial.input, industrial.mono)} type="number" min="0" step="0.001" value={operationQuantity} onChange={(event) => setOperationQuantity(event.target.value)} />
            </Field>
            <Field label={operation === 'consumption' ? 'Комментарий' : 'Комментарий / причина *'}>
              <Textarea value={operationComment} onChange={(event) => setOperationComment(event.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button className={industrial.action} variant="outline" onClick={() => setOperationItem(null)}>Отмена</Button>
            <Button className={industrial.primary} onClick={submitOperation}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isPending && <div className="sr-only" aria-live="polite">Обновление данных</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className={industrial.label}>{label}</Label>{children}</div>
}

function EmptyText({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{text}</p>
}

function StockTable({
  rows,
  mode,
  onEdit,
  onArchive,
  onOperation,
}: {
  rows: ConsumableStockRow[]
  mode: 'catalog' | 'stock'
  onEdit?: (item: ConsumableStockRow) => void
  onArchive?: (item: ConsumableStockRow) => void
  onOperation?: (item: ConsumableStockRow, operation: 'manual_receipt' | 'consumption' | 'adjustment') => void
}) {
  if (rows.length === 0) return <Card className={industrial.panel}><CardContent><EmptyText text="Расходники еще не созданы." /></CardContent></Card>

  return (
    <Card className={cn('overflow-hidden', industrial.panel)}>
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader><TableRow className={industrial.tableHead}>
            <TableHead>Расходник</TableHead><TableHead>Категория</TableHead><TableHead>Артикул</TableHead>
            <TableHead className="text-right">Остаток</TableHead><TableHead className="text-right">В работе</TableHead>
            <TableHead className="text-right">Минимум</TableHead><TableHead className="w-52 text-right">Действия</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={item.consumable_id} className={cn('border-slate-100 hover:bg-slate-50/80', !item.is_active && 'opacity-55')}>
                <TableCell><div className="font-semibold text-slate-950">{item.name}</div><div className="max-w-72 text-xs text-slate-500">{item.characteristics}</div></TableCell>
                <TableCell className="text-slate-700">{item.category_name}</TableCell><TableCell className={cn('text-xs text-slate-600', industrial.mono)}>{item.article}</TableCell>
                <TableCell className={cn('text-right tabular-nums text-slate-950', industrial.mono)}>{quantity(item.current_quantity, item.unit)}{item.is_below_minimum && <span className="ml-2"><IndustrialStatusBadge tone="warning">Дефицит</IndustrialStatusBadge></span>}</TableCell>
                <TableCell className={cn('text-right tabular-nums text-slate-700', industrial.mono)}>{quantity(item.in_work_quantity, item.unit)}</TableCell>
                <TableCell className={cn('text-right tabular-nums text-slate-700', industrial.mono)}>{quantity(item.minimum_quantity, item.unit)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {mode === 'catalog' ? (
                      <>
                        {item.is_active && <Button className="text-slate-600 hover:bg-amber-50 hover:text-amber-700" variant="ghost" size="icon-sm" aria-label={`Редактировать ${item.name}`} onClick={() => onEdit?.(item)}><Pencil className="h-4 w-4" /></Button>}
                        {item.is_active && <Button className="text-slate-600 hover:bg-red-50 hover:text-red-700" variant="ghost" size="icon-sm" aria-label={`Архивировать ${item.name}`} onClick={() => onArchive?.(item)}><Archive className="h-4 w-4" /></Button>}
                      </>
                    ) : (
                      <>
                        <Button className={industrial.action} variant="outline" size="sm" onClick={() => onOperation?.(item, 'manual_receipt')}><ArrowDownToLine className="mr-1 h-4 w-4" />Приход</Button>
                        <Button className={industrial.action} variant="outline" size="sm" onClick={() => onOperation?.(item, 'adjustment')}><RefreshCcw className="mr-1 h-4 w-4" />Сверка</Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 p-3 md:hidden">
        {rows.map((item) => (
          <div key={item.consumable_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-950">{item.name}</div><div className={cn('text-xs text-slate-500', industrial.mono)}>{item.category_name} · {item.article}</div></div>{item.is_below_minimum && <IndustrialStatusBadge tone="warning">Дефицит</IndustrialStatusBadge>}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><span className="text-slate-500">Остаток</span><div className={cn('font-semibold', industrial.mono)}>{quantity(item.current_quantity, item.unit)}</div></div><div><span className="text-slate-500">В работе</span><div className={cn('font-semibold', industrial.mono)}>{quantity(item.in_work_quantity, item.unit)}</div></div><div><span className="text-slate-500">Минимум</span><div className={cn('font-semibold', industrial.mono)}>{quantity(item.minimum_quantity, item.unit)}</div></div></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {mode === 'catalog' ? (
                <><Button className={industrial.action} variant="outline" size="sm" onClick={() => onEdit?.(item)}>Изменить</Button><Button className={industrial.danger} variant="outline" size="sm" onClick={() => onArchive?.(item)}>Архив</Button></>
              ) : (
                <><Button className={industrial.action} variant="outline" size="sm" onClick={() => onOperation?.(item, 'manual_receipt')}>Приход</Button><Button className={industrial.action} variant="outline" size="sm" onClick={() => onOperation?.(item, 'adjustment')}>Сверка</Button></>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function MovementHistory({ movements }: { movements: ConsumableMovement[] }) {
  return (
    <Card className={industrial.panel}>
      <CardHeader><CardTitle className="text-lg text-slate-950">История операций</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {movements.length === 0 && <EmptyText text="Операций пока нет." />}
        {movements.map((movement) => (
          <div key={movement.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-semibold text-slate-800">{movement.consumable?.name || 'Расходник'}</div><div className="text-xs text-slate-500">{MOVEMENT_LABELS[movement.movement_type]} · {new Date(movement.created_at).toLocaleString('ru-RU')}</div>{movement.comment && <div className="mt-1 text-xs text-slate-500">{movement.comment}</div>}</div>
            <div className="flex items-center gap-3"><span className={cn('font-semibold tabular-nums', industrial.mono, Number(movement.quantity_delta) >= 0 ? 'text-emerald-700' : 'text-red-700')}>{Number(movement.quantity_delta) >= 0 ? '+' : ''}{quantity(movement.quantity_delta, movement.consumable?.unit)}</span><ClipboardMinus className="h-4 w-4 text-slate-400" /></div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
