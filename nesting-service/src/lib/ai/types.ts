export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4-6';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_AI_MAX_TOKENS = 4000;
export const DEFAULT_AI_MONTHLY_BUDGET = 50;

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

export interface BOMEntry {
  articleNumber: string;
  position: string;
  designation: string;
  description: string;
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
}

export interface PDFAnalysisResult {
  success: boolean;
  bom: BOMEntry[];
  details: DetailEntry[];
  rawResponse: string;
  model: string;
  tokensUsed: number;
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
  thickness: number;
  width: number;
  height: number;
  bboxSizeX?: number | null;
  bboxSizeY?: number | null;
  bboxSizeZ?: number | null;
  meshVolume?: number | null;
  meshArea?: number | null;
  facesCount?: number | null;
  isSheetMetal: boolean;
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
  suggestedHasBends: boolean | null;
  suggestedMassKg: number | null;
  detailNotes: string;
  autoApplied: boolean;
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
