import { NextRequest, NextResponse } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { getNestingProxyAccess } from '@/lib/nesting/proxy-auth'
import { requireNestingProjectProxyAccess } from '@/lib/nesting/project-access'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sheetId: string }> }
) {
  const { projectId, sheetId } = await params
  const access = await getNestingProxyAccess({ resourceKey: 'nesting', operation: 'view' })
  if (access.response) return access.response
  const deniedProject = await requireNestingProjectProxyAccess(projectId, access.context!)
  if (deniedProject) return deniedProject

  let res: Response
  try {
    res = await fetch(`${getNestingServiceUrl()}/api/projects/${projectId}/dxf/${sheetId}`)
  } catch (error) {
    return NextResponse.json(
      { error: `Не удалось скачать DXF: сервис раскладки недоступен (${error instanceof Error ? error.message : 'неизвестная ошибка'})` },
      { status: 503 }
    )
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'DXF не найден' }))
    return NextResponse.json(data, { status: res.status })
  }

  const body = await res.arrayBuffer()
  const headers = new Headers()
  headers.set('Content-Type', res.headers.get('Content-Type') || 'application/dxf')
  headers.set('Content-Disposition', res.headers.get('Content-Disposition') || 'attachment; filename="sheet.dxf"')

  return new NextResponse(body, { headers })
}
