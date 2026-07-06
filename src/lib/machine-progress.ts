import type {
  MachineProgress,
  MachineProgressKey,
  MachineProgressStep,
  MachineProgressStepState,
  OrderItemStatus,
  ProductionFactShift,
  RequestStatus,
  StageType,
} from '@/lib/types'
import { STAGES, STAGE_ORDER } from '@/lib/constants/stages'

export const MACHINE_PROGRESS_STATIC_LABELS = {
  created: 'Создана',
  decoded: 'Расшифрована',
  planned: 'Запланирована',
  waiting_request: 'Ожидает заявки',
  purchasing: 'В закупке',
  material_received: 'Материал получен',
  shipped: 'Отгружена',
} satisfies Record<Exclude<MachineProgressKey, `production:${string}`>, string>

export const MACHINE_PROGRESS_STATIC_ORDER = [
  'created',
  'decoded',
  'planned',
  'waiting_request',
  'purchasing',
  'material_received',
  'shipped',
] satisfies Exclude<MachineProgressKey, `production:${string}`>[]

type ProgressMachineItem = {
  is_sample?: boolean | null
}

type ProgressProductionStage = {
  stage_type: StageType
  date_start?: string | null
  date_end?: string | null
  is_skipped?: boolean | null
}

export type MachineProgressOutsourcingInput = {
  id: string
  work_type_name?: string | null
  position_after_stage_type?: StageType | null
  source_stage_type?: StageType | null
  planned_send_date?: string | null
  planned_return_date?: string | null
  actual_sent_at?: string | null
  actual_returned_at?: string | null
}

export type MachineProgressMachineInput = {
  is_confirmed?: boolean | null
  actual_shipping_date?: string | null
  item_count?: number | null
  machine_items?: ProgressMachineItem[] | null
  production_stages?: ProgressProductionStage[] | null
}

export type MachineProgressRequestInput = {
  id: string
  status: RequestStatus
  created_at?: string | null
  updated_at?: string | null
  submitted_at?: string | null
  orderStatuses?: OrderItemStatus[]
}

export type MachineProgressFactInput = {
  id: string
  section_id: string
  section_name?: string | null
  production_stage_type?: StageType | null
  fact_date: string
  shift: ProductionFactShift
  created_at?: string | null
  updated_at?: string | null
}

export type MachineProgressContext = {
  request?: MachineProgressRequestInput | null
  latestFact?: MachineProgressFactInput | null
  outsourcingOperations?: MachineProgressOutsourcingInput[] | null
}

export type MachineReadiness = {
  hasGoods: boolean
  decoded: boolean
  planned: boolean
  blockers: string[]
}

function hasValue(value: string | null | undefined) {
  return Boolean(value && value.trim().length > 0)
}

function hasRequiredStageDates(stage: Pick<ProgressProductionStage, 'stage_type' | 'date_start' | 'date_end'>) {
  if (stage.stage_type === 'shipping') return hasValue(stage.date_end)
  return hasValue(stage.date_start) && hasValue(stage.date_end)
}

export function machineHasGoods(machine: MachineProgressMachineInput) {
  if (machine.machine_items) {
    return machine.machine_items.some((item) => !item.is_sample)
  }
  return Number(machine.item_count || 0) > 0
}

export function getMachineReadiness(machine: MachineProgressMachineInput): MachineReadiness {
  const hasGoods = machineHasGoods(machine)
  const decoded = hasGoods && machine.is_confirmed === true
  const activeStages = (machine.production_stages || [])
    .filter((stage) => !stage.is_skipped && stage.stage_type !== 'actual_shipping')
  const shippingStage = activeStages.find((stage) => stage.stage_type === 'shipping')
  const allActiveStagesDated = activeStages.length > 0
    && activeStages.every(hasRequiredStageDates)
  const planned = allActiveStagesDated
    && Boolean(shippingStage && hasRequiredStageDates(shippingStage))
  const blockers: string[] = []

  if (!hasGoods) blockers.push('Добавьте хотя бы один товар')
  if (hasGoods && machine.is_confirmed !== true) blockers.push('Подтвердите машину у менеджера')
  if (!planned) blockers.push('Заполните даты активных этапов: начало и окончание для производства, одну дату для готовности к погрузке')

  return { hasGoods, decoded, planned, blockers }
}

export function assertMachineReadyForTechnologistRequest(machine: MachineProgressMachineInput) {
  const readiness = getMachineReadiness(machine)
  if (readiness.decoded && readiness.planned) return
  throw new Error(`Нельзя оформить заявку технолога: ${readiness.blockers.join('; ')}`)
}

function shiftRank(shift: ProductionFactShift) {
  return shift === 'night' ? 1 : 0
}

function timeRank(value: string | null | undefined) {
  return value ? new Date(value).getTime() || 0 : 0
}

export function compareProductionFacts(left: MachineProgressFactInput, right: MachineProgressFactInput) {
  const dateCompare = left.fact_date.localeCompare(right.fact_date)
  if (dateCompare !== 0) return dateCompare

  const shiftCompare = shiftRank(left.shift) - shiftRank(right.shift)
  if (shiftCompare !== 0) return shiftCompare

  const updatedCompare = timeRank(left.updated_at) - timeRank(right.updated_at)
  if (updatedCompare !== 0) return updatedCompare

  return timeRank(left.created_at) - timeRank(right.created_at)
}

export function pickLatestProductionFact(facts: MachineProgressFactInput[]) {
  return [...facts].sort(compareProductionFacts).at(-1) || null
}

function requestTimeRank(request: MachineProgressRequestInput) {
  return Math.max(timeRank(request.updated_at), timeRank(request.submitted_at), timeRank(request.created_at))
}

export function pickActiveTechnologistRequest(requests: MachineProgressRequestInput[]) {
  return [...requests].sort((left, right) => requestTimeRank(left) - requestTimeRank(right)).at(-1) || null
}

function isSubmittedToSupply(request: MachineProgressRequestInput | null | undefined) {
  return request?.status === 'submitted_to_supply' || request?.status === 'completed'
}

function isMaterialReceived(request: MachineProgressRequestInput | null | undefined) {
  if (!request) return false
  if (request.status === 'completed') return true
  if (request.status !== 'submitted_to_supply') return false
  const statuses = request.orderStatuses || []
  return statuses.every((status) => status === 'delivered')
}

function stepState(
  isDone: boolean,
  isActive: boolean,
  isBlocked = false,
): MachineProgressStepState {
  if (isDone) return 'done'
  if (isBlocked) return 'blocked'
  if (isActive) return 'active'
  return 'pending'
}

function productionKey(fact: MachineProgressFactInput) {
  return `production:${fact.section_id}` as const
}

function productionStageKey(stageType: StageType) {
  return `production:stage:${stageType}` as const
}

function outsourcingKey(operation: Pick<MachineProgressOutsourcingInput, 'id'>) {
  return `production:outsourcing:${operation.id}` as const
}

function stageOrder(stageType: StageType | null | undefined) {
  const index = stageType ? STAGE_ORDER.indexOf(stageType) : -1
  return index >= 0 ? index : STAGE_ORDER.length
}

function stageLabel(stageType: StageType) {
  return STAGES[stageType]?.label || stageType
}

function normalizeLabel(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU')
}

function inferFactStageType(fact: MachineProgressFactInput | null) {
  if (!fact) return null
  if (fact.production_stage_type) return fact.production_stage_type

  const label = normalizeLabel(fact.section_name)
  if (!label) return null
  if (label.includes('заготов')) return 'cutting' satisfies StageType
  if (label.includes('цех') || label.includes('сбор') || label.includes('свар')) return 'assembly' satisfies StageType
  if (label.includes('зачистк')) return 'cleaning' satisfies StageType
  if (label.includes('цинк')) return 'galvanizing' satisfies StageType
  if (label.includes('маляр') || label.includes('покрас')) return 'painting' satisfies StageType
  if (label.includes('упаков')) return 'packaging' satisfies StageType
  if (label.includes('отгруз')) return 'actual_shipping' satisfies StageType
  return null
}

function isPlannedStage(stage: ProgressProductionStage) {
  return !stage.is_skipped && stage.stage_type !== 'actual_shipping' && hasRequiredStageDates(stage)
}

function outsourcingLabel(operation: MachineProgressOutsourcingInput) {
  const name = operation.work_type_name?.trim() || 'Аутсорсинг'
  return normalizeLabel(name).includes('аутсорс') ? name : `Аутсорсинг: ${name}`
}

function outsourcingAnchorStage(operation: MachineProgressOutsourcingInput) {
  return operation.position_after_stage_type || operation.source_stage_type || null
}

type ProductionProgressItem = {
  key: MachineProgressKey
  label: string
  order: number
  stageType?: StageType | null
  outsourcing?: MachineProgressOutsourcingInput
}

function buildProductionProgressItems(
  machine: MachineProgressMachineInput,
  context: MachineProgressContext,
  latestFact: MachineProgressFactInput | null,
  latestFactStageType: StageType | null,
) {
  const plannedStages = (machine.production_stages || [])
    .filter(isPlannedStage)
    .sort((left, right) => stageOrder(left.stage_type) - stageOrder(right.stage_type))

  const items: ProductionProgressItem[] = plannedStages.map((stage, index) => ({
    key: productionStageKey(stage.stage_type),
    label: stageLabel(stage.stage_type),
    order: stageOrder(stage.stage_type) + index / 1000,
    stageType: stage.stage_type,
  }))

  for (const [index, operation] of (context.outsourcingOperations || []).entries()) {
    const anchor = outsourcingAnchorStage(operation)
    const anchorOrder = anchor ? stageOrder(anchor) : Math.max(0, STAGE_ORDER.indexOf('shipping') - 1)
    items.push({
      key: outsourcingKey(operation),
      label: outsourcingLabel(operation),
      order: anchorOrder + 0.45 + index / 1000,
      stageType: anchor,
      outsourcing: operation,
    })
  }

  if (latestFact && latestFactStageType && !items.some((item) => item.key === productionStageKey(latestFactStageType))) {
    items.push({
      key: productionStageKey(latestFactStageType),
      label: stageLabel(latestFactStageType),
      order: stageOrder(latestFactStageType),
      stageType: latestFactStageType,
    })
  } else if (latestFact && !latestFactStageType) {
    const fallbackKey = productionKey(latestFact)
    if (!items.some((item) => item.key === fallbackKey)) {
      items.push({
        key: fallbackKey,
        label: latestFact.section_name?.trim() || 'Производство',
        order: STAGE_ORDER.length,
      })
    }
  }

  return items.sort((left, right) => left.order - right.order)
}

function pickActiveOutsourcing(operations: MachineProgressOutsourcingInput[]) {
  return operations.find((operation) => hasValue(operation.actual_sent_at) && !hasValue(operation.actual_returned_at)) || null
}

function findItemOrder(items: ProductionProgressItem[], key: MachineProgressKey | undefined) {
  if (!key) return null
  return items.find((item) => item.key === key)?.order ?? null
}

function pickLastCompletedOutsourcing(
  operations: MachineProgressOutsourcingInput[],
  items: ProductionProgressItem[],
) {
  return operations
    .filter((operation) => hasValue(operation.actual_returned_at))
    .map((operation) => ({
      operation,
      order: findItemOrder(items, outsourcingKey(operation)),
    }))
    .filter((item): item is { operation: MachineProgressOutsourcingInput; order: number } => item.order !== null)
    .sort((left, right) => left.order - right.order)
    .at(-1)?.operation || null
}

export function resolveMachineProgress(
  machine: MachineProgressMachineInput,
  context: MachineProgressContext = {},
): MachineProgress {
  const readiness = getMachineReadiness(machine)
  const request = context.request || null
  const latestFact = context.latestFact || null
  const latestFactStageType = inferFactStageType(latestFact)
  const productionItems = buildProductionProgressItems(machine, context, latestFact, latestFactStageType)
  const activeOutsourcing = pickActiveOutsourcing(context.outsourcingOperations || [])
  const completedOutsourcing = pickLastCompletedOutsourcing(context.outsourcingOperations || [], productionItems)
  const submittedToSupply = isSubmittedToSupply(request)
  const materialReceived = isMaterialReceived(request)
  const shipped = hasValue(machine.actual_shipping_date)
  const latestFactKey = latestFact
    ? latestFactStageType ? productionStageKey(latestFactStageType) : productionKey(latestFact)
    : undefined
  const latestFactOrder = findItemOrder(productionItems, latestFactKey)
  const completedOutsourcingKey = completedOutsourcing ? outsourcingKey(completedOutsourcing) : undefined
  const completedOutsourcingOrder = findItemOrder(productionItems, completedOutsourcingKey)
  let productionCurrentKey = latestFactKey
  let productionCurrentLabel = latestFact?.section_name?.trim() || 'Производство'
  if (completedOutsourcing && completedOutsourcingKey && (completedOutsourcingOrder ?? -1) > (latestFactOrder ?? -1)) {
    productionCurrentKey = completedOutsourcingKey
    productionCurrentLabel = outsourcingLabel(completedOutsourcing)
  }
  if (activeOutsourcing) {
    productionCurrentKey = outsourcingKey(activeOutsourcing)
    productionCurrentLabel = outsourcingLabel(activeOutsourcing)
  }
  let currentKey: MachineProgressKey = 'created'
  let currentLabel = MACHINE_PROGRESS_STATIC_LABELS.created

  if (shipped) {
    currentKey = 'shipped'
    currentLabel = MACHINE_PROGRESS_STATIC_LABELS.shipped
  } else if (!readiness.decoded) {
    currentKey = 'decoded'
    currentLabel = MACHINE_PROGRESS_STATIC_LABELS.decoded
  } else if (!readiness.planned) {
    currentKey = 'planned'
    currentLabel = MACHINE_PROGRESS_STATIC_LABELS.planned
  } else if (productionCurrentKey && (latestFact || activeOutsourcing || completedOutsourcing)) {
    currentKey = productionCurrentKey
    currentLabel = productionCurrentLabel
  } else if (materialReceived) {
    currentKey = 'material_received'
    currentLabel = MACHINE_PROGRESS_STATIC_LABELS.material_received
  } else if (submittedToSupply) {
    currentKey = 'purchasing'
    currentLabel = MACHINE_PROGRESS_STATIC_LABELS.purchasing
  } else {
    currentKey = 'waiting_request'
    currentLabel = MACHINE_PROGRESS_STATIC_LABELS.waiting_request
  }

  const ready = readiness.decoded && readiness.planned
  const reachedWaiting = ready
  const reachedPurchasing = reachedWaiting && submittedToSupply
  const reachedMaterial = reachedPurchasing && materialReceived
  const reachedProduction = ready && Boolean(latestFact || activeOutsourcing)
  const activeProductionOrder = productionCurrentKey
    ? productionItems.find((item) => item.key === productionCurrentKey)?.order ?? null
    : null

  const steps: MachineProgressStep[] = [
    {
      key: 'created',
      label: MACHINE_PROGRESS_STATIC_LABELS.created,
      state: 'done',
      kind: 'milestone',
    },
    {
      key: 'decoded',
      label: MACHINE_PROGRESS_STATIC_LABELS.decoded,
      state: stepState(readiness.decoded, !readiness.decoded, !readiness.decoded),
      kind: 'check',
      blocker: readiness.decoded ? null : readiness.blockers.find((item) => item.includes('товар') || item.includes('Подтвердите')) || null,
    },
    {
      key: 'planned',
      label: MACHINE_PROGRESS_STATIC_LABELS.planned,
      state: stepState(readiness.planned, readiness.decoded && !readiness.planned, !readiness.planned),
      kind: 'check',
      blocker: readiness.planned ? null : readiness.blockers.find((item) => item.includes('дат')) || null,
    },
    {
      key: 'waiting_request',
      label: MACHINE_PROGRESS_STATIC_LABELS.waiting_request,
      state: stepState(reachedPurchasing || reachedMaterial || reachedProduction || shipped, ready && !submittedToSupply),
      kind: 'milestone',
    },
    {
      key: 'purchasing',
      label: MACHINE_PROGRESS_STATIC_LABELS.purchasing,
      state: stepState(reachedMaterial || reachedProduction || shipped, reachedPurchasing && !materialReceived && !latestFact),
      kind: 'milestone',
    },
    {
      key: 'material_received',
      label: MACHINE_PROGRESS_STATIC_LABELS.material_received,
      state: stepState(reachedProduction || shipped, reachedMaterial && !latestFact),
      kind: 'milestone',
    },
  ]

  for (const item of productionItems) {
    const outsourcing = item.outsourcing
    const outsourcingDone = outsourcing ? hasValue(outsourcing.actual_returned_at) : false
    const outsourcingActive = outsourcing ? hasValue(outsourcing.actual_sent_at) && !hasValue(outsourcing.actual_returned_at) : false
    const passedByCurrentProduction = activeProductionOrder !== null && item.order < activeProductionOrder
    const done = shipped || outsourcingDone || (!outsourcingActive && passedByCurrentProduction)
    const active = !done && (outsourcingActive || item.key === productionCurrentKey)

    steps.push({
      key: item.key,
      label: item.label,
      state: stepState(done, active),
      kind: 'production',
    })
  }

  steps.push({
    key: 'shipped',
    label: MACHINE_PROGRESS_STATIC_LABELS.shipped,
    state: stepState(shipped, false),
    kind: 'milestone',
  })

  return {
    currentKey,
    currentLabel,
    steps,
    blockers: readiness.decoded && readiness.planned ? [] : readiness.blockers,
  }
}
