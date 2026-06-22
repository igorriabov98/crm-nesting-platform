'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { createPosition, updatePosition } from '@/app/(protected)/admin/settings/departments/actions'
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
import { POSITION_LEVEL_OPTIONS } from '@/lib/constants/departments'
import { createPositionSchema, updatePositionSchema } from '@/lib/types/schemas'
import type { Position } from '@/lib/types/departments'

interface PositionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  position?: Position
  onSuccess: () => void
}

type PositionFormValues = {
  name: string
  level: number
  description: string
}

export function PositionDialog({
  open,
  onOpenChange,
  position,
  onSuccess,
}: PositionDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const schema = position ? updatePositionSchema : createPositionSchema

  const form = useForm<PositionFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PositionFormValues>,
    defaultValues: {
      name: position?.name || '',
      level: position?.level ?? 0,
      description: position?.description || '',
    },
  })

  useEffect(() => {
    if (!open) return

    form.reset({
      name: position?.name || '',
      level: position?.level ?? 0,
      description: position?.description || '',
    })
    setError(null)
  }, [form, open, position])

  async function onSubmit(values: PositionFormValues) {
    setIsSubmitting(true)
    setError(null)

    try {
      const description = values.description.trim()
      const result = position
        ? await updatePosition(position.id, {
            name: values.name,
            level: values.level,
            description: description || null,
          })
        : await createPosition({
            name: values.name,
            level: values.level,
            description: description || undefined,
          })

      if (!result.success) {
        throw new Error(result.error || 'Не удалось сохранить должность')
      }

      toast.success(position ? 'Должность обновлена' : 'Должность создана')
      onOpenChange(false)
      onSuccess()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось сохранить должность')
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
          <DialogTitle>{position ? 'Редактировать должность' : 'Добавить должность'}</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            {position
              ? 'Измените название, уровень или описание должности.'
              : 'Заполните данные новой должности.'}
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
                      placeholder="Например, Начальник цеха"
                      className="border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]"
                    />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="level"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Уровень</FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(value) => field.onChange(Number(value))}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]">
                        <SelectValue placeholder="Выберите уровень" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="border-[#E8ECF0] bg-white text-[#1B3A6B]">
                      {POSITION_LEVEL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={String(option.value)}>
                          {option.label}
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[#374151]">Описание</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      placeholder="Краткое описание обязанностей"
                      className="resize-none border-[#E8ECF0] bg-[#F8F9FA] text-[#1B3A6B]"
                    />
                  </FormControl>
                  <FormMessage className="text-[#DC2626]" />
                </FormItem>
              )}
            />

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-[#DC2626]">
                {error}
              </div>
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
                {isSubmitting ? 'Сохранение...' : position ? 'Сохранить' : 'Добавить'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
