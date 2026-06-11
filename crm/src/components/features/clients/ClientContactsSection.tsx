"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClientContact, deleteClientContact, updateClientContact } from '@/lib/actions/clients'
import type { ClientContactInput } from '@/lib/types/schemas'
import type { ClientContact } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingButton } from '@/components/ui/loading-button'
import { Textarea } from '@/components/ui/textarea'

type ClientContactsSectionProps = {
  clientId: string
  contacts: ClientContact[]
}

const emptyDraft: ClientContactInput = {
  full_name: '',
  phone: '',
  email: '',
  role_description: '',
  notes: '',
}

export function ClientContactsSection({ clientId, contacts }: ClientContactsSectionProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null)
  const [draft, setDraft] = useState<ClientContactInput>(emptyDraft)

  function openCreate() {
    setEditingContact(null)
    setDraft(emptyDraft)
    setIsOpen(true)
  }

  function openEdit(contact: ClientContact) {
    setEditingContact(contact)
    setDraft({
      full_name: contact.full_name || '',
      phone: contact.phone || '',
      email: contact.email || '',
      role_description: contact.role_description || '',
      notes: contact.notes || '',
    })
    setIsOpen(true)
  }

  async function saveContact() {
    setIsSubmitting(true)
    try {
      const result = editingContact
        ? await updateClientContact(clientId, editingContact.id, draft)
        : await createClientContact(clientId, draft)
      if (!result.success) throw new Error(result.error || 'Не удалось сохранить контакт')

      toast.success(editingContact ? 'Контакт обновлен' : 'Контакт добавлен')
      setIsOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Неизвестная ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function removeContact(contact: ClientContact) {
    const result = await deleteClientContact(clientId, contact.id)
    if (!result.success) {
      toast.error(result.error || 'Не удалось удалить контакт')
      return
    }
    toast.success('Контакт удален')
    router.refresh()
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[#1B3A6B]">Дополнительные лица</h2>
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Добавить контакт
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
        {contacts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#9CA3AF]">Дополнительные контактные лица пока не добавлены.</div>
        ) : (
          <div className="divide-y divide-[#E8ECF0]">
            {contacts.map((contact) => (
              <div key={contact.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold text-[#1B3A6B]">{contact.full_name}</div>
                  <div className="text-sm text-[#6B7280]">{contact.role_description || 'Роль не указана'}</div>
                  <div className="mt-1 text-sm text-[#374151]">
                    {[contact.phone, contact.email].filter(Boolean).join(' · ') || 'Контакты не указаны'}
                  </div>
                  {contact.notes && <div className="mt-1 text-xs text-[#6B7280]">{contact.notes}</div>}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(contact)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => removeContact(contact)}>
                    <Trash2 className="h-4 w-4 text-[#DC2626]" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingContact ? 'Редактировать контакт' : 'Новый контакт'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <ContactField label="ФИО *" value={draft.full_name} onChange={(value) => setDraft((current) => ({ ...current, full_name: value }))} />
            <ContactField label="Должность / роль" value={draft.role_description || ''} onChange={(value) => setDraft((current) => ({ ...current, role_description: value }))} />
            <div className="grid gap-4 md:grid-cols-2">
              <ContactField label="Телефон" value={draft.phone || ''} onChange={(value) => setDraft((current) => ({ ...current, phone: value }))} />
              <ContactField label="Email" value={draft.email || ''} onChange={(value) => setDraft((current) => ({ ...current, email: value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Заметка</Label>
              <Textarea value={draft.notes || ''} rows={3} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setIsOpen(false)}>
              Отмена
            </Button>
            <LoadingButton type="button" loading={isSubmitting} onClick={saveContact}>
              Сохранить
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ContactField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
