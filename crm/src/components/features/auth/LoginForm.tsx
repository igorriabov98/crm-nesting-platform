'use client'

// Форма входа — клиентский компонент
// React Hook Form + Zod валидация + Supabase Auth
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, Factory } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { ROUTES } from '@/lib/constants/routes'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

// Схема валидации формы входа
const loginSchema = z.object({
  email: z.string().trim().email({ message: 'Введите корректный email' }),
  password: z.string().min(6, { message: 'Минимум 6 символов' }),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginForm() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(values: LoginFormValues) {
    setIsLoading(true)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    })

    if (error) {
      toast.error('Ошибка входа', {
        description: 'Неверный email или пароль. Проверьте данные и попробуйте снова.',
      })
      setIsLoading(false)
      return
    }

    toast.success('Добро пожаловать!')
    router.push(ROUTES.DASHBOARD)
    router.refresh()
  }

  return (
    <Card className="w-full max-w-md border-[#E8ECF0] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <CardHeader className="space-y-4 pb-6">
        {/* Логотип */}
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1B3A6B] shadow-lg shadow-[#1B3A6B]/15">
            <Factory className="h-7 w-7 text-white" />
          </div>
        </div>

        <div className="text-center">
          <CardTitle className="text-2xl font-bold text-[#1B3A6B]">CRM Завода</CardTitle>
          <CardDescription className="mt-1 text-[#9CA3AF]">
            Система управления производством
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Поле Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#1B3A6B]">Email</FormLabel>
                  <FormControl>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="user@factory.com"
                      autoComplete="email"
                      className="border-[#D1D5DB] bg-white text-[#374151] placeholder:text-[#9CA3AF] focus:border-[#1B3A6B] focus:ring-[#1B3A6B]/10"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            {/* Поле Пароль */}
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#1B3A6B]">Пароль</FormLabel>
                  <FormControl>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="border-[#D1D5DB] bg-white text-[#374151] placeholder:text-[#9CA3AF] focus:border-[#1B3A6B] focus:ring-[#1B3A6B]/10"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            {/* Кнопка входа */}
            <Button
              id="login-submit"
              type="submit"
              disabled={isLoading}
              className="mt-2 w-full bg-[#1B3A6B] hover:bg-[#152D54] text-white font-medium transition-colors"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Вход...
                </>
              ) : (
                'Войти'
              )}
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-center text-xs text-[#9CA3AF]">
          Для получения доступа обратитесь к директору планирования
        </p>
      </CardContent>
    </Card>
  )
}
