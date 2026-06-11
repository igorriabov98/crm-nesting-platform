import { NextRequest, NextResponse } from 'next/server'
import { getNestingServiceUrl } from '@/lib/nesting/api'
import { requireNestingProxyAccess } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const denied = await requireNestingProxyAccess('nesting')
    if (denied) return denied

    const formData = await request.formData()
    const res = await fetch(`${getNestingServiceUrl()}/api/projects`, {
      method: 'POST',
      body: formData,
    })
    const data = await res.json().catch(() => ({ error: 'Не удалось загрузить файлы' }))

    return NextResponse.json(data, { status: res.status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Не удалось загрузить файлы' },
      { status: 500 }
    )
  }
}
