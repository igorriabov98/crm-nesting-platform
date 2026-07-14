export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.6';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_AI_MAX_TOKENS = 32000;
export const MAX_AI_MAX_TOKENS = 128000;
export const DEFAULT_AI_MONTHLY_BUDGET = 50;
export const DEFAULT_AI_AUTO_APPLY_RESULTS = true;

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  monthlyBudget: number;
}

export interface SteelTypeCatalogItem {
  id: string;
  name: string;
  densityKgMm3?: number | null;
}

export type BOMPartType = 'sheet' | 'channel' | 'angle' | 'round_bar' | 'tube' | 'flat_bar' | 'other';
export type PartType = 'SHEET' | 'PROFILE' | 'PURCHASED';
export type PDFAnalysisFailureKind = 'config_error' | 'provider_error' | 'connection_error' | 'truncated' | 'parse_error' | 'empty_bom';
export type AIAnalysisStatus = 'completed' | 'deterministic_fallback' | 'failed';
export type AIExtractionSource = 'ai' | 'deterministic-fallback' | 'none';

export interface AIAnalysisAudit {
  status: AIAnalysisStatus;
  source: AIExtractionSource;
  warning: string | null;
  aiError: string | null;
  failureKind: PDFAnalysisFailureKind | null;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  maxTokens: number;
}

export interface BOMEntry {
  articleNumber: string;
  position: string;
  designation: string;
  description: string;
  bomSection: string;
  partType: BOMPartType;
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  massKg: number | null;
  materialGrade: string;
  materialType: string;
  norm: string;
  name: string;
  material: string;
  steelTypeRaw: string | null;
  steelTypeId: string | null;
  steelTypeName: string | null;
  steelTypeWarning: string | null;
  quantity: number;
  thickness: number | null;
  notes: string;
  bomSources?: number[];
  sourcePage?: number | null;
  parentAssembly?: string;
  sourcePageGroup?: string;
  source?: Exclude<AIExtractionSource, 'none'>;
}

export interface DetailEntry {
  designation: string;
  name: string;
  materialFull: string;
  materialType: string;
  materialGrade: string;
  thicknessMm: number;
  unfoldingWidth: number | null;
  unfoldingHeight: number | null;
  massKg: number | null;
  isSheetMetal: boolean;
  notes: string;
  sourcePage?: number | null;
  source?: Exclude<AIExtractionSource, 'none'>;
}

export interface PDFAnalysisResult {
  success: boolean;
  bom: BOMEntry[];
  details: DetailEntry[];
  rawResponse: string;
  model: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  finishReason: string | null;
  maxTokens: number;
  failureKind: PDFAnalysisFailureKind | null;
  error: string | null;
}

export interface PartForMatching {
  id: string;
  name: string;
  material: string;
  steelTypeId: string | null;
  steelTypeName: string | null;
  steelTypeRaw: string | null;
  quantity: number;
  thickness: number | null;
  width: number;
  height: number;
  bboxSizeX?: number | null;
  bboxSizeY?: number | null;
  bboxSizeZ?: number | null;
  contour?: unknown;
  meshVolume?: number | null;
  meshArea?: number | null;
  facesCount?: number | null;
  isSheetMetal: boolean;
  partType?: PartType | null;
  hasBends: boolean;
}

export interface MatchResult {
  partId: string;
  partName: string;
  bomPosition: string;
  bomDesignation: string;
  bomName: string;
  matchType: 'exact' | 'contains' | 'designation' | 'geometry' | 'fuzzy' | 'none';
  matchConfidence: number;
  matchDetails: string;
  suggestedMaterial: string | null;
  suggestedMaterialGrade: string | null;
  suggestedSteelTypeId: string | null;
  suggestedSteelTypeName: string | null;
  suggestedSteelTypeRaw: string | null;
  steelTypeWarning: string | null;
  suggestedQuantity: number | null;
  suggestedThickness: number | null;
  suggestedUnfoldingWidth: number | null;
  suggestedUnfoldingHeight: number | null;
  suggestedIsSheetMetal: boolean | null;
  suggestedPartType: PartType | null;
  suggestedHasBends: boolean | null;
  suggestedMassKg: number | null;
  thicknessMismatch: boolean;
  thicknessMismatchNote: string | null;
  detailNotes: string;
  autoApplied: boolean;
  applyStatus?: 'suggested' | 'applied_auto' | 'applied_manual' | 'applied_forced' | 'needs_force' | 'reverted' | 'rejected';
  appliedBy?: string | null;
  appliedAt?: string | null;
  revertedBy?: string | null;
  revertedAt?: string | null;
}

export interface AISettingsView {
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  maxTokens: number;
  monthlyBudget: number;
  currentMonthUsage: number;
  currentMonthRequests: number;
  totalRequests: number;
  averageRequestCost: number;
  budgetWarning: boolean;
  autoApplyResults: boolean;
}

export interface AIUsageHistoryItem {
  id: string;
  projectId: string;
  orderNumber: string;
  tokensUsed: number;
  model: string;
  cost: number;
  createdAt: string;
}
