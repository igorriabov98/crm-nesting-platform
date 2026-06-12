'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Calendar, Check, Clock, Pencil, Plus, Repeat, Trash2, Users, X } from 'lucide-react'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'

import { createMeetingSchema } from '@/lib/types/schemas'
import { buildMeetingTypesMap } from '@/lib/constants/meetings'
import {
  createMeeting,
  createMeetingType,
  deleteMeetingType,
  updateMeetingType,
  type MeetingTypeOption,
} from '@/app/(protected)/meetings/actions'
import { ROLES, DIRECTOR_ROLES } from '@/lib/constants/roles'
import type { MeetingType, UserSummary } from '@/lib/types'

// Расширяем схему для формы
import * as z from 'zod'
import { addExternalAttendeeSchema } from '@/lib/types/schemas'

const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
]

const DURATION_OPTIONS = Array.from({ length: 16 }, (_, index) => (index + 1) * 15)

function getIsoWeekday(date: Date) {
  const day = date.getDay()
  return day === 0 ? 7 : day
}

const formSchema = createMeetingSchema.extend({
  attendeeIds: z.array(z.string()).default([]),
  externalAttendees: z.array(addExternalAttendeeSchema).default([]),
  is_recurring: z.boolean().default(false),
  recurrence_weekdays: z.array(z.number().int().min(1).max(7)).default([]),
  recurrence_end_date: z.string().optional(),
  recurrence_count: z.coerce.number().int().min(1).max(104).default(8),
}).superRefine((data, ctx) => {
  if (data.is_recurring && data.recurrence_weekdays.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Выберите хотя бы один день недели',
      path: ['recurrence_weekdays'],
    })
  }
})

type FormValues = z.infer<typeof formSchema>

interface Props {
  users: UserSummary[]
  meetingTypes: MeetingTypeOption[]
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export function MeetingCreateForm({ users, meetingTypes }: Props) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [types, setTypes] = useState(meetingTypes)
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [isCreatingType, setIsCreatingType] = useState(false)
  const [editingTypeKey, setEditingTypeKey] = useState<string | null>(null)
  const [editingTypeLabel, setEditingTypeLabel] = useState('')
  const [savingTypeKey, setSavingTypeKey] = useState<string | null>(null)
  const [deletingTypeKey, setDeletingTypeKey] = useState<string | null>(null)
  const meetingTypesMap = buildMeetingTypesMap(types)

  // По умолчанию ставим завтрашний день
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDate = tomorrow.toISOString().split('T')[0]
  const defaultWeekday = getIsoWeekday(tomorrow)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      meeting_type: 'general',
      title: '',
      meeting_date: defaultDate,
      meeting_time: '10:00',
      duration_minutes: 60,
      is_recurring: false,
      recurrence_weekdays: [defaultWeekday],
      recurrence_end_date: '',
      recurrence_count: 8,
      attendeeIds: [],
      externalAttendees: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'externalAttendees',
  })

  const attendeeIds = useWatch({
    control: form.control,
    name: 'attendeeIds',
  })

  const isRecurring = useWatch({
    control: form.control,
    name: 'is_recurring',
  })

  const recurrenceWeekdays = useWatch({
    control: form.control,
    name: 'recurrence_weekdays',
  }) || []

  // Функция авто-заполнения участников на основе типа
  const handleTypeChange = (type: MeetingType) => {
    form.setValue('meeting_type', type)
    
    // Предзаполняем
    if (type === 'general') {
      // Все директора
      const directors = users.filter(u => DIRECTOR_ROLES.includes(u.role)).map(u => u.id)
      form.setValue('attendeeIds', directors)
    } else if (type === 'factory_bergovo') {
      // Для простоты можно добавить начальников
      const managers = users.filter(u => ['production_manager', 'supply_manager', ...DIRECTOR_ROLES].includes(u.role)).map(u => u.id)
      form.setValue('attendeeIds', managers)
    } else if (type === 'factory_uzhgorod') {
      const managers = users.filter(u => ['production_manager', 'supply_manager', ...DIRECTOR_ROLES].includes(u.role)).map(u => u.id)
      form.setValue('attendeeIds', managers)
    }
  }

  const handleCreateType = async () => {
    if (!newTypeLabel.trim()) {
      toast.error('Введите название типа собрания')
      return
    }

    setIsCreatingType(true)
    try {
      const result = await createMeetingType(newTypeLabel)
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось создать тип собрания')
        return
      }

      setTypes((current) => [...current, result.data!])
      setNewTypeLabel('')
      handleTypeChange(result.data.key)
      toast.success('Тип собрания добавлен')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать тип собрания')
    } finally {
      setIsCreatingType(false)
    }
  }

  const startEditType = (type: MeetingTypeOption) => {
    setEditingTypeKey(type.key)
    setEditingTypeLabel(type.label)
  }

  const cancelEditType = () => {
    setEditingTypeKey(null)
    setEditingTypeLabel('')
  }

  const handleUpdateType = async (key: string) => {
    if (!editingTypeLabel.trim()) {
      toast.error('Введите название типа собрания')
      return
    }

    setSavingTypeKey(key)
    try {
      const result = await updateMeetingType(key, editingTypeLabel)
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось сохранить тип собрания')
        return
      }

      setTypes((current) => current.map((type) => (
        type.key === key ? result.data! : type
      )))
      cancelEditType()
      toast.success('Тип собрания обновлён')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить тип собрания')
    } finally {
      setSavingTypeKey(null)
    }
  }

  const handleDeleteType = async (type: MeetingTypeOption) => {
    if (type.is_system) {
      toast.error('Системный тип собрания нельзя удалить')
      return
    }
    if (!confirm(`Удалить тип собрания "${type.label}"?`)) return

    setDeletingTypeKey(type.key)
    try {
      const result = await deleteMeetingType(type.key)
      if (!result.success) {
        toast.error(result.error || 'Не удалось удалить тип собрания')
        return
      }

      setTypes((current) => current.filter((item) => item.key !== type.key))
      if (form.getValues('meeting_type') === type.key) {
        handleTypeChange('general')
      }
      toast.success('Тип собрания удалён')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить тип собрания')
    } finally {
      setDeletingTypeKey(null)
    }
  }

  const toggleWeekday = (weekday: number) => {
    const current = form.getValues('recurrence_weekdays') || []
    const next = current.includes(weekday)
      ? current.filter((day) => day !== weekday)
      : [...current, weekday].sort((a, b) => a - b)

    form.setValue('recurrence_weekdays', next, { shouldDirty: true, shouldValidate: true })
  }

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true)
    try {
      const res = await createMeeting(data)
      if (!res.success) {
        toast.error('Ошибка', { description: res.error })
        return
      }

      if (res.warning) {
        toast.warning('Собрание создано с предупреждением', { description: res.warning })
      } else if (res.createdCount && res.createdCount > 1) {
        toast.success(`Создано собраний: ${res.createdCount}`)
      } else {
        toast.success('Собрание назначено')
      }
      
      router.push(`/meetings/${res.meetingId}`)
      router.refresh()
    } catch (err: unknown) {
      toast.error('Системная ошибка', { description: getErrorMessage(err) })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-20">
        
        {/* Основная инфа */}
        <Card className="shadow-sm border-[#E8ECF0]">
          <CardHeader>
            <CardTitle className="text-lg text-[#1B3A6B]">Основная информация</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <FormField
                control={form.control}
                name="meeting_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Тип собрания *</FormLabel>
                    <Select onValueChange={(v) => v && handleTypeChange(v as MeetingType)} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите тип" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(meetingTypesMap).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={newTypeLabel}
                        onChange={(event) => setNewTypeLabel(event.target.value)}
                        placeholder="Новый тип собрания"
                        disabled={isCreatingType}
                      />
                      <LoadingButton
                        type="button"
                        variant="outline"
                        loading={isCreatingType}
                        onClick={handleCreateType}
                      >
                        Добавить
                      </LoadingButton>
                    </div>
                    <div className="mt-3 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-2">
                      <div className="mb-2 text-xs font-semibold text-[#6B7280]">Управление типами</div>
                      <div className="space-y-2">
                        {types.map((type) => {
                          const isEditing = editingTypeKey === type.key
                          const isBusy = savingTypeKey === type.key || deletingTypeKey === type.key
                          return (
                            <div key={type.key} className="flex items-center gap-2 rounded-md bg-white p-2 ring-1 ring-[#E8ECF0]">
                              {isEditing ? (
                                <Input
                                  value={editingTypeLabel}
                                  onChange={(event) => setEditingTypeLabel(event.target.value)}
                                  disabled={isBusy}
                                  className="h-8"
                                />
                              ) : (
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium text-[#1B3A6B]">{type.label}</div>
                                  {type.is_system && <div className="text-xs text-[#9CA3AF]">Системный тип</div>}
                                </div>
                              )}

                              {isEditing ? (
                                <>
                                  <LoadingButton
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    loading={savingTypeKey === type.key}
                                    onClick={() => handleUpdateType(type.key)}
                                    aria-label="Сохранить тип"
                                  >
                                    <Check className="h-4 w-4" />
                                  </LoadingButton>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    disabled={isBusy}
                                    onClick={cancelEditType}
                                    aria-label="Отменить редактирование"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    disabled={isBusy}
                                    onClick={() => startEditType(type)}
                                    aria-label="Редактировать тип"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <LoadingButton
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    loading={deletingTypeKey === type.key}
                                    disabled={type.is_system || isBusy}
                                    onClick={() => handleDeleteType(type)}
                                    aria-label="Удалить тип"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                  </LoadingButton>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Свой заголовок (опционально)</FormLabel>
                    <FormControl>
                      <Input placeholder="Например: Внеочередное обсуждение" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="meeting_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Дата *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input type="date" className="pl-9" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="meeting_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Время *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Clock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input type="time" className="pl-9" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="duration_minutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Длительность *</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(Number(value))}
                      value={String(field.value || 60)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите длительность" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DURATION_OPTIONS.map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4 space-y-4">
              <FormField
                control={form.control}
                name="is_recurring"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel className="flex items-center gap-2 text-sm font-medium text-[#1B3A6B]">
                        <Repeat className="h-4 w-4" />
                        Повторяющееся собрание
                      </FormLabel>
                      <p className="text-xs text-muted-foreground">
                        CRM создаст серию встреч с тем же временем, участниками и повесткой.
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              {isRecurring && (
                <div className="space-y-4 border-t border-[#E8ECF0] pt-4">
                  <FormField
                    control={form.control}
                    name="recurrence_weekdays"
                    render={() => (
                      <FormItem>
                        <FormLabel>Дни недели *</FormLabel>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map((weekday) => {
                            const selected = recurrenceWeekdays.includes(weekday.value)
                            return (
                              <Button
                                key={weekday.value}
                                type="button"
                                variant={selected ? 'default' : 'outline'}
                                size="sm"
                                className={selected ? 'bg-[#1B3A6B] hover:bg-[#2C5282]' : ''}
                                onClick={() => toggleWeekday(weekday.value)}
                              >
                                {weekday.label}
                              </Button>
                            )
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="recurrence_count"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Количество встреч</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              max={104}
                              {...field}
                              onChange={(event) => field.onChange(Number(event.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="recurrence_end_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Повторять до</FormLabel>
                          <FormControl>
                            <Input type="date" min={form.getValues('meeting_date')} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Участники из системы */}
        <Card className="shadow-sm border-[#E8ECF0]">
          <CardHeader>
            <CardTitle className="text-lg text-[#1B3A6B] flex items-center gap-2">
              <Users className="w-5 h-5" /> Участники из системы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
               {users.map(u => {
                 const isChecked = attendeeIds.includes(u.id)
                 return (
                   <div 
                     key={u.id} 
                     className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                     onClick={() => {
                        const current = form.getValues('attendeeIds')
                        if (current.includes(u.id)) {
                          form.setValue('attendeeIds', current.filter(id => id !== u.id))
                        } else {
                          form.setValue('attendeeIds', [...current, u.id])
                        }
                     }}
                   >
                     <Checkbox checked={isChecked} />
                     <div className="space-y-1 leading-none">
                       <p className="text-sm font-medium text-[#1B3A6B]">{u.full_name}</p>
                       <p className="text-xs text-muted-foreground">{ROLES[u.role as keyof typeof ROLES]?.label}</p>
                     </div>
                   </div>
                 )
               })}
            </div>
          </CardContent>
        </Card>

        {/* Внешние участники */}
        <Card className="shadow-sm border-[#E8ECF0]">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg text-[#1B3A6B]">Внешние участники</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ full_name: '', role_description: '', phone: '', email: '' })}>
               <Plus className="w-4 h-4 mr-2" /> Добавить
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
             {fields.length === 0 && (
               <p className="text-sm text-muted-foreground text-center py-4">Нет внешних участников</p>
             )}
             {fields.map((field, index) => (
               <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start border p-4 rounded-lg bg-gray-50 relative pr-10">
                 <Button 
                   type="button" 
                   variant="ghost" 
                   size="icon" 
                   className="absolute right-2 top-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                   onClick={() => remove(index)}
                 >
                   <Trash2 className="w-4 h-4" />
                 </Button>

                 <FormField
                   control={form.control}
                   name={`externalAttendees.${index}.full_name`}
                   render={({ field }) => (
                     <FormItem className="md:col-span-4">
                       <FormLabel>Имя *</FormLabel>
                       <FormControl><Input placeholder="Алексей Козлов" {...field} /></FormControl>
                       <FormMessage />
                     </FormItem>
                   )}
                 />

                 <FormField
                   control={form.control}
                   name={`externalAttendees.${index}.role_description`}
                   render={({ field }) => (
                     <FormItem className="md:col-span-3">
                       <FormLabel>Кто он/Откуда</FormLabel>
                       <FormControl><Input placeholder="Поставщик 'МеталлТрейд'" {...field} /></FormControl>
                       <FormMessage />
                     </FormItem>
                   )}
                 />

                 <FormField
                   control={form.control}
                   name={`externalAttendees.${index}.phone`}
                   render={({ field }) => (
                     <FormItem className="md:col-span-2">
                       <FormLabel>Телефон</FormLabel>
                       <FormControl><Input placeholder="+380..." {...field} /></FormControl>
                       <FormMessage />
                     </FormItem>
                   )}
                 />

                 <FormField
                   control={form.control}
                   name={`externalAttendees.${index}.email`}
                   render={({ field }) => (
                     <FormItem className="md:col-span-3">
                       <FormLabel>Email</FormLabel>
                       <FormControl><Input placeholder="alex@example.com" {...field} /></FormControl>
                       <FormMessage />
                     </FormItem>
                   )}
                 />
               </div>
             ))}
          </CardContent>
        </Card>

        {/* Действия */}
        <div className="bg-blue-50 p-4 rounded-lg flex items-center justify-between border border-blue-100">
           <p className="text-sm text-blue-800">
             ℹ️ Повестка будет сформирована автоматически после сохранения.
           </p>

           <div className="flex space-x-3">
              <Button type="button" variant="outline" onClick={() => router.push('/meetings')} disabled={isSubmitting}>
                Отмена
              </Button>
              <LoadingButton type="submit" loading={isSubmitting} className="bg-[#1B3A6B] text-white hover:bg-[#2C5282]">
                {isRecurring ? 'Создать серию' : 'Создать собрание'}
              </LoadingButton>
           </div>
        </div>
      </form>
    </Form>
  )
}
