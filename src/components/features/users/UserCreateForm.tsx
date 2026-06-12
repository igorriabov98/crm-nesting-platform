'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { ROUTES } from '@/lib/constants/routes'
import { ROLES } from '@/lib/constants/roles'
import { createUserSchema, type CreateUserInput } from '@/lib/types/schemas'
import { createUser } from '@/app/(protected)/admin/users/actions'
import type { FactorySummary, UserRole } from '@/lib/types'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  financial_director: 'Полный доступ + управление инвойсами',
  commercial_director: 'Полный доступ ко всем данным',
  planning_director: 'Полный доступ + управление пользователями',
  sales_manager: 'Создание машин, управление планом продаж и инвойсами',
  engineer: 'Подтверждение чертежей',
  technologist: 'Внесение номенклатуры, единиц измерения, количества',
  supply_manager: 'Управление поставщиками, ценами, статусами поставок',
  production_manager: 'Планирование этапов, цехов, дат производства',
  procurement_head: 'Ввод остатков ножей и комплектации',
  painting_head: 'Ввод остатков краски',
}
const ACTIVE_ROLE_OPTIONS = Object.entries(ROLES).filter(([key]) => key !== 'procurement_head' && key !== 'painting_head')

interface UserCreateFormProps {
  factories: FactorySummary[]
}

export function UserCreateForm({ factories }: UserCreateFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      password: '',
      full_name: '',
      role: 'engineer',
      factory_id: null,
      telegram_chat_id: '',
    },
  })

  // Следим за ролью для вывода ее описания
  const currentRole = form.watch('role') as UserRole
  const isProductionManager = currentRole === 'production_manager'
  const currentFactoryId = form.watch('factory_id')
  const currentFactoryName = factories.find((factory) => factory.id === currentFactoryId)?.name || null

  async function onSubmit(data: CreateUserInput) {
    setIsSubmitting(true)
    try {
      const res = await createUser(data)
      if (!res.success) {
        // Проверка типичной ошибки Auth
        if (res.error?.includes('already registered')) {
          throw new Error('Пользователь с таким email уже существует')
        }
        throw new Error(res.error || 'Не удалось создать пользователя')
      }
      
      toast.success('Пользователь ' + data.full_name + ' успешно создан!')
      router.push(ROUTES.ADMIN_USERS)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Произошла ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="max-w-2xl bg-white border-[#E8ECF0] mx-auto">
      <CardHeader>
        <CardTitle className="text-[#1B3A6B] text-xl">Создание профиля</CardTitle>
        <CardDescription className="text-[#6B7280]">
          Новый сотрудник получит доступ к CRM текущего завода
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="full_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Полное имя</FormLabel>
                    <FormControl>
                      <Input placeholder="Иван Иванов" {...field} className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus-visible:ring-blue-500" />
                    </FormControl>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Рабочий Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="example@factory.com" {...field} className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus-visible:ring-blue-500" />
                    </FormControl>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Пароль авторизации</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="••••••••" 
                          {...field} 
                          className="bg-[#F8F9FA] border-[#E8ECF0] pr-10 text-[#1B3A6B] focus-visible:ring-blue-500" 
                        />
                      </FormControl>
                      <button
                        type="button"
                        className="absolute right-3 top-2.5 text-[#6B7280] hover:text-[#374151]"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <FormDescription className="text-[#9CA3AF] text-xs">
                      Минимум 6 символов
                    </FormDescription>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Роль доступа</FormLabel>
                    <Select
                      value={field.value || ''}
                      onValueChange={(value) => {
                        field.onChange(value)
                        if (value !== 'production_manager') form.setValue('factory_id', null)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus:ring-blue-500">
                          <SelectValue placeholder="Установите должность" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                        {ACTIVE_ROLE_OPTIONS.map(([key, def]) => (
                          <SelectItem key={key} value={key}>
                            {key === 'production_manager' ? 'Начальник производства (выбрать завод)' : def.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {currentRole && (
                      <FormDescription className="text-[#6B7280] text-xs">
                        {ROLE_DESCRIPTIONS[currentRole]}
                      </FormDescription>
                    )}
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              {isProductionManager && (
                <FormField
                  control={form.control}
                  name="factory_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#374151]">Завод</FormLabel>
                      <Select value={field.value || ''} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus:ring-blue-500">
                            <SelectValue placeholder="Выберите завод" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                          {factories.map((factory) => (
                            <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-[#6B7280] text-xs">
                        Начальник производства будет видеть машины этого завода и машины без завода.
                      </FormDescription>
                      {currentFactoryName && (
                        <FormDescription className="text-[#1B3A6B] text-xs font-medium">
                          Должность: Начальник производства {currentFactoryName}
                        </FormDescription>
                      )}
                      <FormMessage className="text-[#DC2626]" />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="telegram_chat_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Telegram Chat ID</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="123456789"
                        {...field}
                        value={field.value || ''}
                        className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus-visible:ring-blue-500"
                      />
                    </FormControl>
                    <FormDescription className="text-[#6B7280] text-xs">
                      Используется для Telegram-уведомлений начальникам участков
                      {(currentRole === 'procurement_head' || currentRole === 'painting_head') ? '. Рекомендуется заполнить.' : ''}
                    </FormDescription>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex w-full justify-end gap-4 pt-4 border-t border-[#E8ECF0]">
              <Link href={ROUTES.ADMIN_USERS}>
                <Button type="button" variant="outline" disabled={isSubmitting} className="bg-transparent border-[#E8ECF0] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]">
                  Отмена
                </Button>
              </Link>
              <LoadingButton type="submit" loading={isSubmitting} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white shadow-lg shadow-[#1B3A6B]/10">
                Создать пользователя
              </LoadingButton>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
