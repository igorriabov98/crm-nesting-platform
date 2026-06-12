'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LoadingButton } from '@/components/ui/loading-button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, RefreshCw, Trash2, Bot, Pencil, MoveRight, CheckCircle2, CalendarDays, ClipboardCheck } from 'lucide-react'

import {
  addAgendaItem,
  checkNewMachineFromAgenda,
  moveAgendaItem,
  planMaterialFromAgenda,
  removeAgendaItem,
  regenerateAgenda,
  resolveAgendaItem,
  type AgendaPoolMeetingOption,
} from '@/app/(protected)/meetings/actions'
import { MATERIAL_TYPES, MEETING_TYPES } from '@/lib/constants/meetings'
import { getFactoryWorkshopOptionsById } from '@/lib/constants/factory-workshops'
import { getDesiredShippingInfo } from '@/lib/utils/desired-shipping'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import type { FactorySummary, MeetingAgendaItem, MeetingDetails, MaterialType } from '@/lib/types'

interface MeetingAgendaProps {
  meeting: MeetingDetails
  factories: FactorySummary[]
  meetingOptions: AgendaPoolMeetingOption[]
  isDirector: boolean
  currentUser: unknown
}

function formatMeetingOption(meetingOption: AgendaPoolMeetingOption) {
  const date = new Date(meetingOption.meeting_date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
  const meetingName =
    meetingOption.title?.trim() ||
    meetingOption.meeting_type_label ||
    MEETING_TYPES[meetingOption.meeting_type as keyof typeof MEETING_TYPES]?.label ||
    'Собрание'

  return `${date} ${meetingOption.meeting_time.slice(0, 5)} - ${meetingName}`
}

export function MeetingAgenda({ meeting, factories, meetingOptions, isDirector }: MeetingAgendaProps) {
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({})
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [resolveItem, setResolveItem] = useState<MeetingAgendaItem | null>(null)
  const [materialPlanItem, setMaterialPlanItem] = useState<MeetingAgendaItem | null>(null)
  const [machineCheckItem, setMachineCheckItem] = useState<MeetingAgendaItem | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [decisionText, setDecisionText] = useState('')
  const [selectedFactory, setSelectedFactory] = useState('')
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialType | ''>('')
  const [plannedMaterialDate, setPlannedMaterialDate] = useState('')
  const [plannedMaterialType, setPlannedMaterialType] = useState<MaterialType | ''>('')
  const [closeMaterialItem, setCloseMaterialItem] = useState(false)
  const [checkFactory, setCheckFactory] = useState('')
  const [checkWorkshop, setCheckWorkshop] = useState('')
  const [closeCheckedItem, setCloseCheckedItem] = useState(false)
  const [agendaActionId, setAgendaActionId] = useState<string | null>(null)

  const autoItems = meeting.agenda?.filter((i) => i.auto_generated) || []
  const manualItems = meeting.agenda?.filter((i) => !i.auto_generated) || []

  const handleRegenerate = async () => {
    if (!confirm('Перегенерировать автоматические пункты повестки?')) return
    setIsRegenerating(true)
    try {
      const res = await regenerateAgenda(meeting.id)
      if (res.success) toast.success('Повестка обновлена')
      else toast.error(res.error)
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleAddItem = async () => {
    if (!newTitle.trim()) return
    setIsAdding(true)
    try {
      const res = await addAgendaItem(meeting.id, { title: newTitle, description: newDesc })
      if (res.success) {
        toast.success('Пункт добавлен')
        setNewTitle('')
        setNewDesc('')
        setAddItemOpen(false)
      } else toast.error(res.error)
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    try {
      const res = await removeAgendaItem(id, meeting.id)
      if (res.success) toast.success('Пункт удалён')
      else toast.error(res.error)
    } finally {
      setRemovingId(null)
    }
  }

  const getResolutionType = (item: MeetingAgendaItem) => {
    const sourceType = item.source_type || ''
    const title = item.title.toLowerCase()
    return {
      needsFactory: sourceType === 'machine_without_factory' || title.includes('завод'),
      needsMaterial: sourceType === 'material_undefined' || title.includes('материал'),
    }
  }

  const openResolveDialog = (item: MeetingAgendaItem) => {
    const resolutionType = getResolutionType(item)
    setResolveItem(item)
    setDecisionText(
      resolutionType.needsFactory
        ? 'Назначен завод'
        : resolutionType.needsMaterial
          ? 'Определён тип материала'
          : 'Пункт повестки решён'
    )
    setSelectedFactory('')
    setSelectedMaterial('')
  }

  const openMaterialPlanDialog = (item: MeetingAgendaItem) => {
    setMaterialPlanItem(item)
    setPlannedMaterialDate(item.machine?.planned_material_date || '')
    setPlannedMaterialType(
      item.machine?.material_type && item.machine.material_type !== 'undefined'
        ? item.machine.material_type
        : ''
    )
    setCloseMaterialItem(false)
  }

  const openMachineCheckDialog = (item: MeetingAgendaItem) => {
    setMachineCheckItem(item)
    const factoryId = item.machine?.factory_id || ''
    setCheckFactory(factoryId)
    setCheckWorkshop(item.machine?.production_workshop ? String(item.machine.production_workshop) : '')
    setCloseCheckedItem(false)
  }

  const getWorkshopOptions = (factoryId: string) => getFactoryWorkshopOptionsById(factories, factoryId || null)
  const getFactoryLabel = (factoryId: string) => factories.find((factory) => factory.id === factoryId)?.name || ''
  const getWorkshopLabel = (factoryId: string, workshop: string) => {
    if (!workshop) return ''
    return getWorkshopOptions(factoryId).find((option) => String(option.value) === workshop)?.label || `Цех ${workshop}`
  }

  const updateCheckFactory = (factoryId: string | null) => {
    if (!factoryId) {
      setCheckFactory('')
      setCheckWorkshop('')
      return
    }
    setCheckFactory(factoryId)
    const options = getWorkshopOptions(factoryId)
    setCheckWorkshop((current) => {
      if (current && options.some((option) => String(option.value) === current)) return current
      return options.length === 1 ? String(options[0].value) : ''
    })
  }

  const handleResolve = async () => {
    if (!resolveItem) return
    const resolutionType = getResolutionType(resolveItem)
    if (!decisionText.trim()) return
    if (resolutionType.needsFactory && !selectedFactory) {
      toast.error('Выберите завод')
      return
    }
    if (resolutionType.needsMaterial && !selectedMaterial) {
      toast.error('Выберите тип материала')
      return
    }

    setResolvingId(resolveItem.id)
    try {
      const res = await resolveAgendaItem(meeting.id, resolveItem.id, {
        decision_text: decisionText,
        machine_id: resolveItem.machine_id || resolveItem.machine?.id,
        assigned_factory_id: selectedFactory || undefined,
        assigned_material_type: selectedMaterial || undefined,
      })
      if (res.success) {
        toast.success('Пункт повестки решён')
        setResolveItem(null)
      } else {
        toast.error(res.error)
      }
    } finally {
      setResolvingId(null)
    }
  }

  const handlePlanMaterial = async () => {
    if (!materialPlanItem?.machine) return
    if (!plannedMaterialDate) {
      toast.error('Выберите дату поставки материала')
      return
    }
    if (!plannedMaterialType) {
      toast.error('Выберите тип материала')
      return
    }

    setAgendaActionId(materialPlanItem.id)
    try {
      const res = await planMaterialFromAgenda(meeting.id, materialPlanItem.id, {
        machine_id: materialPlanItem.machine.id,
        planned_material_date: plannedMaterialDate,
        material_type: plannedMaterialType,
        close_agenda_item: closeMaterialItem,
      })
      if (res.success) {
        toast.success(closeMaterialItem ? 'Материал запланирован, пункт закрыт' : 'Материал запланирован')
        setMaterialPlanItem(null)
      } else {
        toast.error(res.error)
      }
    } finally {
      setAgendaActionId(null)
    }
  }

  const handleCheckNewMachine = async () => {
    if (!machineCheckItem?.machine) return
    if (!checkFactory) {
      toast.error('Выберите завод')
      return
    }

    setAgendaActionId(machineCheckItem.id)
    try {
      const res = await checkNewMachineFromAgenda(meeting.id, machineCheckItem.id, {
        machine_id: machineCheckItem.machine.id,
        factory_id: checkFactory,
        production_workshop: checkWorkshop ? Number(checkWorkshop) : null,
        close_agenda_item: closeCheckedItem,
      })
      if (res.success) {
        toast.success(closeCheckedItem ? 'Машина проверена, пункт закрыт' : 'Проверка сохранена')
        setMachineCheckItem(null)
      } else {
        toast.error(res.error)
      }
    } finally {
      setAgendaActionId(null)
    }
  }

  const handleMove = async (id: string) => {
    const targetMeetingId = moveTargets[id] || meetingOptions[0]?.id
    if (!targetMeetingId) {
      toast.error('Нет другого запланированного собрания')
      return
    }

    setMovingId(id)
    try {
      const res = await moveAgendaItem(id, meeting.id, targetMeetingId)
      if (res.success) toast.success('Пункт перенесён в другое собрание')
      else toast.error(res.error)
    } finally {
      setMovingId(null)
    }
  }

  const renderMoveControl = (item: MeetingAgendaItem) => {
    if (!isDirector || meeting.status !== 'planned' || meetingOptions.length === 0) return null
    const selectedTarget = moveTargets[item.id] || meetingOptions[0]?.id

    return (
      <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end xl:w-auto xl:max-w-[560px]">
        <Select
          value={selectedTarget}
          onValueChange={(value) => {
            if (value) setMoveTargets((current) => ({ ...current, [item.id]: value }))
          }}
          disabled={movingId === item.id}
        >
          <SelectTrigger className="h-9 w-full min-w-0 sm:w-[360px]">
            <SelectValue placeholder="Куда перенести" />
          </SelectTrigger>
          <SelectContent align="end" className="w-[min(420px,calc(100vw-2rem))]">
            {meetingOptions.map((option) => (
              <SelectItem key={option.id} value={option.id} className="min-w-0">
                {formatMeetingOption(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LoadingButton
          variant="outline"
          size="sm"
          loading={movingId === item.id}
          onClick={() => handleMove(item.id)}
          className="shrink-0"
        >
          <MoveRight className="w-3 h-3 mr-1.5" />
          Перенести
        </LoadingButton>
      </div>
    )
  }

  const renderResolveControl = (item: MeetingAgendaItem) => {
    if (item.resolved_at) {
      return (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Решено
        </Badge>
      )
    }
    if (!isDirector || meeting.status !== 'planned') return null

    if (item.source_type === 'factory_missing_material_date') {
      return (
        <LoadingButton
          variant="outline"
          size="sm"
          loading={agendaActionId === item.id}
          onClick={() => openMaterialPlanDialog(item)}
          className="shrink-0 border-blue-600 text-blue-700 hover:bg-blue-50"
        >
          <CalendarDays className="w-3 h-3 mr-1.5" />
          Запланировать
        </LoadingButton>
      )
    }

    if (item.source_type === 'factory_new_machine') {
      return (
        <LoadingButton
          variant="outline"
          size="sm"
          loading={agendaActionId === item.id}
          onClick={() => openMachineCheckDialog(item)}
          className="shrink-0 border-amber-600 text-amber-700 hover:bg-amber-50"
        >
          <ClipboardCheck className="w-3 h-3 mr-1.5" />
          Проверка
        </LoadingButton>
      )
    }

    return (
      <LoadingButton
        variant="outline"
        size="sm"
        loading={resolvingId === item.id}
        onClick={() => openResolveDialog(item)}
        className="shrink-0 border-emerald-600 text-emerald-700 hover:bg-emerald-50"
      >
        <CheckCircle2 className="w-3 h-3 mr-1.5" />
        Решить
      </LoadingButton>
    )
  }

  const renderMachineItemsTable = (items: NonNullable<MeetingAgendaItem['machine']>['machine_items'] = [], emptyLabel: string) => {
    const sortedItems = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const totalWeight = sortedItems.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.quantity || 0), 0)

    return (
      <div className="overflow-hidden rounded-lg border border-[#E8ECF0]">
        <table className="w-full text-sm">
          <thead className="bg-[#F8F9FA] text-xs text-[#6B7280]">
            <tr>
              <th className="px-3 py-2 text-left">Чертёж</th>
              <th className="px-3 py-2 text-left">Наименование</th>
              <th className="px-3 py-2 text-right">Вес ед.</th>
              <th className="px-3 py-2 text-center">Кол-во</th>
              <th className="px-3 py-2 text-right">Тоннаж</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[#9CA3AF]">{emptyLabel}</td>
              </tr>
            ) : (
              sortedItems.map((item, index) => {
                const itemWeight = Number(item.weight || 0) * Number(item.quantity || 0)
                return (
                  <tr key={item.id || index} className="border-t border-[#E8ECF0]">
                    <td className="px-3 py-2 font-medium text-[#374151]">{item.drawing_number}</td>
                    <td className="px-3 py-2 text-[#374151]">{item.product_name}</td>
                    <td className="px-3 py-2 text-right text-[#374151]">{Number(item.weight || 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-center text-[#374151]">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-medium text-[#1B3A6B]">{(itemWeight / 1000).toFixed(2)} т</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        <div className="flex justify-end gap-4 border-t border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm">
          <span>{sortedItems.length} поз.</span>
          <span className="font-medium text-[#1B3A6B]">{(totalWeight / 1000).toFixed(2)} т</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      
      {/* Автоматические пункты */}
      {autoItems.length > 0 && (
        <Card className="p-4 border-[#E8ECF0] bg-blue-50/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[#1B3A6B] font-semibold">
              <Bot className="w-4 h-4" />
              Автоматические пункты ({autoItems.length})
            </div>
            {isDirector && meeting.status === 'planned' && (
              <LoadingButton variant="outline" size="sm" onClick={handleRegenerate} loading={isRegenerating}>
                <RefreshCw className={`w-3 h-3 mr-1.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                Обновить
              </LoadingButton>
            )}
          </div>

          <div className="space-y-3">
            {autoItems.map((item: MeetingAgendaItem, idx: number) => (
              <div key={item.id} className="bg-white border border-[#E8ECF0] rounded-lg p-4 hover:border-[#1B3A6B]/30 transition">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-[#9CA3AF] tabular-nums">{idx + 1}.</span>
                      <span className="font-semibold text-[#1B3A6B] text-sm">{item.title}</span>
                    </div>
                    
                    {item.description && (
                      <p className="text-xs text-[#6B7280] ml-5 mb-2">{item.description}</p>
                    )}

                    {/* Детали машины если есть */}
                    {item.machine && (
                      <div className="ml-5 flex flex-wrap gap-3 text-xs text-[#374151]">
                        {item.machine.item_count !== undefined && (
                          <span className="bg-gray-100 px-2 py-0.5 rounded">Товаров: {item.machine.item_count}</span>
                        )}
                        {item.machine.total_weight !== undefined && (
                          <span className="bg-gray-100 px-2 py-0.5 rounded">Вес: {item.machine.total_weight.toFixed(1)} т</span>
                        )}
                        {item.machine.total_cost !== undefined && (
                          <span className="bg-gray-100 px-2 py-0.5 rounded">€{item.machine.total_cost.toLocaleString()}</span>
                        )}
                        <span className={`px-2 py-0.5 rounded ${item.machine.material_type === 'undefined' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                          {MATERIAL_TYPES[item.machine.material_type as keyof typeof MATERIAL_TYPES]?.label || 'Не определён'}
                        </span>
                        {(() => {
                          const deadline = getDesiredShippingInfo(item.machine.desired_shipping_date)
                          if (!deadline) return null
                          return (
                            <span className={`px-2 py-0.5 rounded ${deadline.tone === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                              Желаемая отгрузка: {deadline.shortDate} ({deadline.label})
                            </span>
                          )
                        })()}
                      </div>
                    )}
                  </div>

                  <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end xl:ml-3 xl:w-auto xl:shrink-0">
                    {renderResolveControl(item)}
                    {renderMoveControl(item)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {autoItems.length === 0 && (
        <Card className="p-6 border-dashed border-2 border-[#E8ECF0] text-center">
          <Bot className="w-8 h-8 text-[#9CA3AF] mx-auto mb-2" />
          <p className="text-sm text-[#6B7280]">Автоматические пункты не сформированы</p>
          {isDirector && (
            <LoadingButton variant="outline" size="sm" className="mt-3" onClick={handleRegenerate} loading={isRegenerating}>
              <RefreshCw className={`w-3 h-3 mr-1.5 ${isRegenerating ? 'animate-spin' : ''}`} /> Сформировать
            </LoadingButton>
          )}
        </Card>
      )}

      {/* Ручные пункты */}
      {manualItems.length > 0 && (
        <Card className="p-4 border-[#E8ECF0]">
          <div className="flex items-center gap-2 text-[#1B3A6B] font-semibold mb-4">
            <Pencil className="w-4 h-4" /> Ручные пункты ({manualItems.length})
          </div>
          <div className="space-y-2">
            {manualItems.map((item: MeetingAgendaItem, idx: number) => (
              <div key={item.id} className="flex flex-wrap items-start gap-3 border rounded-lg p-3">
                <span className="text-xs font-bold text-[#9CA3AF] tabular-nums mt-0.5">{autoItems.length + idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-[#374151]">{item.title}</p>
                  {item.description && <p className="text-xs text-[#6B7280] mt-0.5">{item.description}</p>}
                </div>
                {item.resolved_at && meeting.status !== 'planned' && renderResolveControl(item)}
                {isDirector && meeting.status === 'planned' && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {renderResolveControl(item)}
                    {renderMoveControl(item)}
                    <LoadingButton variant="ghost" size="icon" loading={removingId === item.id} className="text-red-500 hover:text-red-700 h-7 w-7 shrink-0" onClick={() => handleRemove(item.id)}>
                      <Trash2 className="w-3 h-3" />
                    </LoadingButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Кнопки добавления */}
      {isDirector && meeting.status === 'planned' && (
        <Button variant="outline" className="w-full border-dashed text-[#6B7280] hover:border-[#1B3A6B] hover:text-[#1B3A6B]" onClick={() => setAddItemOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Добавить пункт повестки
        </Button>
      )}

      {/* Диалог добавления ручного пункта */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Добавить пункт повестки</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Заголовок *</Label>
              <Input className="mt-1.5" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Обсудить нового поставщика..." />
            </div>
            <div>
              <Label>Описание (опционально)</Label>
              <Textarea className="mt-1.5" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Дополнительные детали..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>Отмена</Button>
            <LoadingButton className="bg-[#1B3A6B] text-white" onClick={handleAddItem} loading={isAdding} disabled={!newTitle.trim()}>Добавить</LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!materialPlanItem} onOpenChange={(open) => !open && setMaterialPlanItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Запланировать материал</DialogTitle>
          </DialogHeader>

          {materialPlanItem?.machine && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                <div className="text-sm font-semibold text-[#1B3A6B]">{materialPlanItem.machine.name}</div>
                <div className="mt-1 text-xs text-[#6B7280]">{materialPlanItem.title}</div>
              </div>

              <div>
                <Label>Дата поставки материала *</Label>
                <Input
                  type="date"
                  className="mt-1.5"
                  value={plannedMaterialDate}
                  onChange={(event) => setPlannedMaterialDate(event.target.value)}
                />
              </div>

              <div>
                <Label>Тип материала *</Label>
                <Select value={plannedMaterialType} onValueChange={(value) => value && setPlannedMaterialType(value as MaterialType)}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Выберите тип материала" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MATERIAL_TYPES)
                      .filter(([key]) => key !== 'undefined')
                      .map(([key, value]) => (
                        <SelectItem key={key} value={key}>{value.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-[#E8ECF0] bg-white p-3 text-sm text-[#374151]">
                <Checkbox checked={closeMaterialItem} onCheckedChange={(checked) => setCloseMaterialItem(checked === true)} />
                Закрыть пункт повестки
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMaterialPlanItem(null)} disabled={!!agendaActionId}>Отмена</Button>
            <LoadingButton
              className="bg-[#1B3A6B] text-white"
              loading={!!materialPlanItem && agendaActionId === materialPlanItem.id}
              onClick={handlePlanMaterial}
              disabled={!plannedMaterialDate || !plannedMaterialType}
            >
              Сохранить
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!machineCheckItem} onOpenChange={(open) => !open && setMachineCheckItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Проверка новой машины</DialogTitle>
          </DialogHeader>

          {machineCheckItem?.machine && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                <div className="text-sm font-semibold text-[#1B3A6B]">{machineCheckItem.machine.name}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#374151]">
                  <span className="rounded bg-white px-2 py-1">Всего позиций: {machineCheckItem.machine.machine_items?.length || 0}</span>
                  <span className="rounded bg-white px-2 py-1">Тоннаж: {Number(machineCheckItem.machine.total_weight || 0).toFixed(2)} т</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                <div className="min-w-0">
                  <Label>Завод *</Label>
                  <Select value={checkFactory} onValueChange={updateCheckFactory}>
                    <SelectTrigger className="mt-1.5 h-10 w-full min-w-0">
                      <span className="block min-w-0 flex-1 truncate text-left">
                        {getFactoryLabel(checkFactory) || 'Выберите завод'}
                      </span>
                    </SelectTrigger>
                    <SelectContent align="start" className="w-[min(420px,calc(100vw-2rem))]">
                      {factories.map((factory) => (
                        <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0">
                  <Label>Цех</Label>
                  <Select value={checkWorkshop} onValueChange={(value) => setCheckWorkshop(value || '')} disabled={!checkFactory || getWorkshopOptions(checkFactory).length === 0}>
                    <SelectTrigger className="mt-1.5 h-10 w-full min-w-0">
                      <span className="block min-w-0 flex-1 truncate text-left">
                        {getWorkshopLabel(checkFactory, checkWorkshop) || 'Выберите цех'}
                      </span>
                    </SelectTrigger>
                    <SelectContent align="end" className="w-[180px]">
                      {getWorkshopOptions(checkFactory).map((option) => (
                        <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[#1B3A6B]">Товары</h4>
                  {renderMachineItemsTable((machineCheckItem.machine.machine_items || []).filter((item) => !item.is_sample), 'Товары не добавлены')}
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[#1B3A6B]">Образцы</h4>
                  {renderMachineItemsTable((machineCheckItem.machine.machine_items || []).filter((item) => item.is_sample), 'Образцы не добавлены')}
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-[#E8ECF0] bg-white p-3 text-sm text-[#374151]">
                <Checkbox checked={closeCheckedItem} onCheckedChange={(checked) => setCloseCheckedItem(checked === true)} />
                Проверено
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMachineCheckItem(null)} disabled={!!agendaActionId}>Отмена</Button>
            <LoadingButton
              className="bg-[#1B3A6B] text-white"
              loading={!!machineCheckItem && agendaActionId === machineCheckItem.id}
              onClick={handleCheckNewMachine}
              disabled={!checkFactory}
            >
              Сохранить проверку
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveItem} onOpenChange={(open) => !open && setResolveItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Решить пункт повестки</DialogTitle>
          </DialogHeader>

          {resolveItem && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] p-3">
                <div className="text-sm font-semibold text-[#1B3A6B]">{resolveItem.title}</div>
                {resolveItem.machine && (
                  <div className="mt-1 text-xs text-[#6B7280]">Машина: {resolveItem.machine.name}</div>
                )}
              </div>

              <div>
                <Label>Решение *</Label>
                <Textarea
                  className="mt-1.5"
                  value={decisionText}
                  onChange={(event) => setDecisionText(event.target.value)}
                  rows={2}
                />
              </div>

              {getResolutionType(resolveItem).needsFactory && (
                <div>
                  <Label>Завод *</Label>
                  <Select value={selectedFactory} onValueChange={(value) => setSelectedFactory(value ?? '')}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Выберите завод" />
                    </SelectTrigger>
                    <SelectContent>
                      {factories.map((factory) => (
                        <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {getResolutionType(resolveItem).needsMaterial && (
                <div>
                  <Label>Тип материала *</Label>
                  <Select value={selectedMaterial} onValueChange={(value) => value && setSelectedMaterial(value as MaterialType)}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Выберите тип материала" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MATERIAL_TYPES)
                        .filter(([key]) => key !== 'undefined')
                        .map(([key, value]) => (
                          <SelectItem key={key} value={key}>{value.label}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveItem(null)} disabled={!!resolvingId}>Отмена</Button>
            <LoadingButton
              className="bg-[#1B3A6B] text-white"
              loading={!!resolveItem && resolvingId === resolveItem.id}
              onClick={handleResolve}
              disabled={!decisionText.trim()}
            >
              Сохранить решение
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
