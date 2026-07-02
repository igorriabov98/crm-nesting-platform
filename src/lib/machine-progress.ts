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
  fact_date: string
  shift: ProductionFactShift
  created_at?: string | null
  updated_at?: string | null
}

export type MachineProgressContext = {
  request?: MachineProgressRequestInput | null
  latestFact?: MachineProgressFactInput | null
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
    && activeStages.every((stage) => hasValue(stage.date_start) && hasValue(stage.date_end))
  const planned = allActiveStagesDated
    && Boolean(shippingStage && hasValue(shippingStage.date_start) && hasValue(shippingStage.date_end))
  const blockers: string[] = []

  if (!hasGoods) blockers.push('Добавьте хотя бы один товар')
  if (hasGoods && machine.is_confirmed !== true) blockers.push('Подтвердите машину у менеджера')
  if (!planned) blockers.push('Заполните даты начала и окончания всех активных этапов, включая готовность к погрузке')

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

export function resolveMachineProgress(
  machine: MachineProgressMachineInput,
  context: MachineProgressContext = {},
): MachineProgress {
  const readiness = getMachineReadiness(machine)
  const request = context.request || null
  const latestFact = context.latestFact || null
  const submittedToSupply = isSubmittedToSupply(request)
  const materialReceived = isMaterialReceived(request)
  const shipped = hasValue(machine.actual_shipping_date)
  const productionCurrentKey = latestFact ? productionKey(latestFact) : undefined
  const productionCurrentLabel = latestFact?.section_name?.trim() || 'Производство'
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
  } else if (latestFact && productionCurrentKey) {
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
  const reachedProduction = ready && Boolean(latestFact)

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

  if (latestFact && productionCurrentKey) {
    steps.push({
      key: productionCurrentKey,
      label: productionCurrentLabel,
      state: stepState(shipped, !shipped),
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
