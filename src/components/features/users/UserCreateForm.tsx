'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { ROUTES } from '@/lib/constants/routes'
import { createUserSchema, type CreateUserInput } from '@/lib/types/schemas'
import { createUser, type UserCreateOption, type UserSupervisorOption } from '@/app/(protected)/admin/users/actions'

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
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface UserCreateFormProps {
  departments: UserCreateOption[]
  positions: UserCreateOption[]
  users: UserSupervisorOption[]
}

export function UserCreateForm({ departments, positions, users }: UserCreateFormProps) {
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
      department_id: '',
      position_id: '',
      reports_to_user_id: null,
      is_department_head: false,
      telegram_chat_id: '',
    },
  })

  async function onSubmit(data: CreateUserInput) {
    setIsSubmitting(true)
    try {
      const res = await createUser(data)
      if (!res.success) {
        if (res.error?.includes('already registered')) {
          throw new Error('Пользователь с таким email уже существует')
        }
        throw new Error(res.error || 'Не удалось создать пользователя')
      }
      
      toast.success(`Пользователь ${data.full_name} создан`)
      router.push(ROUTES.ADMIN_USERS)
      router.refresh()
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
          Новый сотрудник сразу привязывается к отделу и должности. Доступ будет рассчитан по матрице отдела.
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
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••••••"
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
                      Минимум 12 символов
                    </FormDescription>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

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
                      Необязательно. Используется для Telegram-уведомлений.
                    </FormDescription>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="department_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Отдел</FormLabel>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus:ring-blue-500">
                          <SelectValue placeholder="Выберите отдел">
                            {field.value
                              ? departments.find((department) => department.id === field.value)?.name || 'Выберите отдел'
                              : 'Выберите отдел'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                        {departments.map((department) => (
                          <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="position_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Должность</FormLabel>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus:ring-blue-500">
                          <SelectValue placeholder="Выберите должность">
                            {field.value
                              ? positions.find((position) => position.id === field.value)?.name || 'Выберите должность'
                              : 'Выберите должность'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                        {positions.map((position) => (
                          <SelectItem key={position.id} value={position.id}>{position.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reports_to_user_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#374151]">Руководитель</FormLabel>
                    <Select
                      value={field.value || 'none'}
                      onValueChange={(value) => field.onChange(value === 'none' ? null : value)}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B] focus:ring-blue-500">
                          <SelectValue placeholder="Не выбран">
                            {field.value
                              ? users.find((user) => user.id === field.value)?.full_name
                                || users.find((user) => user.id === field.value)?.email
                                || 'Не выбран'
                              : 'Не выбран'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                        <SelectItem value="none">Не выбран</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.full_name || user.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-[#6B7280] text-xs">
                      Необязательно для начальника отдела.
                    </FormDescription>
                    <FormMessage className="text-[#DC2626]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="is_department_head"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4 shadow-sm md:col-span-2">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base text-[#374151]">
                        Начальник отдела
                      </FormLabel>
                      <FormDescription className="text-xs text-[#9CA3AF]">
                        Если включено, пользователь получит права из блока «Начальник отдела», а отдел будет синхронизирован с ним как руководителем.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                    </FormControl>
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
