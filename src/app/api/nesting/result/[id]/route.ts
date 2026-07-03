import { NextRequest, NextResponse } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { getNestingProxyAccess } from '@/lib/nesting/proxy-auth'
import { requireNestingProjectProxyAccess } from '@/lib/nesting/project-access'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await getNestingProxyAccess('nesting')
  if (access.response) return access.response
  const deniedProject = await requireNestingProjectProxyAccess(id, access.context!)
  if (deniedProject) return deniedProject

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
