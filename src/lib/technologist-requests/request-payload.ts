import 'server-only'

import type {
  RequestChainCord,
  RequestCircle,
  RequestComponents,
  RequestKnives,
  RequestMesh,
  RequestPaint,
  RequestPipe,
  RequestRoundTube,
  RequestSheetMetal,
  TechnologistRequest,
} from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
}

export type TechnologistRequestPayloadDb = {
  from: (table: string) => LooseQuery
}

export type WithMaterialName<T> = T & {
  materials?: { id: string; name: string } | null
}

export type TechnologistRequestPayload = {
  request: TechnologistRequest
  sheetMetal: WithMaterialName<RequestSheetMetal>[]
  roundTube: WithMaterialName<RequestRoundTube>[]
  circles: WithMaterialName<RequestCircle>[]
  pipes: WithMaterialName<RequestPipe>[]
  knives: WithMaterialName<RequestKnives>[]
  components: WithMaterialName<RequestComponents>[]
  paint: WithMaterialName<RequestPaint>[]
  meshItems: WithMaterialName<RequestMesh>[]
  chainCords: WithMaterialName<RequestChainCord>[]
  sheetMetals?: WithMaterialName<RequestSheetMetal>[]
  paints?: WithMaterialName<RequestPaint>[]
  roundTubes?: WithMaterialName<RequestRoundTube>[]
}

export async function loadTechnologistRequestPayload(
  db: TechnologistRequestPayloadDb,
  request: TechnologistRequest,
): Promise<TechnologistRequestPayload> {
  const [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
    db.from('request_sheet_metal').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_round_tube').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_circle').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_pipe').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_knives').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_components').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_paint').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_mesh').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
    db.from('request_chain_cord').select('*, materials(id, name)').eq('request_id', request.id).order('sort_order').order('created_at'),
  ])

  for (const result of [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить раздел заявки')
  }

  return {
    request,
    sheetMetal: (sheetMetal.data || []) as WithMaterialName<RequestSheetMetal>[],
    sheetMetals: (sheetMetal.data || []) as WithMaterialName<RequestSheetMetal>[],
    roundTube: (roundTube.data || []) as WithMaterialName<RequestRoundTube>[],
    roundTubes: (roundTube.data || []) as WithMaterialName<RequestRoundTube>[],
    circles: (circles.data || []) as WithMaterialName<RequestCircle>[],
    pipes: (pipes.data || []) as WithMaterialName<RequestPipe>[],
    knives: (knives.data || []) as WithMaterialName<RequestKnives>[],
    components: (components.data || []) as WithMaterialName<RequestComponents>[],
    paint: (paint.data || []) as WithMaterialName<RequestPaint>[],
    paints: (paint.data || []) as WithMaterialName<RequestPaint>[],
    meshItems: (meshItems.data || []) as WithMaterialName<RequestMesh>[],
    chainCords: (chainCords.data || []) as WithMaterialName<RequestChainCord>[],
  }
}
