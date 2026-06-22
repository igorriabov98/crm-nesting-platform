'use client'

import { useState } from 'react'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm as useReactHookForm } from 'react-hook-form'
import { toast } from 'sonner'
import { ArrowRight, Crown } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { updateUserSchema, type UpdateUserInput } from '@/lib/types/schemas'
import { updateUser } from '@/app/(protected)/admin/users/actions'
import type { CurrentUser } from '@/lib/types'

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
import { Button, buttonVariants } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

interface UserEditDialogProps {
  user: CurrentUser
  isOpen: boolean
  onClose: () => void
  isMe: boolean
}

export function UserEditDialog({ user, isOpen, onClose, isMe }: UserEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const memberships = (user.department_memberships || []).filter((membership) => membership.department)

  const form = useReactHookForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      full_name: user.full_name || '',
      is_active: user.is_active,
      telegram_chat_id: user.telegram_chat_id || '',
    },
  })

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
            Изменения аккаунта {user.email}. Доступ настраивается через отделы и должности.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <div className="grid gap-2">
              <div className="text-sm font-medium text-[#374151]">Отделы и должности</div>
              {memberships.length > 0 ? (
                <div className="space-y-2">
                  {memberships.map((membership, index) => {
                    if (!membership.department) return null

                    return (
                      <Link
                        key={`${membership.department.id}-${membership.position?.id || index}`}
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
                  Пользователь не назначен в отдел.
                </p>
              )}
              <Link
                href={ROUTES.ADMIN_DEPARTMENTS}
                onClick={onClose}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Управлять назначениями
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Полное имя</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="bg-[#F8F9FA] border-[#E8ECF0] focus-visible:ring-blue-500"
                    />
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
                    Используется для Telegram-уведомлений.
                  </p>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

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
                      Отключение блокирует доступ в систему даже при активной сессии.
                    </DialogDescription>
                    {isMe && <p className="text-xs text-orange-400 mt-1">Нельзя заблокировать собственный аккаунт.</p>}
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
