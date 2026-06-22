'use client'

import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { updateMember } from '@/app/(protected)/admin/settings/departments/actions'
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
import { updateDepartmentMemberSchema } from '@/lib/types/schemas'
import type { DepartmentMember, Position } from '@/lib/types/departments'

const NONE_VALUE = '__none__'

interface EditMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: DepartmentMember
  departmentMembers: DepartmentMember[]
  positions: Position[]
  onSuccess: () => void
}

type EditMemberFormValues = {
  position_id: string | null
  reports_to_user_id: string | null
  is_department_head: boolean
}

export function EditMemberDialog({
  open,
  onOpenChange,
  member,
  departmentMembers,
  positions,
  onSuccess,
}: EditMemberDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availableManagers = useMemo(
    () => departmentMembers.filter((candidate) => candidate.user_id !== member.user_id),
    [departmentMembers, member.user_id]
  )

  const form = useForm<EditMemberFormValues>({
    resolver: zodResolver(updateDepartmentMemberSchema) as unknown as Resolver<EditMemberFormValues>,
    defaultValues: {
      position_id: member.position_id,
      reports_to_user_id: member.reports_to_user_id,
      is_department_head: member.is_department_head,
    },
  })

  useEffect(() => {
    if (!open) return

    form.reset({
      position_id: member.position_id,
      reports_to_user_id: member.reports_to_user_id,
      is_department_head: member.is_department_head,
    })
    setError(null)
  }, [form, member, open])

  async function onSubmit(values: EditMemberFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await updateMember(member.id, values)
      if (!result.success) {
        throw new Error(result.error || 'Не удалось обновить назначение')
      }

      toast.success('Назначение сотрудника обновлено')
      onOpenChange(false)
      onSuccess()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось обновить назначение')
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
          <DialogTitle>Редактировать назначение</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Сотрудник: {member.user?.full_name || 'Пользователь'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                      {availableManagers.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.user_id}>
                          {candidate.user?.full_name || 'Пользователь'}
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
                    <p className="text-xs text-[#6B7280]">Назначить сотрудника руководителем отдела.</p>
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
