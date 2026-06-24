'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useFieldArray, useWatch, type FieldPath, type Resolver } from 'react-hook-form'
import { Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ROUTES } from '@/lib/constants/routes'
import { COATINGS } from '@/lib/constants/coatings'
import { createMachineSchema, type CreateMachineInput } from '@/lib/types/schemas'
import { createMachine } from '@/app/(protected)/sales-plan/actions'
import type { ProductOption, ProductProjectSampleOption } from '@/lib/actions/products'
import type { Client, CoatingType, FactorySummary } from '@/lib/types'
import { ClientCreateDialog } from '@/components/features/clients/ClientCreateDialog'
import { paymentTermsLabel } from '@/components/features/clients/ClientFormFields'
import { getFactoryWorkshopOptionsById } from '@/lib/constants/factory-workshops'
import { getProductionMonthOptions, monthStartValue } from '@/lib/utils/production-months'
import { TRANSPORT_EXPENSE_CATEGORY, isTransportExpenseCategory } from '@/lib/utils/transport-expense'
import { ProductOptionCombobox } from '@/components/features/machines/ProductOptionCombobox'

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
import { LoadingButton } from '@/components/ui/loading-button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

function toNumberInputValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : ''
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

function toFiniteNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function getCoatingLabel(coating: CoatingType | null | undefined) {
  return coating ? COATINGS[coating].label : 'Выберите покрытие'
}

export function MachineCreateForm({
  clients: initialClients,
  factories,
  products,
  projectSamples,
}: {
  clients: Client[]
  factories: FactorySummary[]
  products: ProductOption[]
  projectSamples: ProductProjectSampleOption[]
}) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [clients, setClients] = useState(initialClients)
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false)
  const [transportAmount, setTransportAmount] = useState<number | undefined>(undefined)
  
  const form = useForm<CreateMachineInput>({
    resolver: zodResolver(createMachineSchema) as unknown as Resolver<CreateMachineInput>,
    defaultValues: {
      name: '',
      client_id: '',
      is_confirmed: false,
      desired_shipping_date: undefined,
      production_month: monthStartValue(),
      factory_id: '',
      production_workshop: undefined,
      items: [],
      samples: [],
      expenses: []
    },
  })

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control: form.control,
    name: "items"
  })

  const { fields: expenseFields, append: appendExpense, remove: removeExpense } = useFieldArray({
    control: form.control,
    name: "expenses"
  })

  const { fields: sampleFields, append: appendSample, remove: removeSample } = useFieldArray({
    control: form.control,
    name: "samples"
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

  const selectedClientId = useWatch({
    control: form.control,
    name: 'client_id',
  })

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || null,
    [clients, selectedClientId],
  )

  const selectedFactoryId = useWatch({
    control: form.control,
    name: 'factory_id',
  })

  const selectedWorkshop = useWatch({
    control: form.control,
    name: 'production_workshop',
  })

  const workshopOptions = useMemo(
    () => getFactoryWorkshopOptionsById(factories, selectedFactoryId),
    [factories, selectedFactoryId],
  )
  const productionMonthOptions = useMemo(() => getProductionMonthOptions(), [])

  useEffect(() => {
    if (!selectedFactoryId) {
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
    const itemWeight = (watchedItems || []).reduce((acc, item) => acc + (toFiniteNumber(item.weight) * toFiniteNumber(item.quantity, 1)), 0)
    const sampleWeight = (watchedSamples || []).reduce((acc, item) => acc + (toFiniteNumber(item.weight) * toFiniteNumber(item.quantity, 1)), 0)
    const itemsCost = (watchedItems || []).reduce((acc, item) => acc + (toFiniteNumber(item.price) * toFiniteNumber(item.quantity, 1)), 0)
    const samplesCost = (watchedSamples || []).reduce((acc, item) => acc + (toFiniteNumber(item.price) * toFiniteNumber(item.quantity, 1)), 0)
    const transportCost = Math.max(0, toFiniteNumber(transportAmount))
    const expensesCost = transportCost + (watchedExpenses || [])
      .filter((expense) => !isTransportExpenseCategory(expense.category))
      .reduce((acc, exp) => acc + toFiniteNumber(exp.amount), 0)
    return {
      totalWeight: (itemWeight + sampleWeight) / 1000,
      itemsCost,
      samplesCost,
      expensesCost,
      totalCost: itemsCost + samplesCost + expensesCost
    }
  }, [transportAmount, watchedItems, watchedSamples, watchedExpenses])

  // Уникальные RAL для автодополнения (можно использовать <datalist>)
  const uniqueRals = useMemo(() => {
    const rals = new Set<string>()
    ;[...(watchedItems || []), ...(watchedSamples || [])].forEach(i => {
      if (i.coating === 'powder_coating' && i.ral_number) rals.add(i.ral_number)
    })
    return Array.from(rals)
  }, [watchedItems, watchedSamples])

  function rowPath(name: 'items' | 'samples', index: number, field: keyof NonNullable<CreateMachineInput['items']>[number]) {
    return `${name}.${index}.${field}` as FieldPath<CreateMachineInput>
  }

  function setRowValue(name: 'items' | 'samples', index: number, field: keyof NonNullable<CreateMachineInput['items']>[number], value: unknown) {
    form.setValue(rowPath(name, index, field), value as never)
  }

  function applyProductToRow(name: 'items' | 'samples', index: number, productId: string) {
    const product = products.find((item) => item.id === productId)
    if (!product) return
    setRowValue(name, index, 'product_id', product.id)
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
    setRowValue(name, index, 'price', Number(product.base_price_eur))
  }

  function applyProjectSampleToRow(index: number, projectId: string) {
    const sample = projectSamples.find((item) => item.project_id === projectId)
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

  async function onSubmit(data: CreateMachineInput) {
    setIsSubmitting(true)
    try {
      const transportCost = Math.max(0, toFiniteNumber(transportAmount))
      const regularExpenses = (data.expenses || []).filter((expense) => !isTransportExpenseCategory(expense.category))
      const payload: CreateMachineInput = {
        ...data,
        items: [
          ...(data.items || []).map((item) => ({ ...item, is_sample: false })),
          ...(data.samples || []).map((item) => ({ ...item, is_sample: true })),
        ],
        samples: [],
        expenses: [
          ...(transportCost > 0 ? [{ category: TRANSPORT_EXPENSE_CATEGORY, amount: transportCost, comment: '' }] : []),
          ...regularExpenses,
        ],
      }
      const res = await createMachine(payload)
      if (!res.success) throw new Error(res.error || 'Не удалось создать машину')
      
      toast.success('Машина успешно создана')
      router.push(ROUTES.SALES_PLAN)
      router.refresh()
    } catch (e: unknown) {
      toast.error(getErrorMessage(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="mx-auto max-w-7xl overflow-hidden border-slate-200 bg-transparent shadow-none">
      <CardHeader className="border-b border-slate-200 bg-white px-4 py-5 sm:px-6">
        <CardTitle className="text-xl text-slate-950">Создание машины</CardTitle>
        <CardDescription className="max-w-3xl text-slate-500">
          Заполните коммерческие и производственные данные. Товары автоматически сформируют последующие этапы работы.
        </CardDescription>
      </CardHeader>
      <CardContent className="bg-slate-50/70 p-3 sm:p-5">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-5">
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 sm:p-5">
              <FormField
                control={form.control}
                name="client_id"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <FormLabel className="text-[#374151]">Клиент *</FormLabel>
                      <Button type="button" variant="outline" size="sm" onClick={() => setIsClientDialogOpen(true)}>
                        <Plus className="mr-1 h-4 w-4" />
                        Новый клиент
                      </Button>
                    </div>
                    <Select
                      value={field.value || ''}
                      onValueChange={(value) => {
                        field.onChange(value)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Выберите компанию">
                            {() => selectedClient?.name || 'Выберите компанию'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedClient && (
                      <p className="text-xs text-[#6B7280]">
                        {selectedClient.primary_contact_name || 'Контакт не указан'} · {paymentTermsLabel(selectedClient.payment_terms_type, selectedClient.payment_due_days, selectedClient.prepayment_percent, selectedClient.final_payment_due_days)}
                      </p>
                    )}
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Название машины *</FormLabel>
                    <FormControl>
                      <Input placeholder="Например: ТН-1400" {...field} className="h-11 border-slate-200 bg-slate-50 text-base text-slate-900 sm:text-sm" />
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
                    <FormLabel className="text-[#374151]">Месяц производства *</FormLabel>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Выберите месяц">
                            {() => productionMonthOptions.find((option) => option.value === field.value)?.label || 'Выберите месяц'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {productionMonthOptions.map((option) => (
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
                    <FormLabel className="text-[#374151]">Завод *</FormLabel>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder="Выберите завод">
                            {() => factories.find((factory) => factory.id === field.value)?.name || 'Выберите завод'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {factories.map((factory) => (
                          <SelectItem key={factory.id} value={factory.id}>
                            {factory.name}
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
                name="production_workshop"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Цех *</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : ''}
                      onValueChange={(value) => field.onChange(Number(value))}
                      disabled={!selectedFactoryId}
                    >
                      <FormControl>
                        <SelectTrigger className="h-11 border-slate-200 bg-slate-50">
                          <SelectValue placeholder={selectedFactoryId ? 'Выберите цех' : 'Сначала выберите завод'}>
                            {() => workshopOptions.find((option) => option.value === field.value)?.label || (selectedFactoryId ? 'Выберите цех' : 'Сначала выберите завод')}
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

              <FormField
                control={form.control}
                name="is_confirmed"
                render={({ field }) => (
                  <FormItem className="flex min-h-16 flex-row items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <FormLabel className="text-[#374151]">Подтверждена</FormLabel>
                      <p className="text-xs text-[#6B7280]">
                        Машина готова к планированию и производству
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value || false}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

            </div>

            <FormField
              control={form.control}
              name="desired_shipping_date"
              render={({ field }) => (
                <FormItem className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:max-w-sm">
                  <FormLabel className="text-[#374151]">Желаемая дата отгрузки</FormLabel>
                  <FormControl>
                    <DatePicker
                      value={field.value ? new Date(field.value) : undefined}
                      onChange={(date) => field.onChange(date ? date.toISOString().split('T')[0] : undefined)}
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
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="border-b pb-2">
                <h3 className="text-lg font-semibold text-[#1B3A6B]">Товары</h3>
                <p className="text-sm text-[#6B7280]">Необязательно. Машину можно создать пустой и заполнить позже.</p>
              </div>
              {itemFields.map((field, index) => {
                const coatingValue = watchedItems?.[index]?.coating || 'none'
                const totalWeight = toFiniteNumber(watchedItems?.[index]?.weight) * toFiniteNumber(watchedItems?.[index]?.quantity)
                
                return (
                  <Card key={field.id} className="relative border-slate-200 bg-slate-50 p-4 shadow-none">
                    <div className="absolute top-2 right-2">
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => removeItem(index)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 pr-10">
                      <FormField
                        control={form.control}
                        name={`items.${index}.product_id`}
                        render={({ field }) => (
                          <FormItem className="md:col-span-2 lg:col-span-4">
                            <FormLabel className="text-xs">Товар из базы продукции *</FormLabel>
                            <FormControl>
                              <ProductOptionCombobox products={products} value={field.value} onChange={(value) => applyProductToRow('items', index, value)} />
                            </FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={form.control}
                        name={`items.${index}.drawing_number`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Чертёж *</FormLabel>
                            <FormControl><Input {...field} disabled className="h-8 text-sm bg-white text-[#6B7280]" placeholder="Выберите продукт" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.product_name`}
                        render={({ field }) => (
                          <FormItem className="lg:col-span-2">
                            <FormLabel className="text-xs">Часть / Наименование товара *</FormLabel>
                            <FormControl><Input {...field} disabled className="h-8 text-sm bg-white text-[#6B7280]" placeholder="Выберите продукт" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.coating`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Покрытие *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''}>
                              <FormControl>
                                <SelectTrigger className="h-8 text-sm bg-white">
                                  <SelectValue placeholder="Выберите покрытие">
                                    {() => getCoatingLabel(field.value)}
                                  </SelectValue>
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {Object.entries(COATINGS).map(([val, {label}]) => (
                                  <SelectItem key={val} value={val}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.weight`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Вес ед. (кг) *</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} value={toNumberInputValue(field.value)} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Количество *</FormLabel>
                            <FormControl><Input type="number" {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseIntegerInput(e.target.value))} className="h-8 text-sm" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />

                      <FormItem>
                        <FormLabel className="text-xs">Общий вес (кг)</FormLabel>
                        <FormControl>
                          <Input value={Number(totalWeight.toFixed(3))} disabled className="h-8 text-sm bg-white text-[#6B7280]" />
                        </FormControl>
                      </FormItem>

                      <FormField
                        control={form.control}
                        name={`items.${index}.price`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Цена ед. (€) *</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} value={toNumberInputValue(field.value)} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
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
                                <Input 
                                  {...field} 
                                  list="ral-options"
                                  className="h-8 text-sm border-orange-200" 
                                  placeholder="9005" 
                                />
                              </FormControl>
                              <FormMessage className="text-[10px] text-[#DC2626]" />
                            </FormItem>
                          )}
                        />
                      )}

                    </div>
                  </Card>
                )
              })}
              
              <datalist id="ral-options">
                {uniqueRals.map(r => <option key={r} value={r} />)}
              </datalist>

              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="mt-2 text-[#1B3A6B]"
                onClick={() => appendItem({ product_id: null, drawing_number: '', product_name: '', weight: 0, price: 0, quantity: 1, coating: 'none', ral_number: '' })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить товар
              </Button>
            </div>

            {/* SAMPLES */}
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div>
                <h3 className="text-lg font-semibold text-[#1B3A6B] border-b pb-2">Образцы</h3>
                <p className="mt-2 text-sm text-[#6B7280]">
                  Образцы учитываются в общем весе, стоимости и требованиях к покрытию.
                </p>
              </div>
              {sampleFields.map((field, index) => {
                const coatingValue = watchedSamples?.[index]?.coating || 'none'
                const totalWeight = toFiniteNumber(watchedSamples?.[index]?.weight) * toFiniteNumber(watchedSamples?.[index]?.quantity)

                return (
                  <Card key={field.id} className="p-4 bg-amber-50/60 border-amber-200 relative">
                    <div className="absolute top-2 right-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeSample(index)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 pr-10">
                      <FormField
                        control={form.control}
                        name={`samples.${index}.product_project_id`}
                        render={({ field }) => (
                          <FormItem className="md:col-span-2 lg:col-span-4">
                            <FormLabel className="text-xs">Проект изделия для образца *</FormLabel>
                            <FormControl>
                              <ProductOptionCombobox
                                products={projectSamples}
                                value={field.value}
                                placeholder="Выберите утвержденный проект"
                                onChange={(value) => applyProjectSampleToRow(index, value)}
                              />
                            </FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`samples.${index}.drawing_number`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Чертёж *</FormLabel>
                            <FormControl><Input {...field} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`samples.${index}.product_name`}
                        render={({ field }) => (
                          <FormItem className="lg:col-span-2">
                            <FormLabel className="text-xs">Товар *</FormLabel>
                            <FormControl><Input {...field} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`samples.${index}.coating`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Покрытие *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ''}>
                              <FormControl>
                                <SelectTrigger className="h-8 text-sm bg-white">
                                  <SelectValue placeholder="Выберите покрытие">
                                    {() => getCoatingLabel(field.value)}
                                  </SelectValue>
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {Object.entries(COATINGS).map(([val, { label }]) => (
                                  <SelectItem key={val} value={val}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`samples.${index}.weight`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Вес ед. (кг) *</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} value={toNumberInputValue(field.value)} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`samples.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Кол-во *</FormLabel>
                            <FormControl><Input type="number" {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseIntegerInput(e.target.value))} className="h-8 text-sm" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      <FormItem>
                        <FormLabel className="text-xs">Общий вес (кг)</FormLabel>
                        <FormControl>
                          <Input value={Number(totalWeight.toFixed(3))} disabled className="h-8 text-sm bg-white text-[#6B7280]" />
                        </FormControl>
                      </FormItem>
                      <FormField
                        control={form.control}
                        name={`samples.${index}.price`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Цена ед. (€) *</FormLabel>
                            <FormControl><Input type="number" step="0.01" {...field} value={toNumberInputValue(field.value)} disabled className="h-8 text-sm bg-white text-[#6B7280]" /></FormControl>
                            <FormMessage className="text-[10px] text-[#DC2626]" />
                          </FormItem>
                        )}
                      />
                      {coatingValue === 'powder_coating' && (
                        <FormField
                          control={form.control}
                          name={`samples.${index}.ral_number`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-orange-500">RAL</FormLabel>
                              <FormControl><Input {...field} list="ral-options" className="h-8 text-sm border-orange-200" /></FormControl>
                              <FormMessage className="text-[10px] text-[#DC2626]" />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                  </Card>
                )
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 text-[#1B3A6B]"
                onClick={() => appendSample({ product_id: null, product_project_id: null, product_project_version_id: null, drawing_number: '', product_name: '', weight: 0, price: 0, quantity: 1, coating: 'none', ral_number: '', is_sample: true })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить образец
              </Button>
            </div>

            {/* РАСХОДЫ */}
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
                        <FormControl><Input {...field} placeholder="Категория расхода" className="h-9" /></FormControl>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )}
                  />
                   <FormField
                    control={form.control}
                    name={`expenses.${index}.amount`}
                    render={({ field }) => (
                      <FormItem className="w-32">
                        <FormControl><Input type="number" {...field} value={toNumberInputValue(field.value)} onChange={e => field.onChange(parseNumberInput(e.target.value))} placeholder="Сумма" className="h-9" /></FormControl>
                        <FormMessage className="text-[10px]" />
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
                    onClick={() => removeExpense(index)}
                    className="text-red-500 mt-0.5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              
              <Button 
                type="button" 
                variant="outline" 
                size="sm" 
                className="mt-2 text-[#1B3A6B]"
                onClick={() => appendExpense({ category: '', amount: 0, comment: '' })}
              >
                <Plus className="w-4 h-4 mr-1" /> Добавить расход
              </Button>
            </div>

            </div>
            <aside className="sticky bottom-0 z-20 space-y-3 xl:top-4 xl:bottom-auto">
              <div className="rounded-2xl border border-blue-900/10 bg-gradient-to-br from-blue-950 to-blue-800 p-5 text-white shadow-[0_18px_50px_rgba(30,64,175,0.22)]">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Итоги машины</div>
                <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-1">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-blue-200">Общий вес</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{totals.totalWeight.toFixed(2)} т</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-blue-200">Товары</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">€{totals.itemsCost.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-blue-200">Образцы</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">€{totals.samplesCost.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-blue-200">Доп. расходы</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">€{totals.expensesCost.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-4 border-t border-white/15 pt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Итого</div>
                  <div className="mt-1 text-3xl font-bold tabular-nums text-emerald-300">€{totals.totalCost.toLocaleString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg xl:grid-cols-1">
                <Button
                  type="button"
                  variant="outline"
                  render={<Link href={ROUTES.SALES_PLAN} />}
                  disabled={isSubmitting}
                  className="min-h-11 border-slate-200"
                >
                  Отмена
                </Button>
                <LoadingButton
                  type="submit"
                  loading={isSubmitting}
                  className="min-h-11 bg-blue-900 text-white hover:bg-blue-800"
                >
                  Создать машину
                </LoadingButton>
              </div>
            </aside>
          </form>
        </Form>
      </CardContent>
      <ClientCreateDialog
        open={isClientDialogOpen}
        onOpenChange={setIsClientDialogOpen}
        onCreated={(client) => {
          setClients((current) => [...current, client].sort((a, b) => a.name.localeCompare(b.name)))
          form.setValue('client_id', client.id)
        }}
      />
    </Card>
  )
}

