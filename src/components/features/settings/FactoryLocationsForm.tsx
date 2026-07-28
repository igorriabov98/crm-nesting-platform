'use client'

import { useState, useTransition } from 'react'
import { Loader2, MapPin, Save } from 'lucide-react'
import { toast } from 'sonner'
import { updateFactoryLocation } from '@/lib/actions/factory-locations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type FactoryLocation = { id: string; name: string; city: string; address: string | null }

export function FactoryLocationsForm({ factories }: { factories: FactoryLocation[] }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(factories.map((item) => [item.id, { city: item.city, address: item.address || '' }])))
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function save(factory: FactoryLocation) {
    const draft = drafts[factory.id]
    setPendingId(factory.id)
    startTransition(async () => {
      const result = await updateFactoryLocation({ id: factory.id, city: draft.city, address: draft.address || null })
      setPendingId(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить площадку')
        return
      }
      toast.success(`Площадка «${factory.name}» сохранена`)
    })
  }

  return <div className="grid gap-4 lg:grid-cols-2">
    {factories.map((factory) => <section key={factory.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-slate-950"><MapPin className="h-4 w-4 text-blue-700" />{factory.name}</div>
      <div className="mt-4 grid gap-3">
        <Label className="grid gap-1.5">Город <span className="sr-only">для {factory.name}</span>
          <Input value={drafts[factory.id].city} onChange={(event) => setDrafts((current) => ({ ...current, [factory.id]: { ...current[factory.id], city: event.target.value } }))} />
        </Label>
        <Label className="grid gap-1.5">Адрес <span className="text-xs font-normal text-slate-500">необязательно</span>
          <Input value={drafts[factory.id].address} onChange={(event) => setDrafts((current) => ({ ...current, [factory.id]: { ...current[factory.id], address: event.target.value } }))} />
        </Label>
        <Button type="button" onClick={() => save(factory)} disabled={isPending || !drafts[factory.id].city.trim()} className="mt-1 w-fit">
          {pendingId === factory.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить
        </Button>
      </div>
    </section>)}
  </div>
}
