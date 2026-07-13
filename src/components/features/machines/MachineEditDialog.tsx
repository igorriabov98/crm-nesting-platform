'use client'

import { useEffect, useState, useMemo } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useFieldArray, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { updateMachineSchema, type UpdateMachineInput } from '@/lib/types/schemas'
import { updateMachine } from '@/app/(protected)/sales-plan/actions'
import { getOrderClientProductPrices } from '@/lib/actions/client-product-prices'
import { getNextSpecificationNumber } from '@/lib/actions/contracts'
import { getProductOptions, getProductProjectSampleOptions, type ProductOption, type ProductProjectSampleOption } from '@/lib/actions/products'
import { COATINGS } from '@/lib/constants/coatings'
import { getFactoryWorkshopOptionsById, productionQueueLabel } from '@/lib/constants/factory-workshops'
import { formatProductionMonth, getProductionMonthOptions } from '@/lib/utils/production-months'
import { ContractSelectField } from '@/components/features/contracts/ContractSelectField'
import type { CoatingType, FactorySummary, MachineDetails, MachineExpense, MachineItem, MachineListItem } from '@/lib/types'
import { TRANSPORT_EXPENSE_CATEGORY, isTransportExpenseCategory } from '@/lib/utils/transport-expense'
import { ProductOptionCombobox } from '@/components/features/machines/ProductOptionCombobox'
import { ProductVersionSelector } from '@/components/features/machines/ProductVersionSelector'
import type { OrderClientPriceLookup } from '@/lib/client-prices/types'
import type { ProductVersionWithFiles } from '@/lib/actions/product-versions'

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

export type MachineEditDialogMode = 'full' | 'items' | 'expenses'

export interface MachineEditDialogProps {
  machine: EditableMachine
  isOpen: boolean
  onClose: () => void
  isDirector?: boolean
  factories?: FactorySummary[]
  mode?: MachineEditDialogMode
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

export function MachineEditDialog({ machine, isOpen, onClose, isDirector, factories = [], mode = 'full' }: MachineEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletedItemIds, setDeletedItemIds] = useState<string[]>([])
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<string[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [projectSamples, setProjectSamples] = useState<ProductProjectSampleOption[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [clientPriceLookup, setClientPriceLookup] = useState<OrderClientPriceLookup>({})
  const [isLoadingClientPrices, setIsLoadingClientPrices] = useState(false)

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
  const availableProjectSamples = useMemo(
    () => projectSamples.filter((sample) => sample.client_id === selectedClientId),
    [projectSamples, selectedClientId],
  )

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
        product_project_id: i.product_project_id || null,
        product_project_version_id: i.product_project_version_id || null,
        drawing_number: i.drawing_number || '',
        product_name: i.product_name || '',
        product_name_uk: i.product_name_uk || null,
        product_name_en: i.product_name_en || null,
        product_uktzed: i.product_uktzed || null,
        product_drawing_number: i.product_drawing_number || null,
        weight: Number(i.weight),
        price: Number(i.price),
        quantity: Number(i.quantity),
        coating: i.coating || 'none',
        ral_number: i.ral_number || '',
        is_sample: false
      })),
      samples: defaultSamples.map((i) => ({
        id: i.id,
        product_id: i.product_id || null,
        product_project_id: i.product_project_id || null,
        product_project_version_id: i.product_project_version_id || null,
        drawing_number: i.drawing_number || '',
        product_name: i.product_name || '',
        product_name_uk: i.product_name_uk || null,
        product_name_en: i.product_name_en || null,
        product_uktzed: i.product_uktzed || null,
        product_drawing_number: i.product_drawing_number || null,
        weight: Number(i.weight),
        price: Number(i.price),
        quantity: Number(i.quantity),
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
    if (!isOpen || mode === 'expenses' || catalogLoaded) return
    let cancelled = false
    Promise.all([getProductOptions(), getProductProjectSampleOptions()]).then(([productResult, sampleResult]) => {
      if (cancelled) return
      if (productResult.data) setProducts(productResult.data)
      if (sampleResult.data) setProjectSamples(sampleResult.data)
      setCatalogLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [catalogLoaded, isOpen, mode])

  useEffect(() => {
    if (!isOpen || mode === 'expenses' || !selectedClientId || products.length === 0) {
      setClientPriceLookup({})
      return
    }

    let cancelled = false
    setIsLoadingClientPrices(true)
    getOrderClientProductPrices(selectedClientId, products.map((product) => product.id))
      .then((result) => {
        if (cancelled) return
        setClientPriceLookup(result.data || {})
        if (result.error) toast.error(result.error)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingClientPrices(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, mode, products, selectedClientId])

  useEffect(() => {
    const items = form.getValues('items') || []
    items.forEach((item, index) => {
      if (item.id || !item.product_id) return
      const coating = (item.coating || 'none') as CoatingType
      const price = clientPriceLookup[item.product_id]?.[coating]
      setRowValue('items', index, 'price', typeof price === 'number' ? price : 0)
    })
  }, [clientPriceLookup, form])

  useEffect(() => {
    if (mode !== 'full' || !selectedClientId) return
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
  }, [form, mode, selectedClientId, selectedContractId])

  useEffect(() => {
    if (mode !== 'full') return
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
  }, [form, mode, selectedFactoryId, selectedWorkshop, workshopOptions])

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

  function getClientPrice(productId: string | null | undefined, coating: CoatingType | null | undefined) {
    if (!productId || !coating) return null
    const price = clientPriceLookup[productId]?.[coating]
    return typeof price === 'number' ? price : null
  }

  function hasClientPrice(productId: string | null | undefined, coating: CoatingType | null | undefined) {
    return getClientPrice(productId, coating) !== null
  }

  function applyClientPriceToItem(index: number, productId: string | null | undefined, coating: CoatingType, resetMissing = true) {
    if (!productId) return
    const price = getClientPrice(productId, coating)
    if (price !== null) {
      setRowValue('items', index, 'price', price)
      return
    }
    if (resetMissing) setRowValue('items', index, 'price', 0)
  }

  function applyProductToRow(name: 'items' | 'samples', index: number, productId: string) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    const currentCoating = (form.getValues(rowPath(name, index, 'coating')) || 'none') as CoatingType
    const clientPrice = name === 'items' ? getClientPrice(product.id, currentCoating) : null
    setRowValue(name, index, 'product_id', product.id)
    setRowValue(name, index, 'product_version_id', name === 'items' ? product.current_product_version_id || null : null)
    setRowValue(name, index, 'product_project_id', null)
    setRowValue(name, index, 'product_project_version_id', null)
    setRowValue(name, index, 'drawing_number', product.drawing_number)
    setRowValue(name, index, 'product_name', product.name_uk)
    setRowValue(name, index, 'product_name_uk', product.name_uk)
    setRowValue(name, index, 'product_name_en', product.name_en)
    setRowValue(name, index, 'product_uktzed', product.uktzed)
    setRowValue(name, index, 'product_drawing_number', product.drawing_number)
    setRowValue(name, index, 'product_characteristics', product.characteristics)
    setRowValue(name, index, 'weight', Number(product.unit_weight_kg))
    setRowValue(name, index, 'price', clientPrice ?? (name === 'items' ? 0 : Number(product.base_price_eur)))
  }

  function applyProductVersionToRow(index: number, versionId: string, version?: ProductVersionWithFiles) {
    setRowValue('items', index, 'product_version_id', versionId)
    if (!version) return
    setRowValue('items', index, 'drawing_number', version.drawing_number)
    setRowValue('items', index, 'product_drawing_number', version.drawing_number)
  }

  function applyProjectSampleToRow(index: number, projectId: string) {
    const sample = availableProjectSamples.find((item) => item.project_id === projectId)
    if (!sample) return
    setRowValue('samples', index, 'product_id', null)
    setRowValue('samples', index, 'product_project_id', sample.project_id)
    setRowValue('samples', index, 'product_project_version_id', sample.version_id)
    setRowValue('samples', index, 'drawing_number', sample.drawing_number)
    setRowValue('samples', index, 'product_name', sample.name_uk)
    setRowValue('samples', index, 'product_name_uk', sample.name_uk)
    setRowValue('samples', index, 'product_name_en', sample.name_en)
    setRowValue('samples', index, 'product_uktzed', sample.uktzed)
    setRowValue('samples', index, 'product_drawing_number', sample.drawing_number)
    setRowValue('samples', index, 'product_characteristics', sample.characteristics)
    setRowValue('samples', index, 'weight', Number(sample.unit_weight_kg))
    setRowValue('samples', index, 'price', Number(sample.base_price_eur))
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

      const items = [
        ...(data.items || []).map((item) => ({ ...item, is_sample: false })),
        ...(data.samples || []).map((item) => ({ ...item, is_sample: true })),
      ]
      const expenses = [
          ...(transportCost > 0
            ? [{
                id: defaultTransportExpense?.id,
                category: TRANSPORT_EXPENSE_CATEGORY,
                amount: transportCost,
                comment: defaultTransportExpense?.comment || '',
              }]
            : []),
          ...regularExpenses,
      ]
      const payload = mode === 'items'
        ? { items, deletedItemIds }
        : mode === 'expenses'
          ? { expenses, deletedExpenseIds: Array.from(expenseIdsToDelete) }
          : {
              ...data,
              items,
              samples: [],
              expenses,
              deletedItemIds,
              deletedExpenseIds: Array.from(expenseIdsToDelete),
            }
      
      const res = await updateMachine(machine.id, payload)
      if (!res.success) throw new Error(res.error || 'Не удалось обновить машину')
      
      toast.success(
        mode === 'items'
          ? 'Товары машины обновлены'
          : mode === 'expenses'
            ? 'Расходы машины обновлены'
            : 'Машина успешно обновлена',
      )
      onClose()
    } catch (e: unknown) {
      toast.error(getErrorMessage(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`!block !w-[calc(100vw-1rem)] ${mode === 'expenses' ? '!max-w-3xl' : '!max-w-6xl'} !p-0 max-h-[92vh] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900`}>
        <DialogHeader className="sticky top-0 z-30 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <DialogTitle className="text-xl text-slate-950">
            {mode === 'items'
              ? `Товары машины ${machine.name}`
              : mode === 'expenses'
                ? `Расходы машины ${machine.name}`
                : `Редактирование ${machine.name}`}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {mode === 'items'
              ? 'Добавляйте и редактируйте только товары и образцы этой машины.'
              : mode === 'expenses'
                ? 'Добавляйте и редактируйте только дополнительные расходы этой машины.'
                : 'Измените основные данные, товары и дополнительные расходы машины.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 px-4 pb-4 sm:px-6 sm:pb-6">
            
            {mode === 'full' && (
              <>
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3 sm:p-5">
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
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Без месяца">
                            {() => field.value
                              ? visibleProductionMonthOptions.find((option) => option.value === field.value)?.label || 'Без месяца'
                              : 'Без месяца'}
                          </SelectValue>
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
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Без завода">
                            {() => factories.find((factory) => factory.id === field.value)?.name || 'Без завода'}
                          </SelectValue>
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
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder={selectedFactoryId && selectedFactoryId !== 'none' ? 'Выберите цех' : 'Сначала выберите завод'}>
                            {() => workshopOptions.find((option) => option.value === field.value)?.label
                              || (selectedFactoryId && selectedFactoryId !== 'none' ? 'Выберите цех' : 'Сначала выберите завод')}
                          </SelectValue>
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
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Выберите материал">
                            {() => field.value === 'standard'
                              ? 'Стандартный (чёрный металл)'
                              : field.value === 'non_standard'
                                ? 'Нестандартный (нержавейка)'
                                : 'Не определён'}
                          </SelectValue>
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

            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-lg font-semibold text-slate-950">Данные спецификации</h3>
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
              </>
            )}

            {/* ТОВАРЫ */}
            {mode !== 'expenses' && (
              <>
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-lg font-semibold text-[#1B3A6B] border-b pb-2">Товары</h3>
              {itemFields.map((field, index) => {
                const coatingValue = watchedItems?.[index]?.coating || 'none'
                const productId = watchedItems?.[index]?.product_id || null
                const selectedProduct = productId ? products.find((product) => product.id === productId) || null : null
                const productLocked = Boolean(watchedItems?.[index]?.id && watchedItems?.[index]?.product_id)
                const showVersionSelector = Boolean(!productLocked && selectedProduct && (selectedProduct.product_version_count || 0) > 1)
                const priceLocked = hasClientPrice(productId, coatingValue)
                const totalWeight = toFiniteNumber(watchedItems?.[index]?.weight) * toFiniteNumber(watchedItems?.[index]?.quantity)
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
                          return (
                            <FormItem className="md:col-span-2 lg:col-span-4">
                              <FormLabel className="text-xs text-[#374151]">Товар из базы продукции</FormLabel>
                              <FormControl>
                                <ProductOptionCombobox products={products} value={field.value} disabled={productLocked} onChange={(value) => applyProductToRow('items', index, value)} />
                              </FormControl>
                              {selectedProduct && showVersionSelector && (
                                <FormField
                                  control={form.control}
                                  name={`items.${index}.product_version_id`}
                                  render={({ field: versionField }) => (
                                    <div className="mt-2">
                                      <ProductVersionSelector
                                        product={selectedProduct}
                                        value={versionField.value}
                                        onChange={(versionId, version) => {
                                          versionField.onChange(versionId)
                                          applyProductVersionToRow(index, versionId, version)
                                        }}
                                      />
                                    </div>
                                  )}
                                />
                              )}
                              {productLocked && <p className="text-xs text-[#6B7280]">Продукт в существующей строке заблокирован. Для замены удалите строку и добавьте новую.</p>}
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
                            <Select
                              onValueChange={(value) => {
                                const coating = value as CoatingType
                                field.onChange(coating)
                                if (coating !== 'powder_coating') {
                                  setRowValue('items', index, 'ral_number', '')
                                }
                                applyClientPriceToItem(index, productId, coating)
                              }}
                              value={field.value || ''}
                            >
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
                            <FormControl><Input type="number" step="0.01" {...field} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
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
                            <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseIntegerInput(e.target.value))} className="h-8 text-sm" /></FormControl>
                            <FormMessage className="text-[10px]" />
                          </FormItem>
                        )}
                      />
                      <FormItem>
                        <FormLabel className="text-xs text-[#374151]">Общий вес (кг)</FormLabel>
                        <FormControl>
                          <Input value={Number(totalWeight.toFixed(3))} disabled className="h-8 text-sm bg-white text-[#6B7280]" />
                        </FormControl>
                      </FormItem>
                      <FormField
                        control={form.control}
                        name={`items.${index}.price`}
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center gap-2">
                              <FormLabel className="text-xs text-[#374151]">Цена ед. (€) *</FormLabel>
                              {productId && (
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${priceLocked ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                  {isLoadingClientPrices ? 'Проверка цены' : priceLocked ? 'Цена клиента' : 'Новая цена'}
                                </span>
                              )}
                            </div>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                {...field}
                                disabled={priceLocked}
                                onChange={(event) => field.onChange(parseNumberInput(event.target.value))}
                                className={`h-8 text-sm ${priceLocked ? 'bg-slate-50 text-[#6B7280]' : 'bg-white text-slate-950'}`}
                              />
                            </FormControl>
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
                onClick={() => appendItem({ product_id: null, product_version_id: null, drawing_number: '', product_name: '', weight: 0, price: 0, quantity: 1, coating: 'none', ral_number: '' })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить товар
              </Button>
            </div>

            {/* SAMPLES */}
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div>
                <h3 className="text-lg font-semibold text-[#1B3A6B] border-b pb-2">Образцы</h3>
                <p className="mt-2 text-sm text-[#6B7280]">Образцы учитываются в общем весе, стоимости и требованиях к покрытию.</p>
              </div>
              {sampleFields.map((field, index) => {
                const coatingValue = watchedSamples?.[index]?.coating || 'none'
                const totalWeight = toFiniteNumber(watchedSamples?.[index]?.weight) * toFiniteNumber(watchedSamples?.[index]?.quantity)
                return (
                  <div key={field.id} className="p-4 bg-amber-50/60 border border-amber-200 rounded-md relative shadow-sm">
                    <div className="absolute top-2 right-2">
                      <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveSample(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 pr-10">
                      {watchedSamples?.[index]?.product_id && !watchedSamples?.[index]?.product_project_id ? (
                        <FormField
                          control={form.control}
                          name={`samples.${index}.product_id`}
                          render={({ field }) => (
                            <FormItem className="md:col-span-2 lg:col-span-4">
                              <FormLabel className="text-xs text-[#374151]">Товар из базы продукции</FormLabel>
                              <FormControl>
                                <ProductOptionCombobox products={products} value={field.value} disabled onChange={(value) => applyProductToRow('samples', index, value)} />
                              </FormControl>
                              <p className="text-xs text-[#6B7280]">Старый образец привязан к товару и заблокирован.</p>
                              <FormMessage className="text-[10px]" />
                            </FormItem>
                          )}
                        />
                      ) : (
                        <FormField
                          control={form.control}
                          name={`samples.${index}.product_project_id`}
                          render={({ field }) => {
                            const locked = Boolean(watchedSamples?.[index]?.id && watchedSamples?.[index]?.product_project_id)
                            return (
                              <FormItem className="md:col-span-2 lg:col-span-4">
                                <FormLabel className="text-xs text-[#374151]">Проект изделия для образца</FormLabel>
                                <FormControl>
                                  <ProductOptionCombobox
                                    products={availableProjectSamples}
                                    value={field.value}
                                    disabled={locked || !selectedClientId}
                                    placeholder="Выберите утвержденный проект"
                                    onChange={(value) => applyProjectSampleToRow(index, value)}
                                  />
                                </FormControl>
                                {!selectedClientId && <p className="text-xs text-[#6B7280]">Сначала выберите клиента.</p>}
                                {locked && <p className="text-xs text-[#6B7280]">Проект в существующей строке заблокирован.</p>}
                                <FormMessage className="text-[10px]" />
                              </FormItem>
                            )
                          }}
                        />
                      )}
                      <FormField control={form.control} name={`samples.${index}.drawing_number`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Чертёж *</FormLabel>
                          <FormControl><Input {...field} disabled={Boolean(watchedSamples?.[index]?.product_id || watchedSamples?.[index]?.product_project_id)} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px] text-[#DC2626]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.product_name`} render={({ field }) => (
                        <FormItem className="lg:col-span-2">
                          <FormLabel className="text-xs text-[#374151]">Товар *</FormLabel>
                          <FormControl><Input {...field} disabled={Boolean(watchedSamples?.[index]?.product_id || watchedSamples?.[index]?.product_project_id)} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px] text-[#DC2626]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.coating`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Покрытие *</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              const coating = value as CoatingType
                              field.onChange(coating)
                              if (coating !== 'powder_coating') {
                                setRowValue('samples', index, 'ral_number', '')
                              }
                            }}
                            value={field.value || ''}
                          >
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
                          <FormControl><Input type="number" step="0.01" {...field} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name={`samples.${index}.quantity`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Кол-во *</FormLabel>
                          <FormControl><Input type="number" {...field} onChange={e => field.onChange(parseIntegerInput(e.target.value))} className="h-8 text-sm" /></FormControl>
                          <FormMessage className="text-[10px]" />
                        </FormItem>
                      )} />
                      <FormItem>
                        <FormLabel className="text-xs text-[#374151]">Общий вес (кг)</FormLabel>
                        <FormControl>
                          <Input value={Number(totalWeight.toFixed(3))} disabled className="h-8 text-sm bg-white text-[#6B7280]" />
                        </FormControl>
                      </FormItem>
                      <FormField control={form.control} name={`samples.${index}.price`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs text-[#374151]">Цена ед. (€) *</FormLabel>
                          <FormControl><Input type="number" step="0.01" {...field} disabled={Boolean(watchedSamples?.[index]?.product_id || watchedSamples?.[index]?.product_project_id)} onChange={e => field.onChange(parseFloat(e.target.value))} className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
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
                onClick={() => appendSample({ product_id: null, product_project_id: null, product_project_version_id: null, drawing_number: '', product_name: '', weight: 0, price: 0, quantity: 1, coating: 'none', ral_number: '', is_sample: true })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить образец
              </Button>
            </div>
              </>
            )}

            {/* РАСХОДЫ */}
            {mode !== 'items' && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
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
            )}

            {/* ИТОГОВАЯ ПАНЕЛЬ */}
            <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-blue-900/10 bg-gradient-to-br from-blue-950 to-blue-800 p-4 text-white shadow-lg">
              <div className="flex gap-6">
                {mode !== 'expenses' && <div>
                  <p className="text-xs text-blue-200">Общий вес</p>
                  <p className="text-lg font-semibold">{totals.totalWeight.toFixed(2)} т</p>
                </div>}
                {mode !== 'expenses' && <div>
                  <p className="text-xs text-blue-200">Товары</p>
                  <p className="text-lg font-semibold">€{totals.itemsCost.toLocaleString()}</p>
                </div>}
                {mode !== 'expenses' && <div>
                  <p className="text-xs text-blue-200">Образцы</p>
                  <p className="text-lg font-semibold">€{totals.samplesCost.toLocaleString()}</p>
                </div>}
                {mode !== 'items' && <div>
                  <p className="text-xs text-blue-200">Расходы</p>
                  <p className="text-lg font-semibold">€{totals.expensesCost.toLocaleString()}</p>
                </div>}
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-emerald-200">ИТОГО</p>
                <p className="text-2xl font-bold text-emerald-300">
                  €{(mode === 'items'
                    ? totals.itemsCost + totals.samplesCost
                    : mode === 'expenses'
                      ? totals.expensesCost
                      : totals.totalCost
                  ).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 z-30 flex w-full justify-end gap-3 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="min-h-10">
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting} className="min-h-10 bg-blue-900 text-white hover:bg-blue-800">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'items' ? 'Сохранить товары' : mode === 'expenses' ? 'Сохранить расходы' : 'Сохранить изменения'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
