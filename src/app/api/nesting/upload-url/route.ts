import { NextRequest, NextResponse } from 'next/server'
import { fetchNestingService as fetch, getNestingServiceUrl } from '@/lib/nesting/api'
import { requireNestingProxyAccess } from '@/lib/nesting/proxy-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const denied = await requireNestingProxyAccess({ resourceKey: 'nesting', operation: 'manage' })
  if (denied) return denied

  try {
    const body = await request.json()
    const response = await fetch(`${getNestingServiceUrl()}/api/uploads/signed-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({ error: 'Unable to create signed upload URL' }))
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create signed upload URL' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireNestingProxyAccess({ resourceKey: 'nesting', operation: 'manage' })
  if (denied) return denied

  try {
    const body = await request.json()
    const response = await fetch(`${getNestingServiceUrl()}/api/uploads`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({ error: 'Unable to clean up uploads' }))
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to clean up uploads' },
      { status: 500 }
    )
  }
}
