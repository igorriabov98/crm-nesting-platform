import { NextRequest, NextResponse } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { getNestingProxyAccess } from '@/lib/nesting/proxy-auth'
import { requireNestingProjectProxyAccess } from '@/lib/nesting/project-access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const access = await getNestingProxyAccess({ resourceKey: 'nesting', operation: 'view' })
  if (access.response) return access.response
  const deniedProject = await requireNestingProjectProxyAccess(projectId, access.context!)
  if (deniedProject) return deniedProject

  let res: Response
  try {
    res = await fetch(`${getNestingServiceUrl()}/api/projects/${projectId}/dxf`)
  } catch (error) {
    return NextResponse.json(
      { error: `Не удалось скачать DXF ZIP: сервис раскладки недоступен (${error instanceof Error ? error.message : 'неизвестная ошибка'})` },
      { status: 503 }
    )
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'DXF ZIP не найден' }))
    return NextResponse.json(data, { status: res.status })
  }

  const headers = new Headers()
  headers.set('Content-Type', res.headers.get('Content-Type') || 'application/zip')
  headers.set('Content-Disposition', res.headers.get('Content-Disposition') || `attachment; filename="nesting-${projectId}.zip"`)

  if (!res.body) {
    return NextResponse.json(
      { error: 'DXF ZIP пуст' },
      { status: 502 }
    )
  }

  return new NextResponse(res.body, { headers })
}
