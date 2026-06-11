import { Metadata } from 'next'
import Link from 'next/link'
import { ListChecks, Plus } from 'lucide-react'
import { getMeetings, getMeetingTypes, getUpcomingMeeting } from './actions'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { MEETINGS_LIST_LIMIT } from '@/lib/constants/meetings-performance'
import { MeetingsView } from '@/components/features/meetings/MeetingsView'
import type { UserRole } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Собрания | CRM Завода',
  description: 'Календарь и списки общих и заводских собраний',
}

export default async function MeetingsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  const [
    { data: profile },
    { data: meetings },
    { data: upcoming },
    { data: meetingTypes },
  ] = await Promise.all([
    user
      ? supabase.from('users').select('role').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    getMeetings(),
    getUpcomingMeeting(),
    getMeetingTypes(),
  ])

  const profileRole = (profile as { role?: UserRole } | null)?.role
  const isDirector = !!(profileRole && DIRECTOR_ROLES.includes(profileRole))

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">Собрания</h1>
          <p className="text-sm text-[#6B7280]">Организация и прозрачность решений по каждому заводу</p>
        </div>
        
        {isDirector && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/meetings/agenda-pool"
              className="inline-flex items-center gap-2 rounded-lg border border-[#1B3A6B] px-4 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#F4F6F9] transition-colors"
            >
              <ListChecks className="h-4 w-4" />
              Пул повесток
            </Link>
          <Link
            href="/meetings/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2C5282] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Новое собрание
          </Link>
          </div>
        )}
      </div>

      <MeetingsView
        initialMeetings={meetings || []}
        upcomingMeeting={upcoming}
        isDirector={isDirector}
        meetingTypes={meetingTypes || []}
        resultLimit={MEETINGS_LIST_LIMIT}
      />
    </div>
  )
}
