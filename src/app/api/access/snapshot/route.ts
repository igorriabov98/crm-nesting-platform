import { NextResponse } from 'next/server'
import { AuthRequiredError, UserInactiveError, UserProfileMissingError, getCurrentUserContext } from '@/lib/auth/current-user'
import { getCurrentUserPermissions } from '@/lib/permissions/server'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET() {
  try {
    const context = await getCurrentUserContext()
    const snapshot = await getCurrentUserPermissions(context.userId)
    return NextResponse.json({ ...snapshot, userId: context.userId }, { headers })
  } catch (error) {
    const status = error instanceof AuthRequiredError ? 401
      : error instanceof UserInactiveError || error instanceof UserProfileMissingError ? 403 : 503
    return NextResponse.json({ error: status === 503 ? 'Не удалось проверить доступ' : 'Доступ закрыт' }, { status, headers })
  }
}
