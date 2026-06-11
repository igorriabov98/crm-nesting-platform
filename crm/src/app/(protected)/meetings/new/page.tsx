import { Metadata } from 'next'
import { MeetingCreateForm } from '@/components/features/meetings/MeetingCreateForm'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { requirePermission } from '@/lib/permissions/server'
import { getMeetingTypes } from '../actions'

export const metadata: Metadata = {
  title: 'Новое собрание | CRM Завода',
}

export default async function NewMeetingPage() {
  const context = await requirePermission('meetings', 'manage').catch(() => null)
  if (!context) return <AccessDenied />

  // Загружаем список всех активных пользователей для селекта участников
  const { data: users } = await context.supabase
    .from('users')
    .select('id, full_name, role, factory_id')
    .eq('is_active', true)
    .order('full_name')
  const { data: meetingTypes } = await getMeetingTypes()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Назначить собрание</h1>
        <p className="text-sm text-[#6B7280]">Выберите тип собрания — повестка сформируется автоматически</p>
      </div>

      <MeetingCreateForm users={users || []} meetingTypes={meetingTypes || []} />
    </div>
  )
}
