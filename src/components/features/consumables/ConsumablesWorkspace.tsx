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
import { Badge } from '@/components/ui/badge'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  archiveConsumable,
  archiveConsumableCategory,
  createConsumable,
  createConsumableCategory,
  recordConsumableStockOperation,
  updateConsumable,
} from '@/lib/actions/consumables'
import { ROUTES } from '@/lib/constants/routes'
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
    <div className="space-y-5">
      <section className="rounded-xl border border-[#E8ECF0] bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1B3A6B]">Расходники производства</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Каталог, фактические остатки и журнал движения по выбранному заводу.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {factories.length > 1 && (
              <Select value={selectedFactoryId} onValueChange={switchFactory}>
                <SelectTrigger className="min-w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {factories.map((factory) => (
                    <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={() => setCategoryOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />Категория
            </Button>
            <Button onClick={openNewItem} disabled={activeCategories.length === 0}>
              <PackagePlus className="mr-2 h-4 w-4" />Расходник
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Активных позиций" value={String(activeStock.length)} icon={<Boxes className="h-5 w-5" />} />
        <MetricCard label="Ниже минимума" value={String(lowStock.length)} tone={lowStock.length ? 'warning' : 'default'} icon={<TriangleAlert className="h-5 w-5" />} />
        <MetricCard label="Операций в журнале" value={String(movements.length)} icon={<RefreshCcw className="h-5 w-5" />} />
      </div>

      <Tabs defaultValue="catalog">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-white p-1">
          <TabsTrigger value="catalog" className="min-h-10 px-4">Каталог</TabsTrigger>
          <TabsTrigger value="stock" className="min-h-10 px-4">Остатки</TabsTrigger>
          <TabsTrigger value="consumption" className="min-h-10 px-4">Расход</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4 space-y-4">
          <Card className="bg-white">
            <CardHeader><CardTitle className="text-lg text-[#1B3A6B]">Категории</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {categories.length === 0 && <EmptyText text="Категории еще не созданы." />}
              {categories.map((category) => (
                <div key={category.id} className="flex min-h-11 items-center gap-2 rounded-lg border border-[#E8ECF0] px-3">
                  <span className={category.is_active ? 'text-[#374151]' : 'text-[#9CA3AF] line-through'}>{category.name}</span>
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
          <Card className="bg-white">
            <CardHeader><CardTitle className="text-lg text-[#1B3A6B]">Списать расходник</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeStock.map((item) => (
                  <button
                    key={item.consumable_id}
                    type="button"
                    onClick={() => openOperation(item, 'consumption')}
                    className="min-h-20 rounded-lg border border-[#E8ECF0] bg-white p-3 text-left transition-colors hover:border-[#1B3A6B]/30 hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]"
                  >
                    <div className="font-medium text-[#1B3A6B]">{item.name}</div>
                    <div className="mt-1 text-sm text-[#6B7280]">Доступно: {quantity(item.current_quantity, item.unit)}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <MovementHistory movements={movements} />
        </TabsContent>
      </Tabs>

      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Новая категория</DialogTitle>
            <DialogDescription>Категория создается только для выбранного завода.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Название *"><Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></Field>
            <Field label="Описание"><Textarea value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryOpen(false)}>Отмена</Button>
            <Button onClick={submitCategory} disabled={!categoryName.trim()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Редактировать расходник' : 'Новый расходник'}</DialogTitle>
            <DialogDescription>Артикул должен быть уникальным внутри выбранного завода.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Категория *">
              <Select
                value={itemForm.categoryId}
                onValueChange={(value) => {
                  if (value) setItemForm((current) => ({ ...current, categoryId: value }))
                }}
              >
                <SelectTrigger><SelectValue placeholder="Выберите категорию" /></SelectTrigger>
                <SelectContent>
                  {activeCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Название *"><Input value={itemForm.name} onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field label="Артикул *"><Input value={itemForm.article} onChange={(event) => setItemForm((current) => ({ ...current, article: event.target.value }))} /></Field>
            <Field label="Единица учета *"><Input value={itemForm.unit} onChange={(event) => setItemForm((current) => ({ ...current, unit: event.target.value }))} placeholder="шт, кг, л, м, упаковка" /></Field>
            <div className="sm:col-span-2">
              <Field label="Характеристика *"><Textarea value={itemForm.characteristics} onChange={(event) => setItemForm((current) => ({ ...current, characteristics: event.target.value }))} /></Field>
            </div>
            <Field label="Минимальный остаток *"><Input type="number" min="0" step="0.001" value={itemForm.minimumQuantity} onChange={(event) => setItemForm((current) => ({ ...current, minimumQuantity: event.target.value }))} /></Field>
            {!editingItem && (
              <Field label="Начальный остаток"><Input type="number" min="0" step="0.001" value={itemForm.initialQuantity} onChange={(event) => setItemForm((current) => ({ ...current, initialQuantity: event.target.value }))} /></Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)}>Отмена</Button>
            <Button onClick={submitItem}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(operationItem)} onOpenChange={(open) => !open && setOperationItem(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {operation === 'manual_receipt' ? 'Приход' : operation === 'consumption' ? 'Расход' : 'Корректировка'}: {operationItem?.name}
            </DialogTitle>
            <DialogDescription>
              Текущий остаток: {operationItem ? quantity(operationItem.current_quantity, operationItem.unit) : '—'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label={operation === 'adjustment' ? 'Новый фактический остаток *' : 'Количество *'}>
              <Input type="number" min="0" step="0.001" value={operationQuantity} onChange={(event) => setOperationQuantity(event.target.value)} />
            </Field>
            <Field label={operation === 'consumption' ? 'Комментарий' : 'Комментарий / причина *'}>
              <Textarea value={operationComment} onChange={(event) => setOperationComment(event.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOperationItem(null)}>Отмена</Button>
            <Button onClick={submitOperation}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isPending && <div className="sr-only" aria-live="polite">Обновление данных</div>}
    </div>
  )
}

function MetricCard({ label, value, icon, tone = 'default' }: { label: string; value: string; icon: React.ReactNode; tone?: 'default' | 'warning' }) {
  return (
    <Card className={tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'bg-white'}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={tone === 'warning' ? 'rounded-lg bg-amber-100 p-2 text-amber-700' : 'rounded-lg bg-[#1B3A6B]/10 p-2 text-[#1B3A6B]'}>{icon}</div>
        <div><div className="text-2xl font-semibold tabular-nums text-[#1B3A6B]">{value}</div><div className="text-xs text-[#6B7280]">{label}</div></div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function EmptyText({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-[#6B7280]">{text}</p>
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
  if (rows.length === 0) return <Card className="bg-white"><CardContent><EmptyText text="Расходники еще не созданы." /></CardContent></Card>

  return (
    <Card className="overflow-hidden bg-white">
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Расходник</TableHead><TableHead>Категория</TableHead><TableHead>Артикул</TableHead>
            <TableHead className="text-right">Остаток</TableHead><TableHead className="text-right">В работе</TableHead>
            <TableHead className="text-right">Минимум</TableHead><TableHead className="w-52 text-right">Действия</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((item) => (
              <TableRow key={item.consumable_id} className={!item.is_active ? 'opacity-55' : undefined}>
                <TableCell><div className="font-medium text-[#1B3A6B]">{item.name}</div><div className="max-w-72 text-xs text-[#6B7280]">{item.characteristics}</div></TableCell>
                <TableCell>{item.category_name}</TableCell><TableCell className="font-mono text-xs">{item.article}</TableCell>
                <TableCell className="text-right tabular-nums">{quantity(item.current_quantity, item.unit)}{item.is_below_minimum && <Badge className="ml-2 border-amber-200 bg-amber-50 text-amber-700">Дефицит</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">{quantity(item.in_work_quantity, item.unit)}</TableCell>
                <TableCell className="text-right tabular-nums">{quantity(item.minimum_quantity, item.unit)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {mode === 'catalog' ? (
                      <>
                        {item.is_active && <Button variant="ghost" size="icon-sm" aria-label={`Редактировать ${item.name}`} onClick={() => onEdit?.(item)}><Pencil className="h-4 w-4" /></Button>}
                        {item.is_active && <Button variant="ghost" size="icon-sm" aria-label={`Архивировать ${item.name}`} onClick={() => onArchive?.(item)}><Archive className="h-4 w-4" /></Button>}
                      </>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => onOperation?.(item, 'manual_receipt')}><ArrowDownToLine className="mr-1 h-4 w-4" />Приход</Button>
                        <Button variant="outline" size="sm" onClick={() => onOperation?.(item, 'adjustment')}><RefreshCcw className="mr-1 h-4 w-4" />Сверка</Button>
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
          <div key={item.consumable_id} className="rounded-lg border border-[#E8ECF0] p-4">
            <div className="flex items-start justify-between gap-3"><div><div className="font-medium text-[#1B3A6B]">{item.name}</div><div className="text-xs text-[#6B7280]">{item.category_name} · {item.article}</div></div>{item.is_below_minimum && <Badge className="border-amber-200 bg-amber-50 text-amber-700">Дефицит</Badge>}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><span className="text-[#6B7280]">Остаток</span><div className="font-medium">{quantity(item.current_quantity, item.unit)}</div></div><div><span className="text-[#6B7280]">В работе</span><div className="font-medium">{quantity(item.in_work_quantity, item.unit)}</div></div><div><span className="text-[#6B7280]">Минимум</span><div className="font-medium">{quantity(item.minimum_quantity, item.unit)}</div></div></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {mode === 'catalog' ? (
                <><Button variant="outline" size="sm" onClick={() => onEdit?.(item)}>Изменить</Button><Button variant="outline" size="sm" onClick={() => onArchive?.(item)}>Архив</Button></>
              ) : (
                <><Button variant="outline" size="sm" onClick={() => onOperation?.(item, 'manual_receipt')}>Приход</Button><Button variant="outline" size="sm" onClick={() => onOperation?.(item, 'adjustment')}>Сверка</Button></>
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
    <Card className="bg-white">
      <CardHeader><CardTitle className="text-lg text-[#1B3A6B]">История операций</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {movements.length === 0 && <EmptyText text="Операций пока нет." />}
        {movements.map((movement) => (
          <div key={movement.id} className="flex flex-col gap-2 rounded-lg border border-[#E8ECF0] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="font-medium text-[#374151]">{movement.consumable?.name || 'Расходник'}</div><div className="text-xs text-[#6B7280]">{MOVEMENT_LABELS[movement.movement_type]} · {new Date(movement.created_at).toLocaleString('ru-RU')}</div>{movement.comment && <div className="mt-1 text-xs text-[#6B7280]">{movement.comment}</div>}</div>
            <div className="flex items-center gap-3"><span className={Number(movement.quantity_delta) >= 0 ? 'font-semibold tabular-nums text-emerald-700' : 'font-semibold tabular-nums text-red-700'}>{Number(movement.quantity_delta) >= 0 ? '+' : ''}{quantity(movement.quantity_delta, movement.consumable?.unit)}</span><ClipboardMinus className="h-4 w-4 text-[#9CA3AF]" /></div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
