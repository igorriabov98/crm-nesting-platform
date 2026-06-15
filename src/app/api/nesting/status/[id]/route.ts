import { NextRequest, NextResponse } from 'next/server'
import { getNestingServiceUrl } from '@/lib/nesting/api'
import { requireNestingProxyAccess } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  const { id } = await params
  try {
    const res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/status`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({ error: 'Не удалось получить статус проекта' }))
    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json(
      { error: `Не удалось получить статус проекта: сервис раскладки недоступен (${error instanceof Error ? error.message : 'неизвестная ошибка'})` },
      { status: 503 }
    )
  }
}
