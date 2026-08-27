import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { getMaterialReceivingPageData } from '@/lib/actions/supply-orders'
import { buildMaterialReceivingActData } from '@/lib/material-receiving-act'
import { requirePermission } from '@/lib/permissions/server'
import { MaterialReceivingActDocument } from '@/lib/pdf/MaterialReceivingActDocument'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

export async function GET(request: Request) {
  try {
    await requirePermission('inventory_receiving', 'view')
    const url = new URL(request.url)
    const date = url.searchParams.get('date') || ''
    const factoryId = url.searchParams.get('factory') || ''
    if (!DATE_RE.test(date)) return errorResponse('Некорректная дата поставки', 400)
    if (!UUID_RE.test(factoryId)) return errorResponse('Некорректный завод', 400)

    const result = await getMaterialReceivingPageData(factoryId)
    if (result.error || !result.data) {
      return errorResponse(result.error || 'Не удалось загрузить данные приёмки', 500)
    }
    if (result.data.activeFactoryId !== factoryId) return errorResponse('Завод не найден', 404)

    const group = result.data.groups.find((candidate) => candidate.date === date)
    if (!group || group.items.length === 0) return errorResponse('На эту дату нет позиций к приёмке', 404)
    const factory = result.data.factories.find((candidate) => candidate.id === factoryId)
    if (!factory) return errorResponse('Завод не найден', 404)

    const data = buildMaterialReceivingActData({
      deliveryDate: date,
      generatedAt: new Date().toISOString(),
      factoryName: factory.name,
      items: group.items,
    })
    const element = createElement(MaterialReceivingActDocument, { data }) as Parameters<typeof renderToBuffer>[0]
    const pdf = await renderToBuffer(element)

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="material-receiving-act-${date}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Не удалось сформировать акт приёма', 500)
  }
}
