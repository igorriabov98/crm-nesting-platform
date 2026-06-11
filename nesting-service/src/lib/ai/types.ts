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

export interface BOMEntry {
  position: string;
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

export interface PDFAnalysisResult {
  success: boolean;
  bom: BOMEntry[];
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
}

export interface MatchResult {
  partId: string;
  partName: string;
  bomPosition: string;
  bomName: string;
  matchType: 'exact' | 'contains' | 'designation' | 'fuzzy' | 'none';
  matchConfidence: number;
  suggestedMaterial: string | null;
  suggestedSteelTypeId: string | null;
  suggestedSteelTypeName: string | null;
  suggestedSteelTypeRaw: string | null;
  steelTypeWarning: string | null;
  suggestedQuantity: number | null;
  suggestedThickness: number | null;
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
