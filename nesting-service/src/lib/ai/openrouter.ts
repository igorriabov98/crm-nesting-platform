import * as fs from 'node:fs/promises';
import type { BOMEntry, DetailEntry, PDFAnalysisResult, SteelTypeCatalogItem } from './types';

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
};

const systemPrompt = `Ты — опытный технолог на производстве листового металла. Тебе дан PDF-чертёж изделия (сборочный чертёж + чертежи деталей + спецификация).

Извлеки ДВА набора данных:

## 1. СПЕЦИФИКАЦИЯ (BOM)
Из таблицы спецификации (обычно на 2-3 странице) извлеки все позиции:
- position: номер позиции (число)
- designation: обозначение (например "ЛЕДА.024.00.008")
- name: наименование ("Стенка боковая")
- quantity: количество штук

## 2. ДАННЫЕ ДЕТАЛЕЙ
Для каждой детали, у которой есть отдельный чертёж в PDF, извлеки:
- designation: обозначение детали (например "ЛЕДА.024.00.005")
- name: наименование
- material_full: полное обозначение материала из штампа чертежа 
  (например "Лист БТ-ПН-2,0 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97")
- material_type: тип материала ("Сталь", "Нержавейка", "Алюминий")
- material_grade: марка стали ("Ст3пс", "09Г2С", "12Х18Н10Т", "АМг3")
- thickness_mm: толщина в мм, извлечённая из обозначения листа:
  - "БТ-ПН-2,0" → 2.0
  - "Б-ПН-3" → 3.0
  - "БТ-ПН-8" → 8.0
  - "Б-ПН-1,5" → 1.5
  Число после "ПН-" — это толщина в мм
- unfolding_width: ширина развёртки в мм (из строки "Развертка - ШхВ мм")
- unfolding_height: высота развёртки в мм
- mass_kg: масса детали в кг (из штампа)
- is_sheet_metal: true если деталь изготавливается из листа (есть обозначение листа в материале)
- notes: примечания с чертежа

ВАЖНО:
- Толщину ВСЕГДА извлекай из обозначения материала (число после "ПН-"), НЕ из размеров на чертеже
- Развёртку ищи в примечаниях: "Развертка - 1172×1186 мм" или "Развёртка - 360×55 мм"
- Если на чертеже указано "Допускается изготавливать из листа толщиной 2мм и 2,5мм" — укажи в notes
- Если деталь не имеет отдельного чертежа (например "Заглушка пластмассовая") — пропусти данные детали, укажи только BOM-строку
- В материалах: "Ст3пс", "Ст3сп" → Сталь; "12Х18Н10Т", "08Х18Н10" → Нержавейка; "АМг3", "АД31" → Алюминий

Ответь СТРОГО JSON-объектом без пояснений:
{
  "bom": [
    {"position": "1", "designation": "ЛЕДА.024.00.001", "name": "Обшивка верхняя", "quantity": 1}
  ],
  "details": [
    {
      "designation": "ЛЕДА.024.00.001",
      "name": "Обшивка верхняя",
      "material_full": "Лист БТ-ПН-2,0 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97",
      "material_type": "Сталь",
      "material_grade": "Ст3пс",
      "thickness_mm": 2.0,
      "unfolding_width": 1172,
      "unfolding_height": 1186,
      "mass_kg": 21.71,
      "is_sheet_metal": true,
      "notes": ""
    }
  ]
}`;

export async function analyzePDF(
  pdfFilePath: string,
  options: { steelTypes?: SteelTypeCatalogItem[] } = {}
): Promise<PDFAnalysisResult> {
  const cfg = await loadOpenRouterConfig();
  const pdfBuffer = await fs.readFile(pdfFilePath);
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const knownSteelTypes = buildKnownSteelTypesText(options.steelTypes ?? []);

  const requestBody = {
    model: cfg.model,
    messages: [
      {
        role: 'system',
        content: systemPrompt + knownSteelTypes,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Извлеки спецификацию BOM и данные отдельных деталей из чертежа. Верни только JSON по заданной схеме.',
          },
          {
            type: 'file',
            file: {
              filename: 'drawing.pdf',
              file_data: dataUrl,
            },
          },
        ],
      },
    ],
    max_tokens: cfg.maxTokens,
    temperature: 0.1,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'pdf_drawing_extraction',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            bom: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  position: { type: 'string' },
                  designation: { type: 'string' },
                  name: { type: 'string' },
                  quantity: { type: 'integer' },
                },
                required: ['position', 'designation', 'name', 'quantity'],
              },
            },
            details: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  designation: { type: 'string' },
                  name: { type: 'string' },
                  material_full: { type: 'string' },
                  material_type: { type: 'string' },
                  material_grade: { type: 'string' },
                  thickness_mm: { type: 'number' },
                  unfolding_width: { type: ['number', 'null'] },
                  unfolding_height: { type: ['number', 'null'] },
                  mass_kg: { type: ['number', 'null'] },
                  is_sheet_metal: { type: 'boolean' },
                  notes: { type: 'string' },
                },
                required: [
                  'designation',
                  'name',
                  'material_full',
                  'material_type',
                  'material_grade',
                  'thickness_mm',
                  'unfolding_width',
                  'unfolding_height',
                  'mass_kg',
                  'is_sheet_metal',
                  'notes',
                ],
              },
            },
          },
          required: ['bom', 'details'],
        },
      },
    },
  };

  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nesting-service.local',
        'X-OpenRouter-Title': 'Nesting Service - PDF Analysis',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[openrouter] API error:', response.status, sanitizeError(errorBody));
      return {
        success: false,
        bom: [],
        details: [],
        rawResponse: errorBody,
        model: cfg.model,
        tokensUsed: 0,
        error: `OpenRouter API ошибка: ${response.status}. ${sanitizeError(errorBody).slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as OpenRouterResponse;
    const content = extractContent(data);
    const tokensUsed = data.usage?.total_tokens || 0;
    let bom: BOMEntry[] = [];
    let details: DetailEntry[] = [];

    try {
      const parsed = parsePDFAnalysisResponse(content);
      bom = parsed.bom;
      details = parsed.details;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[openrouter] JSON parse error:', message);
      return {
        success: false,
        bom: [],
        details: [],
        rawResponse: content,
        model: cfg.model,
        tokensUsed,
        error: `Не удалось разобрать ответ AI: ${message}`,
      };
    }

    console.log(`[openrouter] PDF analyzed: ${bom.length} BOM entries, ${details.length} detail entries, ${tokensUsed} tokens`);

    return {
      success: true,
      bom,
      details,
      rawResponse: content,
      model: cfg.model,
      tokensUsed,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[openrouter] Request failed:', message);
    return {
      success: false,
      bom: [],
      details: [],
      rawResponse: '',
      model: cfg.model,
      tokensUsed: 0,
      error: `Ошибка подключения к OpenRouter: ${message}`,
    };
  }
}

export async function testOpenRouterConnection(): Promise<{ ok: boolean; model: string; error: string | null }> {
  const cfg = await loadOpenRouterConfig();

  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nesting-service.local',
        'X-OpenRouter-Title': 'Nesting Service - Connection Test',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'Ответь одним словом: ok' }],
        max_tokens: 20,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        ok: false,
        model: cfg.model,
        error: `OpenRouter API ошибка: ${response.status}. ${sanitizeError(errorBody).slice(0, 200)}`,
      };
    }

    return { ok: true, model: cfg.model, error: null };
  } catch (error) {
    return {
      ok: false,
      model: cfg.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractContent(data: OpenRouterResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => item.text || '').join('\n');
  }
  return '';
}

async function loadOpenRouterConfig() {
  const { getOpenRouterConfig } = await import('./settings');
  return getOpenRouterConfig();
}

export function parsePDFAnalysisResponse(content: string): { bom: BOMEntry[]; details: DetailEntry[] } {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(jsonStr) as unknown;
  let bomEntries: unknown[] = [];
  let detailEntries: unknown[] = [];

  if (Array.isArray(parsed)) {
    bomEntries = parsed;
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.bom)) bomEntries = parsed.bom;
    else if (Array.isArray(parsed.entries)) bomEntries = parsed.entries;
    else if (Array.isArray(parsed.data)) bomEntries = parsed.data;
    if (Array.isArray(parsed.details)) detailEntries = parsed.details;
  }

  const bom = bomEntries
    .map((entry) => normalizeBOMEntry(entry))
    .filter((entry): entry is BOMEntry => Boolean(entry && (entry.name.length > 0 || entry.designation.length > 0)));
  const details = detailEntries
    .map((entry) => normalizeDetailEntry(entry))
    .filter((entry): entry is DetailEntry => Boolean(entry && entry.designation.length > 0));

  return { bom, details };
}

export function parseBOM(content: string): BOMEntry[] {
  return parsePDFAnalysisResponse(content).bom;
}

function normalizeBOMEntry(entry: unknown): BOMEntry | null {
  if (!isRecord(entry)) return null;

  const quantity = Number(entry.quantity);
  const rawThickness = entry.thickness === null || entry.thickness === undefined || entry.thickness === ''
    ? null
    : Number(entry.thickness);

  return {
    position: String(entry.position || ''),
    designation: String(entry.designation || '').trim(),
    name: String(entry.name || '').trim(),
    material: String(entry.material || 'Не указан').trim() || 'Не указан',
    steelTypeRaw: normalizeNullableText(
      entry.steelTypeRaw ?? entry.steel_type ?? entry.steelType ?? entry.materialGrade ?? entry.material_grade
    ),
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
    thickness: typeof rawThickness === 'number' && Number.isFinite(rawThickness) && rawThickness > 0 ? rawThickness : null,
    notes: String(entry.notes || ''),
  };
}

function normalizeDetailEntry(entry: unknown): DetailEntry | null {
  if (!isRecord(entry)) return null;

  const materialFull = String(entry.material_full ?? entry.materialFull ?? '').trim();
  const materialType = normalizeMaterialType(String(entry.material_type ?? entry.materialType ?? materialFull));

  return {
    designation: String(entry.designation || '').trim(),
    name: String(entry.name || '').trim(),
    materialFull,
    materialType,
    materialGrade: String(entry.material_grade ?? entry.materialGrade ?? '').trim(),
    thicknessMm: normalizePositiveNumber(entry.thickness_mm ?? entry.thicknessMm) ?? 0,
    unfoldingWidth: normalizePositiveNumber(entry.unfolding_width ?? entry.unfoldingWidth),
    unfoldingHeight: normalizePositiveNumber(entry.unfolding_height ?? entry.unfoldingHeight),
    massKg: normalizePositiveNumber(entry.mass_kg ?? entry.massKg),
    isSheetMetal: normalizeBoolean(entry.is_sheet_metal ?? entry.isSheetMetal),
    notes: String(entry.notes || ''),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeError(value: string): string {
  return value.replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-***');
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'да' || text === 'yes';
}

function normalizeMaterialType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('нерж') || lower.includes('12х18') || lower.includes('08х18') || lower.includes('aisi')) return 'Нержавейка';
  if (lower.includes('алюм') || lower.includes('амг') || lower.includes('ад31')) return 'Алюминий';
  return 'Сталь';
}

function buildKnownSteelTypesText(steelTypes: SteelTypeCatalogItem[]): string {
  if (steelTypes.length === 0) return '';
  const names = steelTypes.map((steelType) => steelType.name).filter(Boolean).join(', ');
  return names ? `\n\nCRM steel_types: ${names}. Если марка стали есть в этом списке, запиши её в material_grade.` : '';
}
