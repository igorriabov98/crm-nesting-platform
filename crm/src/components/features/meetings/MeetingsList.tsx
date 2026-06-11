'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MEETING_TYPES, MEETING_STATUSES } from '@/lib/constants/meetings'
import type { MeetingTypesMap } from '@/lib/constants/meetings'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cancelMeeting } from '@/app/(protected)/meetings/actions'
import { ArrowRight, Calendar as CalendarIcon, Clock, Loader2, MoreHorizontal, Repeat, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { MeetingListItem } from '@/lib/types'

interface MeetingsListProps {
  meetings: MeetingListItem[]
  meetingTypes?: MeetingTypesMap
  isDirector?: boolean
  onMeetingsCancelled?: (ids: string[]) => void
}

export function MeetingsList({ meetings, meetingTypes = MEETING_TYPES, isDirector = false, onMeetingsCancelled }: MeetingsListProps) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [cancelling, setCancelling] = useState<{ id: string; scope: 'single' | 'series' } | null>(null)

  const filteredMeetings = meetings.filter(m => {
    if (typeFilter !== 'all' && m.meeting_type !== typeFilter) return false
    if (statusFilter !== 'all' && m.status !== statusFilter) return false
    return true
  })

  const handleCancel = async (meeting: MeetingListItem, scope: 'single' | 'series') => {
    const message = scope === 'series'
      ? 'Отменить все будущие собрания этой серии? Повестки будут перенесены в пул.'
      : 'Отменить это собрание? Повестка будет перенесена в пул.'

    if (!confirm(message)) return

    setCancelling({ id: meeting.id, scope })
    try {
      const result = await cancelMeeting(meeting.id, scope)
      if (!result.success) {
        toast.error(result.error || 'Не удалось отменить собрание')
        return
      }

      onMeetingsCancelled?.(result.cancelledIds || [meeting.id])
      toast.success(
        scope === 'series'
          ? `Будущие собрания серии отменены: ${result.cancelledCount || 0}`
          : 'Собрание отменено',
        {
          description: `В пул повесток перенесено пунктов: ${result.movedToPoolCount || 0}`,
        }
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отменить собрание')
    } finally {
      setCancelling(null)
    }
  }

  return (
    <Card className="bg-white shadow-sm border-[#E8ECF0]">
      <div className="p-4 border-b border-[#E8ECF0] flex flex-wrap gap-4 items-center">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
             <SelectValue>{typeFilter === 'all' ? 'Все типы' : meetingTypes[typeFilter]?.label || typeFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
             <SelectItem value="all">Все типы</SelectItem>
             {Object.entries(meetingTypes).map(([k, v]) => (
               <SelectItem key={k} value={k}>{v.label}</SelectItem>
             ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
             <SelectValue>{statusFilter === 'all' ? 'Все статусы' : MEETING_STATUSES[statusFilter as keyof typeof MEETING_STATUSES]?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
             <SelectItem value="all">Все статусы</SelectItem>
             {Object.entries(MEETING_STATUSES).map(([k, v]) => (
               <SelectItem key={k} value={k}>{v.label}</SelectItem>
             ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent bg-gray-50/50">
            <TableHead className="font-semibold text-[#1B3A6B]">Дата</TableHead>
            <TableHead className="font-semibold text-[#1B3A6B]">Тип</TableHead>
            <TableHead className="font-semibold text-[#1B3A6B]">Время</TableHead>
            <TableHead className="font-semibold text-[#1B3A6B]">Повестка</TableHead>
            <TableHead className="font-semibold text-[#1B3A6B]">Участников</TableHead>
            <TableHead className="font-semibold text-[#1B3A6B]">Статус</TableHead>
            <TableHead className="font-semibold text-[#1B3A6B] text-right">Действие</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredMeetings.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                Нет собраний, попадающих под фильтры
              </TableCell>
            </TableRow>
          ) : (
            filteredMeetings.map((m) => {
              const tInfo = meetingTypes[m.meeting_type]
              const sInfo = MEETING_STATUSES[m.status as keyof typeof MEETING_STATUSES]
              
              return (
                <TableRow key={m.id} className="group hover:bg-[#F4F6F9]">
                  <TableCell className="font-medium text-[#374151]">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="w-4 h-4 text-[#9CA3AF]" />
                      {new Date(m.meeting_date).toLocaleDateString('ru-RU')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                       <span className={`w-2 h-2 rounded-full bg-${tInfo?.color || 'gray'}-500`} />
                       <span className="font-medium text-[#374151]">{m.title || tInfo?.label}</span>
                       {m.recurrence_rule_id && <Repeat className="w-4 h-4 text-[#6B7280]" />}
                    </div>
                  </TableCell>
                  <TableCell>
                     <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                        <Clock className="w-4 h-4" />
                        {m.meeting_time.substring(0, 5)}
                     </div>
                  </TableCell>
                  <TableCell className="text-[#6B7280] font-medium">
                     {m.agenda_items_count} пунктов
                  </TableCell>
                  <TableCell className="text-[#6B7280]">
                     {m.attendees_count} чел.
                  </TableCell>
                  <TableCell>
                    {sInfo && (
                      <Badge variant="outline" className={`bg-${sInfo.color}-50 text-${sInfo.color}-700 border-${sInfo.color}-200`}>
                        {sInfo.label}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/meetings/${m.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-[#1B3A6B] hover:text-[#2C5282] transition-colors"
                    >
                      Открыть <ArrowRight className="ml-1 w-4 h-4" />
                    </Link>
                    {isDirector && m.status === 'planned' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E8ECF0] text-[#6B7280] hover:bg-[#F4F6F9] hover:text-[#1B3A6B]"
                          aria-label="Действия с собранием"
                        >
                          {cancelling?.id === m.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={Boolean(cancelling)}
                            onClick={() => handleCancel(m, 'single')}
                          >
                            <XCircle className="h-4 w-4" />
                            Отменить только это собрание
                          </DropdownMenuItem>
                          {m.recurrence_rule_id && (
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={Boolean(cancelling)}
                              onClick={() => handleCancel(m, 'series')}
                            >
                              <Repeat className="h-4 w-4" />
                              Отменить будущую серию
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
