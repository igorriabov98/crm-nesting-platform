import { Metadata } from 'next'
import { getAgendaPoolMeetingOptions, getMeeting, getMeetingTypes } from '../actions'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { redirect } from 'next/navigation'
import { MeetingCard } from '@/components/features/meetings/MeetingCard'
import type { UserRole } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Карточка собрания | CRM Завода',
}

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [
    { data: profile },
    { data: meeting, error },
    { data: meetingOptions },
    { data: meetingTypes },
    { data: allUsers },
    { data: factories },
  ] = await Promise.all([
    supabase.from('users').select('*').eq('id', user.id).single(),
    getMeeting(id),
    getAgendaPoolMeetingOptions(),
    getMeetingTypes(),
    supabase
      .from('users')
      .select('id, full_name, role, factory:factories(id, name)')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('factories').select('id, name').order('name'),
  ])
  const profileRole = (profile as { role?: UserRole } | null)?.role
  const isDirector = profileRole && DIRECTOR_ROLES.includes(profileRole)

  if (error || !meeting) {
    return (
      <div className="flex justify-center items-center h-full">
        <p className="text-muted-foreground">Собрание не найдено или произошла ошибка</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <MeetingCard 
         meeting={meeting} 
         users={allUsers || []} 
         factories={factories || []}
         meetingOptions={(meetingOptions || []).filter((option) => option.id !== meeting.id)}
         meetingTypes={meetingTypes || []}
         isDirector={!!isDirector}
         currentUser={user}
      />
    </div>
  )
}
