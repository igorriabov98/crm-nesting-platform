import { NextResponse } from 'next/server'
import { searchMaterialsWithVariants } from '@/lib/actions/materials'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import type { MaterialCategory } from '@/lib/types'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const query = (params.get('q') || '').trim()
  const category = params.get('category') || null
  if (query.length < 2 || query.length > 160
    || (category && !Object.hasOwn(MATERIAL_CATEGORY_LABELS, category))) {
    return NextResponse.json({ data: null, error: 'Некорректные параметры поиска' }, { status: 400, headers })
  }

  // Calling the shared action on the server retains its authorization and RLS.
  // Fetching this route avoids the browser's serialized Server Action queue.
  const result = await searchMaterialsWithVariants(query, category as MaterialCategory | null, params.get('fallback') === '1')
  return NextResponse.json(result, { status: result.error ? 400 : 200, headers })
}
