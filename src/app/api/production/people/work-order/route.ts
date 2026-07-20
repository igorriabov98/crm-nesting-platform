import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getPeoplePlanningWorkspace } from '@/lib/actions/people-planning'
import { PeopleWorkOrderDocument } from '@/lib/pdf/PeopleWorkOrderDocument'
import { requirePermission } from '@/lib/permissions/server'

export const runtime = 'nodejs'

const querySchema = z.object({
  factory: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  view: z.enum(['day', 'week']).default('day'),
})

export async function GET(request: Request) {
  try {
    await requirePermission('production_fact', 'view')
    const url = new URL(request.url)
    const parsed = querySchema.parse({
      factory: url.searchParams.get('factory'),
      date: url.searchParams.get('date'),
      view: url.searchParams.get('view') || 'day',
    })
    const data = await getPeoplePlanningWorkspace({ factoryId: parsed.factory, date: parsed.date, view: parsed.view })
    const element = createElement(PeopleWorkOrderDocument, { data }) as Parameters<typeof renderToBuffer>[0]
    const buffer = await renderToBuffer(element)
    const fileDate = parsed.view === 'week' ? `${data.dates[0]}_${data.dates.at(-1)}` : parsed.date
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="PeopleWorkOrder_${fileDate}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 403
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сформировать наряд' }, { status })
  }
}
