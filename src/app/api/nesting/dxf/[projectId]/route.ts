import { NextRequest, NextResponse } from 'next/server'
import { getNestingServiceUrl } from '@/lib/nesting/api'
import { requireNestingProxyAccess } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const denied = await requireNestingProxyAccess('nesting')
  if (denied) return denied

  const { projectId } = await params
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

  const body = await res.arrayBuffer()
  const headers = new Headers()
  headers.set('Content-Type', res.headers.get('Content-Type') || 'application/zip')
  headers.set('Content-Disposition', res.headers.get('Content-Disposition') || `attachment; filename="nesting-${projectId}.zip"`)

  return new NextResponse(body, { headers })
}
