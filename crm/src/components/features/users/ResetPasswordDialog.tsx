'use client'

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm as useReactHookForm } from 'react-hook-form'
import { toast } from 'sonner'
import { resetPasswordSchema } from '@/lib/types/schemas'
import { resetUserPassword } from '@/app/(protected)/admin/users/actions'
import type { CurrentUser } from '@/lib/types'
import { z } from 'zod'

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

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

interface ResetPasswordDialogProps {
  user: CurrentUser
  isOpen: boolean
  onClose: () => void
}

export function ResetPasswordDialog({ user, isOpen, onClose }: ResetPasswordDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useReactHookForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: ResetPasswordInput) {
    setIsSubmitting(true)
    try {
      const res = await resetUserPassword(user.id, data.password)
      if (!res.success) throw new Error(res.error || 'Не удалось сбросить пароль')
      
      toast.success('Пароль успешно изменен')
      form.reset()
      onClose()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сбросить пароль')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        form.reset()
        onClose()
      }
    }}>
      <DialogContent className="sm:max-w-md bg-white border-[#E8ECF0] text-[#1B3A6B]">
        <DialogHeader>
          <DialogTitle>Сброс пароля</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Установите новый пароль для {user.email}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Новый пароль</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} className="bg-[#F8F9FA] border-[#E8ECF0] focus-visible:ring-blue-500" />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Подтвердите пароль</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} className="bg-[#F8F9FA] border-[#E8ECF0] focus-visible:ring-blue-500" />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            <div className="flex w-full sm:justify-end gap-3 pt-4 border-t border-[#E8ECF0]">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting} className="bg-transparent border-[#E8ECF0] hover:bg-[#F8F9FA] hover:text-[#1B3A6B]">
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-[#1B3A6B] hover:bg-[#152D54] text-white">
                {isSubmitting ? 'Сохранение...' : 'Установить пароль'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
