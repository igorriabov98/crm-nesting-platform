'use client'

import { useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MEETING_TYPES } from '@/lib/constants/meetings'
import type { MeetingTypesMap } from '@/lib/constants/meetings'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { MeetingListItem } from '@/lib/types'

interface MeetingsCalendarProps {
  meetings: MeetingListItem[]
  meetingTypes?: MeetingTypesMap
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const colorMap: Record<string, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  orange: 'bg-orange-500',
  gray: 'bg-gray-500',
}

export function MeetingsCalendar({ meetings, meetingTypes = MEETING_TYPES }: MeetingsCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())

  // Логика календаря
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  
  // Корректируем на понедельник = 1, воскресенье = 7
  let startingDay = firstDayOfMonth.getDay()
  if (startingDay === 0) startingDay = 7

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  const monthName = currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
  const capitalizedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1)

  // Группировка собраний по датам
  const meetingsByDate = useMemo(() => {
    const map = new Map<string, MeetingListItem[]>()
    meetings.forEach(m => {
      if (!map.has(m.meeting_date)) {
        map.set(m.meeting_date, [])
      }
      map.get(m.meeting_date)!.push(m)
    })
    return map
  }, [meetings])

  const [selectedDayMeetings, setSelectedDayMeetings] = useState<MeetingListItem[] | null>(null)
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null)

  const handleDayClick = (dayStr: string, dayMeetings: MeetingListItem[]) => {
    if (dayMeetings.length > 0) {
      setSelectedDayMeetings(dayMeetings)
      setSelectedDateStr(dayStr)
    } else {
      setSelectedDayMeetings(null)
      setSelectedDateStr(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-white shadow-sm border-[#E8ECF0]">
        
        {/* Заголовок календаря */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-[#1B3A6B]">{capitalizedMonth}</h2>
          <div className="flex space-x-2">
            <Button variant="outline" size="icon" onClick={prevMonth}>
              <ChevronLeft className="w-5 h-5 text-[#6B7280]" />
            </Button>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="w-5 h-5 text-[#6B7280]" />
            </Button>
          </div>
        </div>

        {/* Сетка календаря */}
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map(day => (
            <div key={day} className="text-center font-medium text-sm text-[#9CA3AF] py-2">
              {day}
            </div>
          ))}

          {/* Пустые ячейки до первого числа */}
          {Array.from({ length: startingDay - 1 }).map((_, i) => (
            <div key={`empty-${i}`} className="p-2 border border-transparent min-h-[80px]" />
          ))}

          {/* Дни месяца */}
          {Array.from({ length: daysInMonth }).map((_, index) => {
            const day = index + 1
            // Форматируем текущую дату ячейки в 'YYYY-MM-DD'
            const cellDateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day, 12).toISOString().split('T')[0]
            
            const dayMeetings = meetingsByDate.get(cellDateStr) || []
            
            const isToday = cellDateStr === new Date().toISOString().split('T')[0]
            const isSelected = selectedDateStr === cellDateStr

            return (
              <div 
                key={`day-${day}`}
                onClick={() => handleDayClick(cellDateStr, dayMeetings)}
                className={cn(
                  "p-2 border rounded-lg min-h-[80px] flex flex-col transition-all cursor-pointer hover:bg-[#F4F6F9]",
                  isSelected ? "border-[#1B3A6B] bg-blue-50/30" : "border-[#E8ECF0]",
                  isToday && !isSelected && "border-[#1B3A6B]/30 bg-gray-50"
                )}
              >
                <div className={cn(
                  "text-sm font-medium self-end mb-1 w-7 h-7 flex items-center justify-center rounded-full",
                  isToday ? "bg-[#1B3A6B] text-white" : "text-[#374151]"
                )}>
                  {day}
                </div>
                
                {/* Точки/индикаторы собраний */}
                <div className="flex flex-wrap gap-1 mt-auto">
                  {dayMeetings.map((m) => {
                    const cInfo = meetingTypes[m.meeting_type]
                    const colorClass = colorMap[cInfo?.color || 'gray'] || 'bg-gray-500'
                    return (
                       <div key={m.id} className={cn("w-2 h-2 rounded-full shadow-sm", colorClass)} title={m.title || cInfo?.label} />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Легенда */}
        <div className="mt-6 flex flex-wrap gap-4 text-xs font-medium text-[#6B7280]">
          {Object.entries(meetingTypes).map(([key, info]) => {
             const colorClass = colorMap[info.color] || 'bg-gray-500'
             return (
               <div key={key} className="flex items-center gap-1.5">
                 <div className={cn("w-2 h-2 rounded-full", colorClass)} />
                 {info.label}
               </div>
             )
          })}
        </div>

      </Card>

      {/* Выбранные собрания (preview) */}
      {selectedDayMeetings && selectedDateStr && (
        <Card className="p-4 bg-white shadow-sm border-[#E8ECF0]">
          <h3 className="text-md font-bold text-[#1B3A6B] mb-3">
            Собрания {new Date(selectedDateStr).toLocaleDateString('ru-RU')}
          </h3>
          <div className="space-y-2">
            {selectedDayMeetings.map(m => {
              const info = meetingTypes[m.meeting_type]
              const colorClass = colorMap[info?.color || 'gray'] || 'bg-gray-500'
              return (
                <Link key={m.id} href={`/meetings/${m.id}`} className="block border rounded-lg p-3 hover:bg-gray-50 transition">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-3 h-3 rounded-full", colorClass)} />
                      <div>
                        <p className="font-semibold text-sm text-[#1B3A6B]">
                          {m.title || info?.label || 'Собрание'}
                        </p>
                        <p className="text-xs text-[#6B7280] flex items-center gap-2 mt-0.5">
                          <Clock className="w-3 h-3" /> {m.meeting_time.substring(0, 5)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                       <p className="text-xs font-medium text-[#374151]">{m.agenda_items_count} пунктов</p>
                       <p className="text-xs text-[#9CA3AF]">{m.attendees_count} участ.</p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>
      )}

    </div>
  )
}
