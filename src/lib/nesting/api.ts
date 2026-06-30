import 'server-only'

export type NestingStatus = 'created' | 'parsing' | 'parsed' | 'calculating' | 'done' | 'error'
export type NestingStrategy = 'minWaste' | 'remnant' | 'minSheets'
export type ClassificationMethod = 'bbox' | 'normals' | 'volume_area' | 'heuristic'
export type NestingMaterial = 'Сталь' | 'Нержавейка' | 'Алюминий'

export interface NestingProject {
  id: string
  orderNumber: string
  quantity: number
  strategy: NestingStrategy | string
  status: NestingStatus
  errorMessage: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  pdfFileUrl: string | null
  partsCount: number
  sheetsCount: number
  avgUtilization: number | null
}

export interface NestingPart {
  id: string
  sourceInputId?: string | null
  sourceId?: string | null
  sourceType?: string | null
  sourceLabel?: string | null
  sourceMachineId?: string | null
  sourceMachineName?: string | null
  sourceMachineItemId?: string | null
  sourceProductId?: string | null
  name: string
  thickness: number
  material: NestingMaterial | string
  steelTypeId: string | null
  steelTypeName: string | null
  steelTypeRaw: string | null
  width: number
  height: number
  quantity: number
  isSheetMetal: boolean
  grainLock: boolean
  hasBends: boolean
  thumbnailSvg: string | null
  classificationMethod: ClassificationMethod | string | null
  classificationWarning: string | null
}

export interface NestingPartDetail extends NestingPart {
  contour: { x: number; y: number }[]
  holes: { x: number; y: number }[][]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  totalPages: number
}

export interface NestingProjectStatus {
  id: string
  status: NestingStatus | string
  errorMessage: string | null
}

export interface Placement {
  partId: string
  name: string
  sourceInputId?: string | null
  sourceId?: string | null
  sourceType?: string | null
  sourceLabel?: string | null
  sourceMachineId?: string | null
  sourceMachineName?: string | null
  sourceMachineItemId?: string | null
  sourceProductId?: string | null
  x: number
  y: number
  rotation: 0 | 90
  placedW: number
  placedH: number
  contour?: { x: number; y: number }[]
  holes?: { x: number; y: number }[][]
  leadIn?: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>
  leadOut?: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>
}

export interface RemnantGeom {
  id: string
  x: number
  y: number
  width: number
  height: number
  area: number
  isUsable: boolean
}

export interface SheetResult {
  id: string
  sheetIndex: number
  material: string
  steelTypeId: string | null
  steelTypeName: string | null
  thickness: number
  width: number
  height: number
  isRemnant: boolean
  placements: Placement[]
  utilization: number
  waste: number
  remnantGeom: RemnantGeom | null
  remnantCandidates: RemnantGeom[]
  selectedRemnants: RemnantGeom[]
}

export interface NestingResult {
  sheets: SheetResult[]
  unplacedParts: { partId: string; name: string }[]
  totalParts: number
  placedParts: number
  totalSheets: number
  avgUtilization: number
  totalWaste: number
}

export interface BOMEntry {
  position: string
  designation: string
  name: string
  material: string
  steelTypeRaw: string | null
  steelTypeId: string | null
  steelTypeName: string | null
  steelTypeWarning: string | null
  quantity: number
  thickness: number | null
  notes: string
}

export interface DetailEntry {
  designation: string
  name: string
  materialFull: string
  materialType: string
  materialGrade: string
  thicknessMm: number
  unfoldingWidth: number | null
  unfoldingHeight: number | null
  massKg: number | null
  isSheetMetal: boolean
  notes: string
}

export interface AIMatchResult {
  partId: string
  partName: string
  bomPosition: string
  bomDesignation: string
  bomName: string
  matchType: 'exact' | 'contains' | 'designation' | 'fuzzy' | 'none'
  matchConfidence: number
  suggestedMaterial: string | null
  suggestedMaterialGrade: string | null
  suggestedSteelTypeId: string | null
  suggestedSteelTypeName: string | null
  suggestedSteelTypeRaw: string | null
  steelTypeWarning: string | null
  suggestedQuantity: number | null
  suggestedThickness: number | null
  suggestedUnfoldingWidth: number | null
  suggestedUnfoldingHeight: number | null
  suggestedIsSheetMetal: boolean | null
  suggestedMassKg: number | null
  detailNotes: string
  autoApplied: boolean
}

export interface AIAnalysisResponse {
  data: {
    bom: BOMEntry[]
    details: DetailEntry[]
    matches: AIMatchResult[]
    unmatchedBom: BOMEntry[]
    tokensUsed: number
    model: string
    cost: number
    budgetWarning: boolean
    createdAt?: string
    updatedAt?: string
  }
}

export interface AISettings {
  model: string
  baseUrl: string
  hasApiKey: boolean
  maxTokens: number
  monthlyBudget: number
  currentMonthUsage: number
  currentMonthRequests: number
  totalRequests: number
  averageRequestCost: number
  budgetWarning: boolean
}

export interface AIUsageHistoryItem {
  id: string
  projectId: string
  orderNumber: string
  tokensUsed: number
  model: string
  cost: number
  createdAt: string
}

export interface AIUsageHistoryResponse {
  data: AIUsageHistoryItem[]
  total: number
}

export interface AIStatus {
  configured: boolean
  hasApiKey: boolean
  budgetWarning: boolean
  currentMonthUsage: number
  monthlyBudget: number
}

type ErrorPayload = {
  error?: string
  message?: string
}

export function getNestingServiceUrl() {
  return process.env.NESTING_SERVICE_URL || 'http://localhost:4000'
}

export function withNestingServiceAuth(init: RequestInit = {}): RequestInit {
  const secret = process.env.NESTING_SERVICE_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('NESTING_SERVICE_SECRET is required in production')
  }

  const headers = new Headers(init.headers)
  if (secret) headers.set('Authorization', `Bearer ${secret}`)
  return { ...init, headers }
}

export function fetchNestingService(input: URL | string, init: RequestInit = {}) {
  return fetch(input, withNestingServiceAuth(init))
}

function buildUrl(path: string, params?: Record<string, string | number | undefined>) {
  const url = new URL(path, getNestingServiceUrl())
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url
}

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (res.ok) {
    return res.json() as Promise<T>
  }

  const payload = await res.json().catch(async () => {
    const text = await res.text().catch(() => '')
    return { error: text || fallbackMessage }
  }) as ErrorPayload

  throw new Error(payload.error || payload.message || `${fallbackMessage}: ${res.status}`)
}

async function request(url: URL | string, init: RequestInit | undefined, fallbackMessage: string) {
  try {
    return await fetchNestingService(url, init)
  } catch (error) {
    const details = error instanceof Error ? error.message : 'неизвестная ошибка'
    throw new Error(`${fallbackMessage}: сервис раскладки недоступен (${details})`)
  }
}

export async function getProjects(params?: {
  page?: number
  limit?: number
  status?: string
  search?: string
}): Promise<PaginatedResponse<NestingProject>> {
  const res = await request(buildUrl('/api/projects', params), { cache: 'no-store' }, 'Не удалось загрузить проекты раскладки')
  return readJson<PaginatedResponse<NestingProject>>(res, 'Не удалось загрузить проекты раскладки')
}

export async function getProject(id: string): Promise<{ data: NestingProject }> {
  const res = await request(buildUrl(`/api/projects/${id}`), { cache: 'no-store' }, 'Проект раскладки не найден')
  return readJson<{ data: NestingProject }>(res, 'Проект раскладки не найден')
}

export async function getProjectStatus(id: string): Promise<NestingProjectStatus> {
  const res = await request(buildUrl(`/api/projects/${id}/status`), { cache: 'no-store' }, 'Не удалось получить статус проекта')
  return readJson<NestingProjectStatus>(res, 'Не удалось получить статус проекта')
}

export async function deleteProject(id: string): Promise<void> {
  const res = await request(buildUrl(`/api/projects/${id}`), { method: 'DELETE' }, 'Не удалось удалить проект')
  if (!res.ok) {
    await readJson(res, 'Не удалось удалить проект')
  }
}

export async function getParts(projectId: string): Promise<{ data: NestingPart[]; total: number }> {
  const res = await request(buildUrl(`/api/projects/${projectId}/parts`), { cache: 'no-store' }, 'Не удалось загрузить детали')
  return readJson<{ data: NestingPart[]; total: number }>(res, 'Не удалось загрузить детали')
}

export async function getPartDetail(projectId: string, partId: string): Promise<{ data: NestingPartDetail }> {
  const res = await request(buildUrl(`/api/projects/${projectId}/parts/${partId}`), { cache: 'no-store' }, 'Деталь не найдена')
  return readJson<{ data: NestingPartDetail }>(res, 'Деталь не найдена')
}

export async function updatePart(
  projectId: string,
  partId: string,
  data: Partial<{
    material: string
    steelTypeId: string | null
    steelTypeName: string | null
    steelTypeRaw: string | null
    quantity: number
    grainLock: boolean
    isSheetMetal: boolean
    thickness: number
    width: number
    height: number
    hasBends: boolean
  }>
): Promise<{ data: NestingPart }> {
  const res = await request(buildUrl(`/api/projects/${projectId}/parts/${partId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось обновить деталь')
  return readJson<{ data: NestingPart }>(res, 'Не удалось обновить деталь')
}

export async function startCalculation(
  projectId: string,
  strategy: NestingStrategy
): Promise<{ data: { id: string; status: NestingStatus | string } }> {
  const res = await request(buildUrl(`/api/projects/${projectId}/calculate`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy }),
  }, 'Не удалось запустить расчёт')
  return readJson<{ data: { id: string; status: NestingStatus | string } }>(res, 'Не удалось запустить расчёт')
}

export async function getResult(projectId: string): Promise<{ data: NestingResult }> {
  const res = await request(buildUrl(`/api/projects/${projectId}/result`), { cache: 'no-store' }, 'Результат раскладки ещё не готов')
  return readJson<{ data: NestingResult }>(res, 'Результат раскладки ещё не готов')
}

export async function getAISettings(): Promise<AISettings> {
  const res = await request(buildUrl('/api/ai/settings'), { cache: 'no-store' }, 'Не удалось загрузить настройки AI')
  return readJson<AISettings>(res, 'Не удалось загрузить настройки AI')
}

export async function getAIUsage(limit = 50): Promise<AIUsageHistoryResponse> {
  const res = await request(buildUrl('/api/ai/usage', { limit }), { cache: 'no-store' }, 'Не удалось загрузить историю AI')
  return readJson<AIUsageHistoryResponse>(res, 'Не удалось загрузить историю AI')
}

export async function getAIStatus(): Promise<AIStatus> {
  const res = await request(buildUrl('/api/ai/status'), { cache: 'no-store' }, 'Не удалось проверить статус AI')
  return readJson<AIStatus>(res, 'Не удалось проверить статус AI')
}

export async function updateAISettings(data: Partial<{
  apiKey: string
  model: string
  baseUrl: string
  maxTokens: number
  monthlyBudget: number
}>): Promise<AISettings> {
  const res = await request(buildUrl('/api/ai/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, 'Не удалось сохранить настройки AI')
  return readJson<AISettings>(res, 'Не удалось сохранить настройки AI')
}

export async function testAIConnection(): Promise<{ ok: boolean; model: string; error: string | null }> {
  const res = await request(buildUrl('/api/ai/test-connection'), { method: 'POST' }, 'Не удалось проверить подключение AI')
  return readJson<{ ok: boolean; model: string; error: string | null }>(res, 'Не удалось проверить подключение AI')
}

export async function analyzeProjectPDF(projectId: string): Promise<AIAnalysisResponse> {
  const res = await request(buildUrl(`/api/projects/${projectId}/analyze-pdf`), { method: 'POST' }, 'Не удалось выполнить AI-анализ PDF')
  return readJson<AIAnalysisResponse>(res, 'Не удалось выполнить AI-анализ PDF')
}

export async function getProjectSpecification(projectId: string): Promise<AIAnalysisResponse> {
  const res = await request(buildUrl(`/api/projects/${projectId}/specification`), { cache: 'no-store' }, 'Не удалось загрузить PDF-спецификацию')
  return readJson<AIAnalysisResponse>(res, 'Не удалось загрузить PDF-спецификацию')
}

export async function applyProjectBOM(
  projectId: string,
  matches: Array<{
    partId: string
    material?: string
    steelTypeId?: string | null
    steelTypeName?: string | null
    steelTypeRaw?: string | null
    quantity?: number
    thickness?: number
    isSheetMetal?: boolean
    unfoldingWidth?: number
    unfoldingHeight?: number
  }>
): Promise<{ updated: number }> {
  const res = await request(buildUrl(`/api/projects/${projectId}/apply-bom`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches }),
  }, 'Не удалось применить предложения AI')
  return readJson<{ updated: number }>(res, 'Не удалось применить предложения AI')
}
