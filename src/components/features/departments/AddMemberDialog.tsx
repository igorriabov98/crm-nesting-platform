'use client'

import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { addMember } from '@/app/(protected)/admin/settings/departments/actions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { addDepartmentMemberSchema, type AddDepartmentMemberInput } from '@/lib/types/schemas'
import type { DepartmentMember, Position } from '@/lib/types/departments'

const NONE_VALUE = '__none__'

interface AddMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  departmentId: string
  existingMemberIds: string[]
  departmentMembers: DepartmentMember[]
  users: { id: string; full_name: string }[]
  positions: Position[]
  onSuccess: () => void
}

export function AddMemberDialog({
  open,
  onOpenChange,
  departmentId,
  existingMemberIds,
  departmentMembers,
  users,
  positions,
  onSuccess,
}: AddMemberDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availableUsers = useMemo(
    () => users.filter((user) => !existingMemberIds.includes(user.id)),
    [existingMemberIds, users]
  )

  const form = useForm<AddDepartmentMemberInput>({
    resolver: zodResolver(addDepartmentMemberSchema) as Resolver<AddDepartmentMemberInput>,
    defaultValues: {
      user_id: '',
      department_id: departmentId,
      position_id: null,
      reports_to_user_id: null,
      is_department_head: false,
    },
  })

  useEffect(() => {
    if (!open) return

    form.reset({
      user_id: '',
      department_id: departmentId,
      position_id: null,
      reports_to_user_id: null,
      is_department_head: false,
    })
    setError(null)
  }, [departmentId, form, open])

  async function onSubmit(values: AddDepartmentMemberInput) {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await addMember(values)
      if (!result.success) {
        throw new Error(result.error || 'Не удалось добавить сотрудника')
      }

      toast.success('Сотрудник добавлен в отдел')
      onOpenChange(false)
      onSuccess()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось добавить сотрудника')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="border-[#E8ECF0] bg-white text-[#1B3A6B] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить сотрудника</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Выберите сотрудника и настройте его назначение в отделе.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <input type="hidden" {...form.register('department_id')} />

            <FormField
              control={form.control}
              name="user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Сотрудник</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={availableUsers.length === 0}>
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите сотрудника" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      {availableUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {availableUsers.length === 0 && (
                    <p className="text-xs text-[#6B7280]">Все активные пользователи уже добавлены в отдел.</p>
                  )}
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
                  <Select
                    value={field.value ?? NONE_VALUE}
                    onValueChange={(value) => field.onChange(value === NONE_VALUE ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите должность" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      <SelectItem value={NONE_VALUE}>Без должности</SelectItem>
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
                    value={field.value ?? NONE_VALUE}
                    onValueChange={(value) => field.onChange(value === NONE_VALUE ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите руководителя" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      <SelectItem value={NONE_VALUE}>Без руководителя</SelectItem>
                      {departmentMembers.map((member) => (
                        <SelectItem key={member.id} value={member.user_id}>
                          {member.user?.full_name || 'Пользователь'}
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
              name="is_department_head"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div>
                    <FormLabel className="text-[#374151]">Начальник отдела</FormLabel>
                    <p className="text-xs text-[#6B7280]">Текущий начальник будет заменён.</p>
                  </div>
                </FormItem>
              )}
            />

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-[#DC2626]">{error}</div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting || availableUsers.length === 0}>
                {isSubmitting ? 'Добавление...' : 'Добавить'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
