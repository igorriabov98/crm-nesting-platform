'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar as CalendarIcon, List, Clock, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { MeetingsCalendar } from './MeetingsCalendar'
import { MeetingsList } from './MeetingsList'
import { buildMeetingTypesMap } from '@/lib/constants/meetings'
import type { MeetingTypeOption } from '@/app/(protected)/meetings/actions'
import type { MeetingListItem, UpcomingMeeting } from '@/lib/types'

interface MeetingsViewProps {
  initialMeetings: MeetingListItem[]
  upcomingMeeting: UpcomingMeeting | null
  isDirector?: boolean
  meetingTypes?: MeetingTypeOption[]
  resultLimit?: number
}

export function MeetingsView({ initialMeetings, upcomingMeeting, isDirector = false, meetingTypes = [], resultLimit }: MeetingsViewProps) {
  const [view, setView] = useState('calendar')
  const [meetings, setMeetings] = useState(initialMeetings)
  const meetingTypesMap = buildMeetingTypesMap(meetingTypes)

  return (
    <div className="flex flex-col space-y-6">
      
      {/* Карточка ближайшего собрания */}
      {upcomingMeeting && (
        <Card className="border-[#1B3A6B] shadow-sm bg-[#F8FAFC]">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center text-[#1B3A6B]">
              <Clock className="w-5 h-5 mr-2 text-[#E11D48]" />
              Ближайшее собрание
            </CardTitle>
            <CardDescription className="text-[#374151] font-medium">
              {upcomingMeeting.title || meetingTypesMap[upcomingMeeting.meeting_type]?.label || upcomingMeeting.meeting_type} — {
                new Date(upcomingMeeting.meeting_date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
              }, {upcomingMeeting.meeting_time.substring(0,5)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex space-x-6 text-sm text-[#6B7280]">
                <span>Повестка: <strong className="text-[#1B3A6B]">{upcomingMeeting.agenda_items_count}</strong> пунктов</span>
                <span>Участников: <strong className="text-[#1B3A6B]">{upcomingMeeting.attendees_count}</strong></span>
              </div>
              <Link href={`/meetings/${upcomingMeeting.id}`} className="flex items-center text-sm font-semibold text-[#1B3A6B] hover:text-[#2C5282] uppercase tracking-wider">
                Открыть <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Основная область переключения */}
      {resultLimit && meetings.length >= resultLimit && (
        <div className="rounded-md border border-[#E8ECF0] bg-white px-3 py-2 text-sm text-[#6B7280]">
          Показаны первые {resultLimit} собраний по текущей сортировке. Используйте фильтры, чтобы быстрее найти нужное собрание.
        </div>
      )}

      <Tabs value={view} onValueChange={setView} className="w-full">
        <div className="bg-white p-2 rounded-xl shadow-sm border border-[#E8ECF0] mb-4 overflow-x-auto">
           <TabsList className="grid w-full max-w-[400px] grid-cols-2 bg-[#F4F6F9] rounded-lg">
             <TabsTrigger 
                value="calendar" 
                className="rounded-md data-[state=active]:bg-[#1B3A6B] data-[state=active]:text-white font-medium text-[#6B7280]"
              >
               <CalendarIcon className="w-4 h-4 mr-2" />
               Календарь
             </TabsTrigger>
             <TabsTrigger 
                value="list" 
                className="rounded-md data-[state=active]:bg-[#1B3A6B] data-[state=active]:text-white font-medium text-[#6B7280]"
              >
               <List className="w-4 h-4 mr-2" />
               Список
             </TabsTrigger>
           </TabsList>
        </div>

        <TabsContent value="calendar" className="mt-0 outline-none">
          <MeetingsCalendar meetings={meetings} meetingTypes={meetingTypesMap} />
        </TabsContent>
        <TabsContent value="list" className="mt-0 outline-none">
          <MeetingsList meetings={meetings} meetingTypes={meetingTypesMap} isDirector={isDirector} onMeetingsCancelled={(ids) => {
            setMeetings((current) => current.filter((meeting) => !ids.includes(meeting.id)))
          }} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
