import { NextRequest, NextResponse } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { requireNestingProxyAccess } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  const { id } = await params

  let res: Response
  try {
    res = await fetch(`${getNestingServiceUrl()}/api/projects/${id}/result`, { cache: 'no-store' })
  } catch (error) {
    return NextResponse.json(
      { error: `Не удалось загрузить результат раскладки: сервис недоступен (${error instanceof Error ? error.message : 'неизвестная ошибка'})` },
      { status: 503 }
    )
  }

  const data = await res.json().catch(() => ({ error: 'Не удалось прочитать ответ сервиса раскладки' }))
  return NextResponse.json(data, { status: res.status })
}
