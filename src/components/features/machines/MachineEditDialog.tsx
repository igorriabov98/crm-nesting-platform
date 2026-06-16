'use client'

import { useEffect, useState, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useFieldArray, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateMachineSchema, type UpdateMachineInput } from '@/lib/types/schemas'
import { updateMachine } from '@/app/(protected)/sales-plan/actions'
import { getNextSpecificationNumber } from '@/lib/actions/contracts'
import { getProductOptions, type ProductOption } from '@/lib/actions/products'
import { COATINGS } from '@/lib/constants/coatings'
import { getFactoryWorkshopOptionsById, productionQueueLabel } from '@/lib/constants/factory-workshops'
import { formatProductionMonth, getProductionMonthOptions } from '@/lib/utils/production-months'
import { ContractSelectField } from '@/components/features/contracts/ContractSelectField'
import type { FactorySummary, MachineDetails, MachineExpense, MachineItem, MachineListItem } from '@/lib/types'
import { TRANSPORT_EXPENSE_CATEGORY, isTransportExpenseCategory } from '@/lib/utils/transport-expense'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'

type MachineFormItem = NonNullable<UpdateMachineInput['items']>[number] & { id?: string }
type MachineFormExpense = NonNullable<UpdateMachineInput['expenses']>[number] & { id?: string }
type MachineFormInput = Omit<UpdateMachineInput, 'items' | 'expenses'> & {
  items?: MachineFormItem[]
  samples?: MachineFormItem[]
  expenses?: MachineFormExpense[]
}

type EditableMachine = (MachineDetails | MachineListItem) & {
  machine_expenses?: MachineExpense[]
}

interface MachineEditDialogProps {
  machine: EditableMachine
  isOpen: boolean
  onClose: () => void
  isDirector?: boolean
  factories?: FactorySummary[]
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function parseNumberInput(value: string) {
  if (value === '') return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function parseIntegerInput(value: string) {
  if (value === '') return undefined
  const numberValue = Number.parseInt(value, 10)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function toNumberInputValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : ''
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function dateOnly(date: Date | undefined) {
  if (!date) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MachineEditDialog({ machine, isOpen, onClose, isDirector, factories = [] }: MachineEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([])
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<string[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])

  // Подготавливаем дефолтные значения из машины
  const allDefaultItems = machine.machine_items || []
  const defaultItems: (Partial<MachineItem> | NonNullable<MachineListItem['machine_items']>[number])[] = allDefaultItems.filter((item) => !item.is_sample)
  const defaultSamples: (Partial<MachineItem> | NonNullable<MachineListItem['machine_items']>[number])[] = allDefaultItems.filter((item) => item.is_sample)
  
  const defaultExpenses = machine.machine_expenses || []
  const defaultTransportExpenses = defaultExpenses.filter((expense) => isTransportExpenseCategory(expense.category))
  const defaultTransportExpense = defaultTransportExpenses[0]
  const defaultTransportAmount = defaultTransportExpenses.reduce(
    (sum, expense) => sum + Math.max(0, toFiniteNumber(expense.amount)),
    0,
  )
  const duplicateTransportExpenseIds = defaultTransportExpenses
    .slice(1)
    .map((expense) => expense.id)
    .filter((id): id is string => typeof id === 'string')
  const defaultRegularExpenses = defaultExpenses.filter((expense) => !isTransportExpenseCategory(expense.category))
  const [transportAmount, setTransportAmount] = useState<number | undefined>(
    defaultTransportAmount > 0 ? defaultTransportAmount : undefined,
  )
  const documentFields = machine as EditableMachine & {
    contract_id?: string | null
    specification_number?: string | null
    specification_date?: string | null
  }
  const selectedClientId = machine.client_id || null

  const form = useForm<MachineFormInput>({
    resolver: zodResolver(updateMachineSchema) as unknown as Resolver<MachineFormInput>,
    defaultValues: {
      name: machine.name || '',
      factory_id: machine.factory_id || null,
      production_month: machine.production_month || null,
      production_workshop: machine.production_workshop || undefined,
      production_queue_number: machine.production_queue_number || null,
      material_type: machine.material_type || 'undefined',
      desired_shipping_date: machine.desired_shipping_date || null,
      contract_id: documentFields.contract_id || null,
      specification_number: documentFields.specification_number || '',
      specification_date: documentFields.specification_date || null,
      items: defaultItems.map((i) => ({
        id: i.id, // сохраняем id для update
        product_id: i.product_id || null,
        drawing_number: i.drawing_number || '',
        product_name: i.product_name || '',
        product_name_uk: i.product_name_uk || null,
        product_name_en: i.product_name_en || null,
        product_uktzed: i.product_uktzed || null,
        product_drawing_number: i.product_drawing_number || null,
        weight: Number(i.weight),
        net_weight: i.net_weight ?? null,
        price: Number(i.price),
        quantity: Number(i.quantity),
        packing_type: i.packing_type || '',
        packing_places: i.packing_places ?? null,
        coating: i.coating || 'none',
        ral_number: i.ral_number || '',
        is_sample: false
      })),
      samples: defaultSamples.map((i) => ({
        id: i.id,
        product_id: i.product_id || null,
        drawing_number: i.drawing_number || '',
        product_name: i.product_name || '',
        product_name_uk: i.product_name_uk || null,
        product_name_en: i.product_name_en || null,
        product_uktzed: i.product_uktzed || null,
        product_drawing_number: i.product_drawing_number || null,
        weight: Number(i.weight),
        net_weight: i.net_weight ?? null,
        price: Number(i.price),
        quantity: Number(i.quantity),
        packing_type: i.packing_type || '',
        packing_places: i.packing_places ?? null,
        coating: i.coating || 'none',
        ral_number: i.ral_number || '',
        is_sample: true
      })),
      expenses: defaultRegularExpenses.map((e) => ({
        id: e.id,
        category: e.category,
        amount: Number(e.amount),
        comment: e.comment || ''
      }))
    },
  })

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control: form.control,
    name: "items"
  })

  const { fields: sampleFields, append: appendSample, remove: removeSample } = useFieldArray({
    control: form.control,
    name: "samples"
  })

  const { fields: expenseFields, append: appendExpense, remove: removeExpense } = useFieldArray({
    control: form.control,
    name: "expenses"
  })

  const watchedItems = useWatch({
    control: form.control,
    name: "items",
    defaultValue: []
  })

  const watchedSamples = useWatch({
    control: form.control,
    name: "samples",
    defaultValue: []
  })
  
  const watchedExpenses = useWatch({
    control: form.control,
    name: "expenses",
    defaultValue: []
  })

  const selectedFactoryId = useWatch({
    control: form.control,
    name: 'factory_id',
  })

  const selectedWorkshop = useWatch({
    control: form.control,
    name: 'production_workshop',
  })

  const selectedContractId = useWatch({
    control: form.control,
    name: 'contract_id',
  })

  const workshopOptions = useMemo(
    () => getFactoryWorkshopOptionsById(factories, selectedFactoryId && selectedFactoryId !== 'none' ? selectedFactoryId : null),
    [factories, selectedFactoryId],
  )
  const productionMonthOptions = useMemo(() => getProductionMonthOptions(), [])
  const visibleProductionMonthOptions = useMemo(() => {
    if (!machine.production_month || productionMonthOptions.some((option) => option.value === machine.production_month)) {
      return productionMonthOptions
    }

    return [
      {
        value: machine.production_month,
        label: formatProductionMonth(machine.production_month),
      },
      ...productionMonthOptions,
    ]
  }, [machine.production_month, productionMonthOptions])

  const queueLabel = productionQueueLabel(machine.production_workshop, machine.production_queue_number)

  useEffect(() => {
    if (!isOpen || products.length > 0) return
    let cancelled = false
    getProductOptions().then((result) => {
      if (!cancelled && result.data) setProducts(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, products.length])

  useEffect(() => {
    if (!selectedClientId) return
    if (form.getFieldState('specification_number').isDirty || form.getValues('specification_number')) return

    let cancelled = false
    getNextSpecificationNumber({
      client_id: selectedClientId,
      contract_id: selectedContractId || null,
    }).then((result) => {
      if (!cancelled && result.data) form.setValue('specification_number', result.data)
    })

    return () => {
      cancelled = true
    }
  }, [form, selectedClientId, selectedContractId])

  useEffect(() => {
    if (!selectedFactoryId || selectedFactoryId === 'none') {
      form.setValue('production_workshop', undefined)
      return
    }

    if (workshopOptions.length === 1) {
      form.setValue('production_workshop', workshopOptions[0].value)
      return
    }

    if (selectedWorkshop && !workshopOptions.some((option) => option.value === selectedWorkshop)) {
      form.setValue('production_workshop', undefined)
    }
  }, [form, selectedFactoryId, selectedWorkshop, workshopOptions])

  const totals = useMemo(() => {
    const allItems = [...(watchedItems || []), ...(watchedSamples || [])]
    const totalWeight = allItems.reduce((acc, item) => acc + ((Number(item.weight) || 0) * (Number(item.quantity) || 1)), 0) / 1000
    const itemsCost = (watchedItems || []).reduce((acc, item) => acc + ((Number(item.price) || 0) * (Number(item.quantity) || 1)), 0)
    const samplesCost = (watchedSamples || []).reduce((acc, item) => acc + ((Number(item.price) || 0) * (Number(item.quantity) || 1)), 0)
    const transportCost = Math.max(0, toFiniteNumber(transportAmount))
    const expensesCost = transportCost + (watchedExpenses || [])
      .filter((expense) => !isTransportExpenseCategory(expense.category))
      .reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0)
    return {
      totalWeight,
      itemsCost,
      samplesCost,
      expensesCost,
      totalCost: itemsCost + samplesCost + expensesCost
    }
  }, [transportAmount, watchedItems, watchedSamples, watchedExpenses])

  const uniqueRals = useMemo(() => {
    const rals = new Set<string>()
    ;[...(watchedItems || []), ...(watchedSamples || [])].forEach((i) => {
      if (i.coating === 'powder_coating' && i.ral_number) rals.add(i.ral_number)
    })
    return Array.from(rals)
  }, [watchedItems, watchedSamples])

  function rowPath(name: 'items' | 'samples', index: number, field: keyof MachineFormItem) {
    return `${name}.${index}.${field}` as FieldPath<MachineFormInput>
  }

  function setRowValue(name: 'items' | 'samples', index: number, field: keyof MachineFormItem, value: unknown) {
    form.setValue(rowPath(name, index, field), value as never)
  }

  function getRowValue(name: 'items' | 'samples', index: number, field: keyof MachineFormItem) {
    return form.getValues(rowPath(name, index, field)) as unknown
  }

  function applyProductToRow(name: 'items' | 'samples', index: number, productId: string) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    const quantity = toFiniteNumber(getRowValue(name, index, 'quantity'), 1)
    setRowValue(name, index, 'product_id', product.id)
    setRowValue(name, index, 'drawing_number', product.drawing_number)
    setRowValue(name, index, 'product_name', product.name_uk)
    setRowValue(name, index, 'product_name_uk', product.name_uk)
    setRowValue(name, index, 'product_name_en', product.name_en)
    setRowValue(name, index, 'product_uktzed', product.uktzed)
    setRowValue(name, index, 'product_drawing_number', product.drawing_number)
    setRowValue(name, index, 'product_characteristics', product.characteristics)
    setRowValue(name, index, 'weight', Number(product.unit_weight_kg))
    setRowValue(name, index, 'net_weight', Number((Number(product.unit_weight_kg) * quantity).toFixed(3)))
    setRowValue(name, index, 'price', Number(product.base_price_eur))
  }

  function updateQuantity(name: 'items' | 'samples', index: number, quantity: number | undefined) {
    const unitWeight = toFiniteNumber(getRowValue(name, index, 'weight'))
    setRowValue(name, index, 'net_weight', quantity ? Number((unitWeight * quantity).toFixed(3)) : undefined)
  }

  const handleRemoveItem = (index: number) => {
    const item = watchedItems?.[index]
    if (typeof item?.id === 'string') {
      const itemId = item.id
      setDeletedItemIds(prev => [...prev, itemId])
    }
    removeItem(index)
  }

  const handleRemoveExpense = (index: number) => {
    const exp = watchedExpenses?.[index]
    if (typeof exp?.id === 'string') {
      const expenseId = exp.id
      setDeletedExpenseIds(prev => [...prev, expenseId])
    }
    removeExpense(index)
  }

  const handleRemoveSample = (index: number) => {
    const item = watchedSamples?.[index]
    if (typeof item?.id === 'string') {
      setDeletedItemIds(prev => [...prev, item.id as string])
    }
    removeSample(index)
  }

  async function onSubmit(data: MachineFormInput) {
    setIsSubmitting(true)
    try {
      const transportCost = Math.max(0, toFiniteNumber(transportAmount))
      const expenseIdsToDelete = new Set<string>([
        ...deletedExpenseIds,
        ...duplicateTransportExpenseIds,
        ...(data.expenses || [])
          .filter((expense) => isTransportExpenseCategory(expense.category))
          .map((expense) => expense.id)
          .filter((id): id is string => typeof id === 'string'),
      ])
      const regularExpenses = (data.expenses || []).filter((expense) => !isTransportExpenseCategory(expense.category))

      if (transportCost <= 0 && defaultTransportExpense?.id) {
        expenseIdsToDelete.add(defaultTransportExpense.id)
      }

      const payload = {
        ...data,
        items: [
          ...(data.items || []).map((item) => ({ ...item, is_sample: false })),
          ...(data.samples || []).map((item) => ({ ...item, is_sample: true })),
        ],
        samples: [],
        expenses: [
          ...(transportCost > 0
            ? [{
                id: defaultTransportExpense?.id,
                category: TRANSPORT_EXPENSE_CATEGORY,
                amount: transportCost,
                comment: defaultTransportExpense?.comment || '',
              }]
            : []),
          ...regularExpenses,
        ],
        deletedItemIds,
        deletedExpenseIds: Array.from(expenseIdsToDelete),
      }
      
      const res = await updateMachine(machine.id, payload)
      if (!res.success) throw new Error(res.error || 'Не удалось обновить машину')
      
      toast.success('Машина успешно обновлена')
      onClose()
    } catch (e: unknown) {
      toast.error(getErrorMessage(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl bg-white border-[#E8ECF0] text-[#1B3A6B] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактирование {machine.name}</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Внесите изменения в товары и дополнительные расходы машины.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
            
            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Название машины</FormLabel>
                    <FormControl>
                      <Input {...field} className="bg-[#F8F9FA] border-[#E8ECF0] focus-visible:ring-blue-500" />
                    </FormControl>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="production_month"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Месяц производства</FormLabel>
                    <Select value={field.value || 'none'} onValueChange={(value) => field.onChange(value === 'none' ? null : value)}>
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
                          <SelectValue placeholder="Без месяца" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Без месяца</SelectItem>
                        {visibleProductionMonthOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="factory_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Завод</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
                          <SelectValue placeholder="Без завода" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Без завода</SelectItem>
                        {factories.map(f => (
                          <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="production_workshop"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Цех</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(Number(value))}
                      value={field.value ? String(field.value) : ''}
                      disabled={!selectedFactoryId || selectedFactoryId === 'none'}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
                          <SelectValue placeholder={selectedFactoryId && selectedFactoryId !== 'none' ? 'Выберите цех' : 'Сначала выберите завод'} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {workshopOptions.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <div className="rounded-md border border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2">
                <div className="text-sm font-medium text-[#374151]">Очередь</div>
                <div className="mt-1 text-sm text-[#1B3A6B]">{queueLabel}</div>
                <div className="mt-1 text-xs text-[#6B7280]">При переносе в другой месяц, завод или цех номер будет назначен автоматически.</div>
              </div>

              {false && isDirector && (
                <FormField
                  control={form.control}
                  name="factory_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#374151]">Завод</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "none"}>
                        <FormControl>
                          <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
                            <SelectValue placeholder="Без завода" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Без завода</SelectItem>
                          {factories.map(f => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-[#DC2626]" />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="material_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Тип материала</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || 'undefined'}>
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0]">
                          <SelectValue placeholder="Выберите материал" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="undefined">Не определён</SelectItem>
                        <SelectItem value="standard">Стандартный (Черный металл)</SelectItem>
                        <SelectItem value="non_standard">Нестандартный (Нержавейка)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4">
              <h3 className="text-lg font-semibold text-[#1B3A6B]">Данные спецификации</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="contract_id"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-[#374151]">Контракт</FormLabel>
                      <ContractSelectField
                        clientId={selectedClientId}
                        value={field.value}
                        onChange={field.onChange}
                      />
                      {!selectedClientId && <p className="text-xs text-[#6B7280]">Сначала выберите клиента</p>}
                      <FormMessage className="text-[#DC2626]" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="specification_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#374151]">Номер спецификации</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ''} className="bg-white border-[#E8ECF0] text-[#1B3A6B]" />
                      </FormControl>
                      <FormMessage className="text-[#DC2626]" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="specification_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#374151]">Дата спецификации</FormLabel>
                      <FormControl>
                        <DatePicker
                          value={field.value ? new Date(field.value) : undefined}
                          onChange={(date) => field.onChange(dateOnly(date))}
                          placeholder="Выберите дату"
                          displayFormat="dd.MM.yyyy"
                        />
                      </FormControl>
                      <FormMessage className="text-[#DC2626]" />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <FormField
              control={form.control}
              name="desired_shipping_date"
              render={({ field }) => (
                <FormItem className="max-w-xs">
                  <FormLabel className="text-[#374151]">Желаемая дата отгрузки</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.value ? new Date(field.value) : undefined}
                      onChange={(date) => field.onChange(date ? date.toISOString().split('T')[0] : null)}
                      placeholder="Выберите дату"
                      displayFormat="dd.MM.yyyy"
                    />
                  </FormControl>
                  <p className="text-xs text-[#6B7280]">До какой даты клиент хочет получить машину</p>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            {/* ТОВАРЫ */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[#1B3A6B] border-b pb-2">Товары</h3>
              {itemFields.map((field, index) => {
                const coatingValue = watchedItems?.[index]?.coating || 'none'
                return (
                  <div key={field.id} className="p-4 bg-[#F8F9FA] border border-[#E8ECF0] rounded-md relative shadow-sm">
                    <div className="absolute top-2 right-2">
                      <Button 
                        type="button" variant="ghost" size="icon" 
                        onClick={() => handleRemoveItem(index)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 pr-10">
                      <FormField
                        control={form.control}
                        name={`items.${index}.product_id`}
                        render={({ field }) => {
                          const locked = Boolean(watchedItems?.[index]?.id && watchedItems?.[index]?.product_id)
                          return (
                            <FormItem className="md:col-span-2 lg:col-span-4">
                              <FormLabel className="text-xs text-[#374151]">Товар из базы продукции</FormLabel>
                              <Select value={field.value || ''} onValueChange={(value) => applyProductToRow('items', index, value || '')} disabled={locked}>
                                <FormControl>
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue placeholder="Выберите активный продукт" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {products.map((product) => (
                                    <SelectItem key={product.id} value={product.id}>
                                      {product.name_uk} · {product.uktzed} · {product.drawing_number}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {locked && <p className="text-xs text-[#6B7280]">Продукт в существующей строке заблокирован. Для замены удалите строку и добавьте новую.</p>}
                              <FormMessage className="text-[10px]" />
                            </FormItem>
                          )
                        }}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.drawing_number`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Чертёж *</FormLabel>
                            <FormControl><Input {...field} disabled={Boolean(watchedItems?.[index]?.product_id)} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.product_name`}
                        render={({ field }) => (
                          <FormItem className="lg:col-span-2">
                            <FormLabel className="text-xs text-[#374151]">Наименование товара *</FormLabel>
                            <FormControl><Input {...field} disabled={Boolean(watchedItems?.[index]?.product_id)} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.coating`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Покрытие *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''}>
                              <FormControl>
                                <SelectTrigger className="h-8 text-sm bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {Object.entries(COATINGS).map(([val, {label}]) => (
                                  <SelectItem key={val} value={val}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.weight`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Вес ед. (кг) *</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} disabled={Boolean(watchedItems?.[index]?.product_id)} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Кол-во *</FormLabel>
                            <FormControl><Input type="number" {...field} onChange={e => {
                              const quantity = parseIntegerInput(e.target.value)
                              field.onChange(quantity)
                              updateQuantity('items', index, quantity)
                            }} className="h-8 text-sm" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.net_weight`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Нетто вес (кг)</FormLabel>
                            <FormControl><Input type="number" min={0} step="0.001" {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseNumberInput(e.target.value))} className="h-8 text-sm bg-white" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.price`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Цена ед. (€) *</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} disabled={Boolean(watchedItems?.[index]?.product_id)} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.packing_type`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Тип упаковки</FormLabel>
                            <FormControl><Input {...field} value={field.value || ''} placeholder="Pack/пачка" className="h-8 text-sm bg-white" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.packing_places`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-[#374151]">Кол-во мест</FormLabel>
                            <FormControl><Input type="number" min={0} {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseIntegerInput(e.target.value))} className="h-8 text-sm bg-white" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      {coatingValue === 'powder_coating' && (
                        <FormField
                          control={form.control}
                          name={`items.${index}.ral_number`}
                          render={({ field }) => (
                            <FormItem className="animate-in fade-in">
                              <FormLabel className="text-xs text-orange-500">RAL</FormLabel>
                              <FormControl>
                                <Input list="ral-options-edit" {...field} className="h-8 text-sm border-orange-200" />
                              </FormControl>
                              <FormMessage className="text-[10px]" />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                  </div>
                )
              })}

              <datalist id="ral-options-edit">
                {uniqueRals.map(r => <option key={r} value={r} />)}
              </datalist>

              <Button 
                type="button" variant="outline" size="sm" className="text-[#1B3A6B]"
                onClick={() => appendItem({ product_id: null, drawing_number: '', product_name: '', weight: 0, net_weight: 0, price: 0, quantity: 1, packing_type: '', packing_places: undefined, coating: 'none', ral_number: '' })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить товар
              </Button>
            </div>

            {/* SAMPLES */}
            <div className="space-y-4 pt-4 border-t border-[#E8ECF0]">
              <div>
                <h3 className="text-lg font-semibold text-[#1B3A6B] border-b pb-2">Образцы</h3>
                <p className="mt-2 text-sm text-[#6B7280]">Образцы учитываются в общем весе, стоимости и требованиях к покрытию.</p>
              </div>
              {sampleFields.map((field, index) => {
                const coatingValue = watchedSamples?.[index]?.coating || 'none'
                return (
                  <div key={field.id} className="p-4 bg-amber-50/60 border border-amber-200 rounded-md relative shadow-sm">
                    <div className="absolute top-2 right-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveSample(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 pr-10">
                      <FormField
                        control={form.control}
                        name={`samples.${index}.product_id`}
                        render={({ field }) => {
                          const locked = Boolean(watchedSamples?.[index]?.id && watchedSamples?.[index]?.product_id)
                          return (
                            <FormItem className="md:col-span-2 lg:col-span-4">
                              <FormLabel className="text-xs text-[#374151]">Товар из базы продукции</FormLabel>
                              <Select value={field.value || ''} onValueChange={(value) => applyProductToRow('samples', index, value || '')} disabled={locked}>
                                <FormControl>
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue placeholder="Выберите активный продукт" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {products.map((product) => (
                                    <SelectItem key={product.id} value={product.id}>
                                      {product.name_uk} · {product.uktzed} · {product.drawing_number}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {locked && <p className="text-xs text-[#6B7280]">Продукт в существующей строке заблокирован.</p>}
                              <FormMessage className="text-[10px]" />
                            </FormItem>
                          )
                        }}
                      />
                      <FormField control={form.control} name={`samples.${index}.drawing_number`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Чертёж *</FormLabel>
                          <FormControl><Input {...field} disabled={Boolean(watchedSamples?.[index]?.product_id)} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px] text-[#DC2626]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.product_name`} render={({ field }) => (
                        <FormItem className="lg:col-span-2">
                          <FormLabel className="text-xs text-[#374151]">Товар *</FormLabel>
                          <FormControl><Input {...field} disabled={Boolean(watchedSamples?.[index]?.product_id)} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px] text-[#DC2626]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.coating`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Покрытие *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ''}>
                            <FormControl><SelectTrigger className="h-8 text-sm bg-white"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              {Object.entries(COATINGS).map(([val, {label}]) => (
                                <SelectItem key={val} value={val}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.weight`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Вес ед. (кг) *</FormLabel>
                          <FormControl><Input type="number" step="0.01" {...field} disabled={Boolean(watchedSamples?.[index]?.product_id)} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.quantity`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Кол-во *</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => {
                            const quantity = parseIntegerInput(e.target.value)
                            field.onChange(quantity)
                            updateQuantity('samples', index, quantity)
                          }} className="h-8 text-sm" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.net_weight`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Нетто вес (кг)</FormLabel>
                          <FormControl><Input type="number" min={0} step="0.001" {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseNumberInput(e.target.value))} className="h-8 text-sm bg-white" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.price`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Цена ед. (€) *</FormLabel>
                          <FormControl><Input type="number" step="0.01" {...field} disabled={Boolean(watchedSamples?.[index]?.product_id)} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.packing_type`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Тип упаковки</FormLabel>
                          <FormControl><Input {...field} value={field.value || ''} placeholder="Pack/пачка" className="h-8 text-sm bg-white" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.packing_places`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Кол-во мест</FormLabel>
                          <FormControl><Input type="number" min={0} {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseIntegerInput(e.target.value))} className="h-8 text-sm bg-white" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      {coatingValue === 'powder_coating' && (
                        <FormField control={form.control} name={`samples.${index}.ral_number`} render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs text-orange-500">RAL</FormLabel>
                            <FormControl><Input list="ral-options-edit" {...field} className="h-8 text-sm border-orange-200" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )} />
                      )}
                    </div>
                  </div>
                )
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[#1B3A6B]"
                onClick={() => appendSample({ product_id: null, drawing_number: '', product_name: '', weight: 0, net_weight: 0, price: 0, quantity: 1, packing_type: '', packing_places: undefined, coating: 'none', ral_number: '', is_sample: true })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить образец
              </Button>
            </div>

            {/* РАСХОДЫ */}
            <div className="space-y-4 pt-4 border-t border-[#E8ECF0]">
              <h3 className="text-lg font-semibold text-[#1B3A6B] border-b pb-2">Дополнительные расходы</h3>
              <div className="flex gap-4 items-start rounded-md border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                <div className="flex-1">
                  <FormLabel className="text-xs text-[#374151]">Категория</FormLabel>
                  <Input value={TRANSPORT_EXPENSE_CATEGORY} disabled className="mt-1 h-9 bg-white font-medium text-[#1B3A6B]" />
                </div>
                <div className="w-32">
                  <FormLabel className="text-xs text-[#374151]">Сумма (€)</FormLabel>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={toNumberInputValue(transportAmount)}
                    onChange={(event) => setTransportAmount(parseNumberInput(event.target.value))}
                    placeholder="0"
                    className="mt-1 h-9 bg-white"
                  />
                </div>
                <div className="flex-1">
                  <FormLabel className="text-xs text-[#374151]">Инвойс</FormLabel>
                  <Input value="Foreightcost/Транспорт" disabled className="mt-1 h-9 bg-white text-[#6B7280]" />
                </div>
                <div className="w-10" />
              </div>
              {expenseFields.map((field, index) => (
                <div key={field.id} className="flex gap-4 items-start">
                  <FormField
                    control={form.control}
                    name={`expenses.${index}.category`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input {...field} placeholder="Категория" className="h-9" /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`expenses.${index}.amount`}
                    render={({ field }) => (
                      <FormItem className="w-32">
                        <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} placeholder="Сумма" className="h-9" /></FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`expenses.${index}.comment`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl><Input {...field} placeholder="Комментарий" className="h-9" /></FormControl>
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="button" variant="ghost" size="icon"
                    onClick={() => handleRemoveExpense(index)}
                    className="text-red-500 mt-0.5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button 
                type="button" variant="outline" size="sm" className="text-[#1B3A6B]"
                onClick={() => appendExpense({ category: '', amount: 0, comment: '' })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить расход
              </Button>
            </div>

            {/* ИТОГОВАЯ ПАНЕЛЬ */}
            <div className="bg-[#F8F9FA] p-4 rounded-lg flex flex-wrap gap-6 items-center justify-between border border-[#E8ECF0]">
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-gray-500">Общий вес</p>
                  <p className="text-lg font-semibold text-[#1B3A6B]">{totals.totalWeight.toFixed(2)} т</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Товары</p>
                  <p className="text-lg font-semibold text-[#1B3A6B]">€{totals.itemsCost.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Образцы</p>
                  <p className="text-lg font-semibold text-[#1B3A6B]">€{totals.samplesCost.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Расходы</p>
                  <p className="text-lg font-semibold text-[#1B3A6B]">€{totals.expensesCost.toLocaleString()}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-[#16A34A] font-medium">ИТОГО</p>
                <p className="text-2xl font-bold text-[#16A34A]">€{totals.totalCost.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex w-full sm:justify-end gap-3 pt-4 border-t border-[#E8ECF0]">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Сохранить изменения
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

