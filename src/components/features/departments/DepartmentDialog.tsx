'use client'

import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { createDepartment, updateDepartment } from '@/app/(protected)/admin/settings/departments/actions'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createDepartmentSchema, updateDepartmentSchema } from '@/lib/types/schemas'
import { wouldCreateCycle } from '@/lib/utils/org-tree'
import type { Department } from '@/lib/types/departments'

const NONE_VALUE = '__none__'

interface DepartmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  department?: Department
  parentId?: string
  departments: Department[]
  users: { id: string; full_name: string }[]
  factories: { id: string; name: string }[]
  onSuccess: () => void
}

type DepartmentFormValues = {
  name: string
  description: string
  parent_id: string | null
  head_user_id: string | null
  factory_id: string | null
  sort_order: number
}

export function DepartmentDialog({
  open,
  onOpenChange,
  department,
  parentId,
  departments,
  users,
  factories,
  onSuccess,
}: DepartmentDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const schema = department ? updateDepartmentSchema : createDepartmentSchema
  const parentDepartment = parentId
    ? departments.find((item) => item.id === parentId)
    : undefined

  const availableParents = useMemo(() => {
    if (!department) return departments
    return departments.filter(
      (candidate) => !wouldCreateCycle(departments, department.id, candidate.id)
    )
  }, [department, departments])

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<DepartmentFormValues>,
    defaultValues: {
      name: department?.name || '',
      description: department?.description || '',
      parent_id: department?.parent_id ?? parentId ?? null,
      head_user_id: department?.head_user_id ?? null,
      factory_id: department?.factory_id ?? null,
      sort_order: department?.sort_order ?? 0,
    },
  })

  useEffect(() => {
    if (!open) return

    form.reset({
      name: department?.name || '',
      description: department?.description || '',
      parent_id: department?.parent_id ?? parentId ?? null,
      head_user_id: department?.head_user_id ?? null,
      factory_id: department?.factory_id ?? null,
      sort_order: department?.sort_order ?? 0,
    })
    setError(null)
  }, [department, form, open, parentId])

  async function onSubmit(values: DepartmentFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const description = values.description.trim()
      const result = department
        ? await updateDepartment(department.id, {
            name: values.name,
            description: description || null,
            parent_id: values.parent_id,
            head_user_id: values.head_user_id,
            factory_id: values.factory_id,
            sort_order: values.sort_order,
          })
        : await createDepartment({
            name: values.name,
            description: description || undefined,
            parent_id: values.parent_id,
            head_user_id: values.head_user_id,
            factory_id: values.factory_id,
            sort_order: values.sort_order,
          })

      if (!result.success) {
        throw new Error(result.error || 'Не удалось сохранить отдел')
      }

      toast.success(department ? 'Отдел обновлён' : 'Отдел создан')
      onOpenChange(false)
      onSuccess()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось сохранить отдел')
    } finally {
      setIsSubmitting(false)
    }
  }

  const title = department
    ? 'Редактировать отдел'
    : parentDepartment
      ? `Новый подотдел в ${parentDepartment.name}`
      : 'Создать отдел'

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[#E8ECF0] bg-white text-[#1B3A6B] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Настройте положение отдела, руководителя и привязку к заводу.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Название</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Например, Производственный отдел"
                      className="border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]"
                    />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Описание</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Назначение и зона ответственности отдела"
                      className="resize-none border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]"
                    />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="parent_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Родительский отдел</FormLabel>
                  <Select
                    value={field.value ?? NONE_VALUE}
                    onValueChange={(value) => field.onChange(value === NONE_VALUE ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите родительский отдел" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      <SelectItem value={NONE_VALUE}>Корневой отдел</SelectItem>
                      {availableParents.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="head_user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Начальник отдела</FormLabel>
                  <Select
                    value={field.value ?? NONE_VALUE}
                    onValueChange={(value) => field.onChange(value === NONE_VALUE ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите начальника" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      <SelectItem value={NONE_VALUE}>Не назначен</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>{user.full_name}</SelectItem>
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
                  <FormLabel className="text-[#374151]">Завод</FormLabel>
                  <Select
                    value={field.value ?? NONE_VALUE}
                    onValueChange={(value) => field.onChange(value === NONE_VALUE ? null : value)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите завод" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      <SelectItem value={NONE_VALUE}>Без привязки к заводу</SelectItem>
                      {factories.map((factory) => (
                        <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-[#DC2626]" />
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
                {isSubmitting ? 'Сохранение...' : department ? 'Сохранить' : 'Создать'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
