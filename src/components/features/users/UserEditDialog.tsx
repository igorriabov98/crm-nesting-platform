'use client'

import { useState } from 'react'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm as useReactHookForm } from 'react-hook-form'
import { toast } from 'sonner'
import { ArrowRight, Crown } from 'lucide-react'
import { ROLES } from '@/lib/constants/roles'
import { ROUTES } from '@/lib/constants/routes'
import { updateUserSchema, type UpdateUserInput } from '@/lib/types/schemas'
import { updateUser } from '@/app/(protected)/admin/users/actions'
import type { CurrentUser, FactorySummary, UserRole } from '@/lib/types'

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button, buttonVariants } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const ACTIVE_ROLE_OPTIONS = Object.entries(ROLES).filter(([key]) => key !== 'procurement_head' && key !== 'painting_head')

interface UserEditDialogProps {
  user: CurrentUser
  factories: FactorySummary[]
  isOpen: boolean
  onClose: () => void
  isMe: boolean
}

export function UserEditDialog({ user, factories, isOpen, onClose, isMe }: UserEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const memberships = (user.department_memberships || []).filter((membership) => membership.department)

  const form = useReactHookForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      full_name: user.full_name || '',
      role: user.role,
      factory_id: user.factory_id || null,
      is_active: user.is_active,
      telegram_chat_id: user.telegram_chat_id || '',
    },
  })
  const currentRole = form.watch('role') as UserRole | undefined
  const isProductionManager = currentRole === 'production_manager'
  const currentFactoryId = form.watch('factory_id')
  const currentFactoryName = factories.find((factory) => factory.id === currentFactoryId)?.name || null

  async function onSubmit(data: UpdateUserInput) {
    setIsSubmitting(true)
    try {
      const res = await updateUser(user.id, data)
      if (!res.success) throw new Error(res.error || 'Не удалось сохранить изменения')
      
      toast.success('Изменения сохранены')
      onClose()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить изменения')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-white border-[#E8ECF0] text-[#1B3A6B] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактирование профиля</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Внесите изменения в аккаунт {user.email}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Полное имя</FormLabel>
                  <FormControl>
                    <Input {...field} className="bg-[#F8F9FA] border-[#E8ECF0] focus-visible:ring-blue-500" />
                  </FormControl>
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
                      {...field}
                      value={field.value || ''}
                      placeholder="123456789"
                      className="bg-[#F8F9FA] border-[#E8ECF0] focus-visible:ring-blue-500"
                    />
                  </FormControl>
                  <p className="text-xs text-[#6B7280]">
                    Используется для Telegram-уведомлений начальникам участков
                  </p>
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
                    disabled={isMe} 
                    onValueChange={(value) => {
                      field.onChange(value)
                      if (value !== 'production_manager') form.setValue('factory_id', null)
                    }} 
                    value={field.value || ''}
                  >
                    <FormControl>
                      <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] focus:ring-blue-500">
                        <SelectValue placeholder="Выберите роль" />
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
                  {isMe && <p className="text-xs text-orange-400 mt-1">Невозможно изменить свою роль</p>}
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
                    <Select disabled={isMe} value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="bg-[#F8F9FA] border-[#E8ECF0] focus:ring-blue-500">
                          <SelectValue placeholder="Выберите завод" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-[#F8F9FA] border-[#E8ECF0] text-[#1B3A6B]">
                        {factories.map((factory) => (
                          <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-4 shadow-sm">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base text-[#374151]">
                      Аккаунт активен
                    </FormLabel>
                    <DialogDescription className="text-xs text-[#9CA3AF]">
                      Отключение заблокирует доступ в систему
                    </DialogDescription>
                    {isMe && <p className="text-xs text-orange-400 mt-1">Невозможно заблокировать свой аккаунт</p>}
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isMe}
                      className="data-[state=checked]:bg-emerald-500"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <section className="space-y-3 border-t border-[#E8ECF0] pt-4">
              <div>
                <h3 className="font-semibold text-[#1B3A6B]">Отделы</h3>
                <p className="text-xs text-[#6B7280]">Назначения пользователя в организационной структуре.</p>
              </div>

              {memberships.length > 0 ? (
                <div className="space-y-2">
                  {memberships.map((membership, index) => {
                    if (!membership.department) return null

                    return (
                      <Link
                        key={`${membership.department.id}-${index}`}
                        href={`${ROUTES.ADMIN_DEPARTMENTS}#department-${membership.department.id}`}
                        onClick={onClose}
                        className="flex items-center justify-between gap-3 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm transition-colors hover:border-[#1B3A6B]/30 hover:bg-[#EFF6FF]"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium text-[#1B3A6B]">
                            {membership.is_department_head && <Crown className="h-4 w-4 text-amber-500" />}
                            <span className="truncate">{membership.department.name}</span>
                          </span>
                          <span className="text-xs text-[#6B7280]">
                            {membership.position?.name || 'Без должности'}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-[#6B7280]" />
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-lg bg-[#F8F9FA] px-3 py-3 text-sm text-[#6B7280]">
                  Не назначен в отдел.
                </p>
              )}

              <Link
                href={ROUTES.ADMIN_DEPARTMENTS}
                onClick={onClose}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Управление
                <ArrowRight className="h-4 w-4" />
              </Link>
            </section>

            <div className="flex w-full sm:justify-end gap-3 pt-4 border-t border-[#E8ECF0]">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="bg-transparent border-[#E8ECF0] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]">
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white">
                {isSubmitting ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
