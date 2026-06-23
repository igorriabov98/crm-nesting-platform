"use client"

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createProductProjectWithPhoto, updateProductProject } from '@/lib/actions/products'
import { ROUTES } from '@/lib/constants/routes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Client, ProductProject, UserSummary } from '@/lib/types'
import type { ProductProjectInput } from '@/lib/types/schemas'

type ProjectState = {
  title: string
  client_id: string
  description: string
  characteristics: string
  client_wishes: string
  assigned_engineer_id: string
  status: ProductProjectInput['status']
}

function initialState(project?: ProductProject | null): ProjectState {
  return {
    title: project?.title || '',
    client_id: project?.client_id || 'none',
    description: project?.description || '',
    characteristics: project?.characteristics || '',
    client_wishes: project?.client_wishes || '',
    assigned_engineer_id: project?.assigned_engineer_id || '',
    status: project?.status || 'new_project',
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

const statusLabels: Record<ProductProjectInput['status'], string> = {
  new_project: 'Новый проект',
  draft: 'Черновик',
  engineering: 'В работе у инженера',
  client_review: 'На согласовании',
  approved: 'Подтвержден',
  added_to_products: 'Добавлен в продукцию',
  cancelled: 'Отменен',
}

export function ProductProjectForm({
  project,
  clients,
  engineers,
}: {
  project?: ProductProject | null
  clients: Pick<Client, 'id' | 'name'>[]
  engineers: UserSummary[]
}) {
  const router = useRouter()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<ProjectState>(() => initialState(project))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEdit = Boolean(project?.id)
  const selectedClientLabel = values.client_id === 'none'
    ? 'Без клиента'
    : clients.find((client) => client.id === values.client_id)?.name || 'Выберите клиента'
  const selectedEngineerLabel = engineers.find((engineer) => engineer.id === values.assigned_engineer_id)?.full_name || 'Выберите инженера'

  function setField<K extends keyof ProjectState>(field: K, value: ProjectState[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const payload: ProductProjectInput = {
        title: values.title,
        client_id: values.client_id === 'none' ? null : values.client_id,
        description: values.description,
        characteristics: values.characteristics,
        client_wishes: values.client_wishes,
        assigned_engineer_id: values.assigned_engineer_id,
        status: values.status,
      }
      const result = isEdit && project
        ? await updateProductProject(project.id, payload)
        : await createProjectWithPhoto(payload, photoInputRef.current?.files?.[0] || null)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить проект')
      toast.success(isEdit ? 'Проект обновлен' : 'Проект создан')
      const createdProject = 'project' in result ? result.project as { id?: string } | null : null
      if (!isEdit && createdProject?.id) {
        router.push(`${ROUTES.PRODUCT_PROJECTS}/${createdProject.id}`)
      } else {
        router.refresh()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function createProjectWithPhoto(payload: ProductProjectInput, photo: File | null) {
    const formData = new FormData()
    formData.append('title', payload.title)
    if (payload.client_id) formData.append('client_id', payload.client_id)
    formData.append('description', payload.description || '')
    formData.append('characteristics', payload.characteristics || '')
    formData.append('client_wishes', payload.client_wishes || '')
    formData.append('assigned_engineer_id', payload.assigned_engineer_id)
    formData.append('status', payload.status)
    if (photo) formData.append('photo', photo)

    return createProductProjectWithPhoto(formData)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-xl border border-[#E8ECF0] bg-white p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="title">Название проекта *</Label>
          <Input id="title" value={values.title} onChange={(event) => setField('title', event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Клиент</Label>
          <Select value={values.client_id} onValueChange={(value) => setField('client_id', value || 'none')}>
            <SelectTrigger className="w-full">
              <SelectValue>{selectedClientLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Без клиента</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Инженер *</Label>
          <Select value={values.assigned_engineer_id} onValueChange={(value) => setField('assigned_engineer_id', value || '')}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Выберите инженера">{selectedEngineerLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {engineers.map((engineer) => (
                <SelectItem key={engineer.id} value={engineer.id}>{engineer.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Статус</Label>
          <Select value={values.status} onValueChange={(value) => setField('status', (value || 'draft') as ProductProjectInput['status'])}>
            <SelectTrigger className="w-full">
              <SelectValue>{statusLabels[values.status]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!isEdit && (
        <div className="space-y-2">
          <Label htmlFor="project_photo">Фото изделия</Label>
          <Input
            id="project_photo"
            ref={photoInputRef}
            type="file"
            accept="image/*"
            disabled={isSubmitting}
          />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="description">Описание продукта</Label>
          <Textarea id="description" rows={5} value={values.description} onChange={(event) => setField('description', event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="characteristics">Характеристики</Label>
          <Textarea id="characteristics" rows={5} value={values.characteristics} onChange={(event) => setField('characteristics', event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="client_wishes">Пожелания клиента</Label>
          <Textarea id="client_wishes" rows={5} value={values.client_wishes} onChange={(event) => setField('client_wishes', event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.push(ROUTES.PRODUCT_PROJECTS)} disabled={isSubmitting}>
          Отмена
        </Button>
        <LoadingButton type="submit" loading={isSubmitting} className="bg-[#1B3A6B] text-white hover:bg-[#152D54]">
          {isEdit ? 'Сохранить' : 'Создать проект'}
        </LoadingButton>
      </div>
    </form>
  )
}
