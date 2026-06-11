'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, Check, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { LoadingButton } from '@/components/ui/loading-button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildMeetingTypesMap } from '@/lib/constants/meetings'
import {
  assignAgendaPoolItem,
  type AgendaPoolItem,
  type AgendaPoolMeetingOption,
  type MeetingTypeOption,
} from '@/app/(protected)/meetings/actions'

interface AgendaPoolManagerProps {
  items: AgendaPoolItem[]
  meetings: AgendaPoolMeetingOption[]
  meetingTypes: MeetingTypeOption[]
}

function formatMeeting(meeting: AgendaPoolMeetingOption, meetingTypesMap: ReturnType<typeof buildMeetingTypesMap>) {
  const date = new Date(meeting.meeting_date).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const typeLabel = meeting.meeting_type_label || meetingTypesMap[meeting.meeting_type]?.label || 'Собрание'
  return `${date} ${meeting.meeting_time.slice(0, 5)} - ${meeting.title || typeLabel}`
}

export function AgendaPoolManager({ items, meetings, meetingTypes }: AgendaPoolManagerProps) {
  const router = useRouter()
  const nearestMeetingId = meetings[0]?.id || ''
  const [selectedMeetings, setSelectedMeetings] = useState<Record<string, string>>({})
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const meetingTypesMap = buildMeetingTypesMap(meetingTypes)

  const itemCountLabel = useMemo(() => {
    if (items.length === 1) return '1 пункт'
    if (items.length > 1 && items.length < 5) return `${items.length} пункта`
    return `${items.length} пунктов`
  }, [items.length])

  const handleAssign = async (itemId: string) => {
    const meetingId = selectedMeetings[itemId] || nearestMeetingId
    if (!meetingId) {
      toast.error('Нет запланированных собраний для назначения')
      return
    }

    setAssigningId(itemId)
    try {
      const result = await assignAgendaPoolItem(itemId, meetingId)
      if (!result.success) throw new Error(result.error || 'Не удалось назначить пункт')
      toast.success('Пункт добавлен в повестку собрания')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось назначить пункт')
    } finally {
      setAssigningId(null)
    }
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed border-[#E8ECF0] bg-[#F8F9FA]">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Check className="h-8 w-8 text-emerald-600" />
          <div>
            <div className="font-semibold text-[#1B3A6B]">Пул повесток пуст</div>
            <p className="mt-1 text-sm text-[#6B7280]">Новых пунктов для распределения сейчас нет.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E8ECF0] bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1B3A6B]">
          <CircleAlert className="h-4 w-4 text-amber-600" />
          В пуле {itemCountLabel}
        </div>
        {nearestMeetingId && (
          <div className="flex items-center gap-2 text-xs text-[#6B7280]">
            <CalendarClock className="h-4 w-4" />
            По умолчанию выбрано ближайшее собрание: {formatMeeting(meetings[0], meetingTypesMap)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        {items.map((item) => {
          const selectedMeetingId = selectedMeetings[item.id] || nearestMeetingId
          return (
            <Card key={item.id} className="border-[#E8ECF0] shadow-sm">
              <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_360px_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="font-semibold text-[#1B3A6B]">{item.title}</div>
                  {item.description && (
                    <p className="mt-1 text-sm text-[#6B7280]">{item.description}</p>
                  )}
                  {item.machine && (
                    <Link
                      href={`/sales-plan/${item.machine.id}`}
                      className="mt-2 inline-flex text-sm font-medium text-blue-700 hover:underline"
                    >
                      {item.machine.name}
                    </Link>
                  )}
                </div>

                <Select
                  value={selectedMeetingId}
                  onValueChange={(value) => {
                    if (value) setSelectedMeetings((current) => ({ ...current, [item.id]: value }))
                  }}
                  disabled={meetings.length === 0 || assigningId === item.id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите собрание" />
                  </SelectTrigger>
                  <SelectContent>
                    {meetings.map((meeting) => (
                      <SelectItem key={meeting.id} value={meeting.id}>
                        {formatMeeting(meeting, meetingTypesMap)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <LoadingButton
                  loading={assigningId === item.id}
                  disabled={meetings.length === 0}
                  onClick={() => handleAssign(item.id)}
                  className="bg-[#1B3A6B] text-white hover:bg-[#2C5282]"
                >
                  Назначить
                </LoadingButton>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
