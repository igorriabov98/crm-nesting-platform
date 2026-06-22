import { User2, Crown } from 'lucide-react'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata = {
  title: 'Профиль — CRM Завода',
}

export default async function ProfilePage() {
  const { user } = await getCurrentUserContextOrRedirect()
  const memberships = user.department_memberships || []

  return (
    <div className="space-y-5">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[#1B3A6B]">
            <User2 className="h-5 w-5" />
            Профиль
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xl font-semibold text-[#1B3A6B]">{user.full_name}</div>
            <div className="text-sm text-[#6B7280]">{user.email}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant={user.is_active ? 'outline' : 'destructive'}>
              {user.is_active ? 'Активен' : 'Заблокирован'}
            </Badge>
            {user.telegram_chat_id && <Badge variant="outline">Telegram подключён</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-lg text-[#1B3A6B]">Отделы и должности</CardTitle>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Вы пока не назначены в отдел.</p>
          ) : (
            <div className="space-y-2">
              {memberships.map((membership, index) => (
                <div
                  key={`${membership.department?.id || 'department'}-${membership.position?.id || index}`}
                  className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[#1B3A6B]">
                      {membership.department?.name || 'Отдел не указан'}
                    </span>
                    {membership.is_department_head && (
                      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-400/30 bg-amber-400/10">
                        <Crown className="h-3.5 w-3.5" />
                        Начальник отдела
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-[#6B7280]">
                    {membership.position?.name || 'Должность не указана'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
