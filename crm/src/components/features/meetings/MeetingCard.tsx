'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingButton } from '@/components/ui/loading-button'
import { ArrowLeft, Check, Clock, Repeat } from 'lucide-react'
import Link from 'next/link'
import { buildMeetingTypesMap, MEETING_STATUSES } from '@/lib/constants/meetings'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { completeMeeting, type AgendaPoolMeetingOption, type MeetingTypeOption } from '@/app/(protected)/meetings/actions'

import { MeetingAgenda } from './MeetingAgenda'
import { MeetingDecisions } from './MeetingDecisions'
import { MeetingAttendees } from './MeetingAttendees'
import { MeetingActionItems } from './MeetingActionItems'
import type { FactorySummary, MeetingDetails, UserSummary } from '@/lib/types'

interface MeetingCardProps {
  meeting: MeetingDetails
  users: UserSummary[]
  factories: FactorySummary[]
  meetingOptions: AgendaPoolMeetingOption[]
  meetingTypes: MeetingTypeOption[]
  isDirector: boolean
  currentUser: unknown
}

export function MeetingCard({ meeting, users, factories, meetingOptions, meetingTypes, isDirector, currentUser }: MeetingCardProps) {
  const [activeTab, setActiveTab] = useState('agenda')
  const [isCompleting, setIsCompleting] = useState(false)

  const meetingTypesMap = buildMeetingTypesMap(meetingTypes)
  const tInfo = meetingTypesMap[meeting.meeting_type]
  const sInfo = MEETING_STATUSES[meeting.status as keyof typeof MEETING_STATUSES]

  const handleComplete = async () => {
    if (!confirm('Завершить собрание? Все присутствующие будут отмечены, а статус изменен.')) return
    setIsCompleting(true)
    try {
      // Отмечаем только тех, кто подтвердил или присутствовал
      const attendedIds = meeting.attendees.map((a) => a.user?.id).filter((id): id is string => Boolean(id))
      const res = await completeMeeting(meeting.id, meeting.notes || '', attendedIds)
      if (res.success) {
         toast.success('Собрание завершено')
      } else {
         toast.error(res.error)
      }
    } catch (err: unknown) {
      toast.error('Ошибка', { description: err instanceof Error ? err.message : 'Неизвестная ошибка' })
    } finally {
      setIsCompleting(false)
    }
  }

  return (
    <div className="space-y-6 pb-20">
      
      {/* Шапка, назад и кнопки */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/meetings" className="text-sm text-[#6B7280] hover:text-[#1B3A6B] flex items-center font-medium">
          <ArrowLeft className="w-4 h-4 mr-1" /> Назад к собраниям
        </Link>
        <div className="flex gap-2">
          {isDirector && meeting.status === 'planned' && (
            <LoadingButton loading={isCompleting} onClick={handleComplete} className="bg-green-600 hover:bg-green-700 text-white">
              <Check className="w-4 h-4 mr-2" /> Провести собрание
            </LoadingButton>
          )}
        </div>
      </div>

      {/* Основная карточка инфы */}
      <Card className="shadow-sm border-[#E8ECF0]">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
             <div className={`w-3 h-3 rounded-full bg-${tInfo?.color || 'gray'}-500`} />
             <h1 className="text-xl font-bold text-[#1B3A6B]">
               {meeting.title || tInfo?.label}
             </h1>
             {meeting.recurrence_rule_id && (
               <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                 <Repeat className="w-3 h-3 mr-1" />
                 Повторяется
               </Badge>
             )}
          </div>
        </CardHeader>
        <CardContent>
           <div className="flex flex-wrap items-center gap-6">
             <div className="flex items-center gap-2 text-[#374151] font-medium">
                📅 {new Date(meeting.meeting_date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
             </div>
             <div className="flex items-center gap-2 text-[#374151] font-medium">
                <Clock className="w-4 h-4 text-[#9CA3AF]" /> {meeting.meeting_time.substring(0, 5)}
             </div>
             <div className="flex items-center gap-2 text-[#374151] font-medium">
                Длительность: {meeting.duration_minutes || 60} мин
             </div>
             <div className="flex items-center gap-2">
                Статус:
                {sInfo && (
                  <Badge variant="outline" className={`bg-${sInfo.color}-50 text-${sInfo.color}-700 border-${sInfo.color}-200 ml-1`}>
                    {sInfo.label}
                  </Badge>
                )}
             </div>
           </div>
        </CardContent>
      </Card>

      {/* Табы */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-[#F4F6F9] rounded-lg p-1">
          <TabsTrigger value="agenda" className="rounded-md data-[state=active]:bg-[#1B3A6B] data-[state=active]:text-white data-[state=active]:shadow text-sm font-medium">
            Повестка
          </TabsTrigger>
          <TabsTrigger value="decisions" className="rounded-md data-[state=active]:bg-[#1B3A6B] data-[state=active]:text-white data-[state=active]:shadow text-sm font-medium">
            Решения
          </TabsTrigger>
          <TabsTrigger value="attendees" className="rounded-md data-[state=active]:bg-[#1B3A6B] data-[state=active]:text-white data-[state=active]:shadow text-sm font-medium">
            Участники
          </TabsTrigger>
          <TabsTrigger value="actions" className="rounded-md data-[state=active]:bg-[#1B3A6B] data-[state=active]:text-white data-[state=active]:shadow text-sm font-medium">
            Итоги/Задачи
          </TabsTrigger>
        </TabsList>
        
        <div className="mt-4">
          <TabsContent value="agenda" className="m-0 outline-none">
            <MeetingAgenda
              meeting={meeting}
              factories={factories}
              meetingOptions={meetingOptions}
              isDirector={isDirector}
              currentUser={currentUser}
            />
          </TabsContent>

          <TabsContent value="decisions" className="m-0 outline-none">
            <MeetingDecisions meeting={meeting} isDirector={isDirector} users={users} factories={factories} />
          </TabsContent>

          <TabsContent value="attendees" className="m-0 outline-none">
            <MeetingAttendees meeting={meeting} users={users} isDirector={isDirector} currentUser={currentUser} />
          </TabsContent>

          <TabsContent value="actions" className="m-0 outline-none">
            <MeetingActionItems meeting={meeting} isDirector={isDirector} users={users} />
          </TabsContent>
        </div>
      </Tabs>

    </div>
  )
}
