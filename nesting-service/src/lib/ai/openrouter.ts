import * as fs from 'node:fs/promises';
import {
  DEFAULT_AI_MAX_TOKENS,
  DEFAULT_OPENROUTER_MODEL,
  type BOMEntry,
  type BOMPartType,
  type DetailEntry,
  type OpenRouterConfig,
  type PDFAnalysisFailureKind,
  type PDFAnalysisResult,
  type SteelTypeCatalogItem,
} from './types';
import { mergeUnfoldingWarning, resolveUnfolding } from './unfolding-extraction';

type OpenRouterResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type AnalyzePDFOptions = {
  steelTypes?: SteelTypeCatalogItem[];
  maxTokens?: number;
  configOverride?: Pick<OpenRouterConfig, 'apiKey' | 'model' | 'baseUrl'>;
};

const systemPrompt = `Ты — опытный технолог на производстве металлоконструкций. Тебе дан PDF-чертёж изделия. Чертёж может быть на ЛЮБОМ языке: русском, немецком, английском или другом.

Извлеки ДВА набора данных:

## 1. СПЕЦИФИКАЦИЯ (BOM / MATERIALLISTE / BILL OF MATERIALS)
Найди ВСЕ таблицы спецификаций на ВСЕХ страницах. Документ может содержать НЕСКОЛЬКО НЕЗАВИСИМЫХ спецификаций — по одной на каждую сборочную единицу в иерархии подсборок. Каждую спецификацию обработай отдельно. Таблица может называться:
- Русский: "Спецификация", "Ведомость материалов"
- Немецкий: "MATERIALLISTE", "STÜCKLISTE", "ZUSCHNITTSLISTE"
- Английский: "BILL OF MATERIALS", "BOM", "PARTS LIST"

Для каждой позиции извлеки:
- source_page: номер страницы PDF, на которой найдена строка
- parent_assembly: обозначение сборочной единицы, чьей спецификации принадлежит строка
- bom_section: название раздела спецификации, под которым находится строка ("Детали", "Прочие изделия", "Стандартные изделия", "Zukaufteile", "Kaufteile")
- position: номер позиции, если есть
- article_number: артикул/номер, если есть
- designation: обозначение, номер чертежа или имя файла
- description: описание/наименование, например "BL 3 x 995 x 2318", "U 80 - 690", "Стенка боковая"
- part_type:
  - "BL" или "Лист" или "Blech" или "Sheet" -> "sheet"
  - "U" или "Швеллер" или "UNP" -> "channel"
  - "L" или "Уголок" или "Winkel" -> "angle"
  - "RU" или "Круг" или "Rundstahl" или "Round" -> "round_bar"
  - "RO" или "Труба" или "Rohr" или "Tube" -> "tube"
  - "FL" или "Полоса" или "Flachstahl" -> "flat_bar"
  - Иначе -> "other"
- thickness_mm: толщина в мм, если есть
- width_mm: ширина/первый размер сечения в мм, если есть
- height_mm: длина/высота/главный размер в мм, если есть
- quantity: количество штук (STK, шт, Stk, pcs)
- mass_kg: масса одной штуки в кг, если есть
- material_grade: марка материала ("S235JRG2", "Ст3пс", "304")
- material_type: тип ("Сталь", "Нержавейка", "Алюминий")
- norm: стандарт/норма ("DIN EN 10130", "ГОСТ 19903-90")

Как парсить обозначения:
- "BL 3 x 995 x 2318" -> part_type="sheet", thickness_mm=3, width_mm=995, height_mm=2318
- "BL 20 x 90 x 160" -> part_type="sheet", thickness_mm=20, width_mm=90, height_mm=160
- "U 80 - 690" -> part_type="channel", width_mm=80, height_mm=690
- "U 50 x 38 - 1090" -> part_type="channel", width_mm=50, height_mm=1090
- "RU 16 - 60" -> part_type="round_bar", width_mm=16, height_mm=60
- "L 50 x 50 x 5 - 300" -> part_type="angle", thickness_mm=5, width_mm=50, height_mm=300
- "Б-ПН-3 ГОСТ 19903-90" -> thickness_mm=3
- "БТ-ПН-2,0 ГОСТ 19903-90" -> thickness_mm=2.0
- "Труба 30х30х1,5 ГОСТ 8639-82" -> part_type="tube", width_mm=30, height_mm=30, thickness_mm=1.5

Строки из РАЗНЫХ спецификаций (разных parent_assembly) — НЕ дубликаты, даже при совпадении обозначения. Объединяй только повторы ОДНОЙ таблицы на соседних страницах.

## 2. ДАННЫЕ ДЕТАЛЕЙ (из отдельных чертежей)
Извлеки данные ВСЕХ отдельных чертежей деталей на всех страницах. Каждый чертёж имеет собственный штамп. Для каждой детали извлеки:
- source_page: номер страницы PDF
- designation: обозначение детали или имя файла
- name: наименование детали
- description: обозначение/описание детали
- material_full: полное обозначение материала из штампа
- material_type: тип материала ("Сталь", "Нержавейка", "Алюминий")
- material_grade: марка материала
- thickness_mm: толщина в мм
- unfolding_width: ширина развёртки из "Развертка", "Zuschnitt", "Flat pattern"
- unfolding_height: высота развёртки
- mass_kg: масса
- bend_info: информация о гибах ("NACH OBEN 90°", "NACH UNTEN 66°")
- is_sheet_metal: true если деталь из листа (BL, Лист, Blech, Sheet)
- notes: важные примечания

ВАЖНО:
- Приоритет для развёртки: явная строка примечаний "Развертка AхB мм" / "Развёртка A×B мм"; десятичная запятая допустима.
- Числа в стандарте рядом со словом ГОСТ, например "ГОСТ 19903-90", никогда не являются развёрткой.
- Если это групповой чертёж с таблицей исполнений, верни отдельную detail-запись для каждого исполнения с его размерами развёртки из таблицы.
- Если таблица дублируется на нескольких страницах — объедини, не дублируй записи
- Материал S235JRG2, S235, S355, Ст3пс, Ст3сп -> "Сталь"
- Материал 12Х18Н10Т, 08Х18Н10, AISI 304, 304, 316 -> "Нержавейка"
- Материал АМг3, АД31, 6061 -> "Алюминий"
- Если значение неизвестно: для строк верни "", для чисел null, для boolean false
- Ответь СТРОГО JSON-объектом без пояснений

{
  "bom": [
    {
      "source_page": 2,
      "parent_assembly": "ЛЕДА.024.00.000",
      "bom_section": "Детали",
      "position": "1",
      "article_number": "70000000006505",
      "designation": "10461.geo",
      "description": "BL 3 x 995 x 2318",
      "part_type": "sheet",
      "thickness_mm": 3,
      "width_mm": 995,
      "height_mm": 2318,
      "quantity": 1,
      "mass_kg": 54.41,
      "material_grade": "S235JRG2",
      "material_type": "Сталь",
      "norm": "DIN EN 10130"
    }
  ],
  "details": [
    {
      "source_page": 3,
      "designation": "ЛЕДА.024.00.001",
      "name": "Обшивка верхняя",
      "description": "Обшивка верхняя",
      "material_full": "Лист БТ-ПН-2,0 ГОСТ 19903-90 Ст3пс ГОСТ 16523-97",
      "material_type": "Сталь",
      "material_grade": "Ст3пс",
      "thickness_mm": 2.0,
      "unfolding_width": 1172,
      "unfolding_height": 1186,
      "mass_kg": 21.71,
      "bend_info": "",
      "is_sheet_metal": true,
      "notes": ""
    }
  ]
}`;

export async function analyzePDF(
  pdfFilePath: string,
  options: AnalyzePDFOptions = {}
): Promise<PDFAnalysisResult> {
  let cfg: Pick<OpenRouterConfig, 'apiKey' | 'model' | 'baseUrl' | 'maxTokens'>;
  try {
    cfg = options.configOverride
      ? { ...options.configOverride, maxTokens: options.maxTokens ?? DEFAULT_AI_MAX_TOKENS }
      : await loadOpenRouterConfig();
  } catch (error) {
    return failedPDFAnalysis({
      model: options.configOverride?.model ?? DEFAULT_OPENROUTER_MODEL,
      maxTokens: options.maxTokens ?? DEFAULT_AI_MAX_TOKENS,
      failureKind: 'config_error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const pdfBuffer = await fs.readFile(pdfFilePath);
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const knownSteelTypes = buildKnownSteelTypesText(options.steelTypes ?? []);
  const maxTokens = options.maxTokens ?? cfg.maxTokens;

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
    max_tokens: maxTokens,
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
                  source_page: { type: 'integer' },
                  parent_assembly: { type: 'string' },
                  position: { type: 'string' },
                  article_number: { type: 'string' },
                  bom_section: { type: 'string' },
                  designation: { type: 'string' },
                  description: { type: 'string' },
                  part_type: {
                    type: 'string',
                    enum: ['sheet', 'channel', 'angle', 'round_bar', 'tube', 'flat_bar', 'other'],
                  },
                  thickness_mm: { type: ['number', 'null'] },
                  width_mm: { type: ['number', 'null'] },
                  height_mm: { type: ['number', 'null'] },
                  quantity: { type: 'integer' },
                  mass_kg: { type: ['number', 'null'] },
                  material_grade: { type: 'string' },
                  material_type: { type: 'string' },
                  norm: { type: 'string' },
                },
                required: [
                  'source_page',
                  'parent_assembly',
                  'position',
                  'article_number',
                  'bom_section',
                  'designation',
                  'description',
                  'part_type',
                  'thickness_mm',
                  'width_mm',
                  'height_mm',
                  'quantity',
                  'mass_kg',
                  'material_grade',
                  'material_type',
                  'norm',
                ],
              },
            },
            details: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  source_page: { type: 'integer' },
                  designation: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  material_full: { type: 'string' },
                  material_type: { type: 'string' },
                  material_grade: { type: 'string' },
                  thickness_mm: { type: ['number', 'null'] },
                  unfolding_width: { type: ['number', 'null'] },
                  unfolding_height: { type: ['number', 'null'] },
                  mass_kg: { type: ['number', 'null'] },
                  bend_info: { type: 'string' },
                  is_sheet_metal: { type: 'boolean' },
                  notes: { type: 'string' },
                },
                required: [
                  'source_page',
                  'designation',
                  'name',
                  'description',
                  'material_full',
                  'material_type',
                  'material_grade',
                  'thickness_mm',
                  'unfolding_width',
                  'unfolding_height',
                  'mass_kg',
                  'bend_info',
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
      return failedPDFAnalysis({
        rawResponse: errorBody,
        model: cfg.model,
        maxTokens,
        failureKind: 'api_error',
        error: `OpenRouter API ошибка: ${response.status}. ${sanitizeError(errorBody).slice(0, 200)}`,
      });
    }

    const data = (await response.json()) as OpenRouterResponse;
    const result = parseOpenRouterResponse(data, { model: cfg.model, maxTokens });
    if (result.success) {
      console.log(
        `[openrouter] PDF analyzed: ${result.bom.length} BOM entries, ${result.details.length} detail entries, ` +
        `${result.completionTokens} completion tokens, finish_reason=${result.finishReason}`
      );
    } else {
      console.error('[openrouter] PDF analysis failed:', result.error);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[openrouter] Request failed:', message);
    return failedPDFAnalysis({
      model: cfg.model,
      maxTokens,
      failureKind: 'connection_error',
      error: `Ошибка подключения к OpenRouter: ${message}`,
    });
  }
}

export function parseOpenRouterResponse(
  data: OpenRouterResponse,
  context: { model: string; maxTokens: number }
): PDFAnalysisResult {
  const finishReason = normalizeFinishReason(data.choices?.[0]?.finish_reason ?? data.choices?.[0]?.native_finish_reason);
  const promptTokens = positiveInteger(data.usage?.prompt_tokens);
  const completionTokens = positiveInteger(data.usage?.completion_tokens);
  const tokensUsed = positiveInteger(data.usage?.total_tokens) || promptTokens + completionTokens;
  const content = extractContent(data);

  if (finishReason === 'length' || finishReason === 'max_tokens') {
    return failedPDFAnalysis({
      rawResponse: content,
      model: context.model,
      maxTokens: context.maxTokens,
      failureKind: 'truncated',
      finishReason,
      promptTokens,
      completionTokens,
      tokensUsed,
      error: `AI response truncated: finish_reason=${finishReason}, completion=${completionTokens}/${context.maxTokens}`,
    });
  }

  let parsed: { bom: BOMEntry[]; details: DetailEntry[] };
  try {
    parsed = parsePDFAnalysisResponse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedPDFAnalysis({
      rawResponse: content,
      model: context.model,
      maxTokens: context.maxTokens,
      failureKind: 'parse_error',
      finishReason,
      promptTokens,
      completionTokens,
      tokensUsed,
      error: `AI response parse error: ${message}`,
    });
  }

  if (parsed.bom.length === 0) {
    return failedPDFAnalysis({
      rawResponse: content,
      model: context.model,
      maxTokens: context.maxTokens,
      failureKind: 'empty_bom',
      finishReason,
      promptTokens,
      completionTokens,
      tokensUsed,
      error: 'AI response contained empty BOM',
    });
  }

  return {
    success: true,
    bom: parsed.bom,
    details: parsed.details,
    rawResponse: content,
    model: context.model,
    tokensUsed,
    promptTokens,
    completionTokens,
    finishReason,
    maxTokens: context.maxTokens,
    failureKind: null,
    error: null,
  };
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
    .filter((entry): entry is BOMEntry => Boolean(entry && (
      entry.description.length > 0 ||
      entry.name.length > 0 ||
      entry.designation.length > 0 ||
      entry.articleNumber.length > 0
    )));
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

  const description = String(entry.description ?? entry.name ?? '').trim();
  const parsedGeometry = parseBOMGeometry(description);
  const materialGrade = String(entry.material_grade ?? entry.materialGrade ?? entry.steelTypeRaw ?? entry.steel_type ?? '').trim();
  const materialType = normalizeMaterialType(String(entry.material_type ?? entry.materialType ?? entry.material ?? materialGrade));
  const thicknessMm = normalizePositiveNumber(entry.thickness_mm ?? entry.thicknessMm ?? entry.thickness) ?? parsedGeometry.thicknessMm;
  const widthMm = normalizePositiveNumber(entry.width_mm ?? entry.widthMm) ?? parsedGeometry.widthMm;
  const heightMm = normalizePositiveNumber(entry.height_mm ?? entry.heightMm) ?? parsedGeometry.heightMm;
  const norm = String(entry.norm ?? '').trim();
  const quantity = normalizePositiveNumber(entry.quantity ?? entry.stk ?? entry.qty ?? entry.count);
  const partType = normalizePartType(entry.part_type ?? entry.partType, description) ?? parsedGeometry.partType;
  const material = String(entry.material ?? materialType ?? materialGrade ?? 'Не указан').trim() || 'Не указан';
  const sourcePage = normalizeSourcePage(entry.source_page ?? entry.sourcePage);
  const parentAssembly = String(entry.parent_assembly ?? entry.parentAssembly ?? '').trim();

  return {
    articleNumber: String(entry.article_number ?? entry.articleNumber ?? entry.article ?? '').trim(),
    position: String(entry.position || ''),
    designation: String(entry.designation || '').trim(),
    description,
    bomSection: String(entry.bom_section ?? entry.bomSection ?? entry.section ?? '').trim(),
    partType,
    thicknessMm,
    widthMm,
    heightMm,
    massKg: normalizePositiveNumber(entry.mass_kg ?? entry.massKg ?? entry.weight_kg ?? entry.weightKg),
    materialGrade,
    materialType,
    norm,
    name: String(entry.name ?? description).trim(),
    material,
    steelTypeRaw: normalizeNullableText(
      entry.steelTypeRaw ?? entry.steel_type ?? entry.steelType ?? entry.materialGrade ?? entry.material_grade
    ),
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: quantity ? Math.max(1, Math.round(quantity)) : 1,
    thickness: thicknessMm,
    notes: String(entry.notes ?? norm ?? ''),
    sourcePage,
    parentAssembly,
    sourcePageGroup: parentAssembly || (sourcePage ? `page:${sourcePage}` : undefined),
    source: 'ai',
  };
}

function parseBOMGeometry(description: string): {
  partType: BOMPartType;
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
} {
  const normalized = description
    .trim()
    .replace(/[×х]/gi, 'x')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/,/g, '.');
  const partType = normalizePartType(null, normalized) ?? 'other';
  const numbers = Array.from(normalized.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
  const pnThickness = normalizePositiveNumber(normalized.match(/\bпн\s*-\s*(\d+(?:[,.]\d+)?)/i)?.[1]);

  if (partType === 'sheet') {
    return {
      partType,
      thicknessMm: numbers[0] ?? pnThickness,
      widthMm: numbers[1] ?? null,
      heightMm: numbers[2] ?? null,
    };
  }

  if (partType === 'channel' || partType === 'tube' || partType === 'flat_bar') {
    return {
      partType,
      thicknessMm: null,
      widthMm: numbers[0] ?? null,
      heightMm: numbers.length > 1 ? numbers[numbers.length - 1] : null,
    };
  }

  if (partType === 'round_bar') {
    return {
      partType,
      thicknessMm: null,
      widthMm: numbers[0] ?? null,
      heightMm: numbers[1] ?? null,
    };
  }

  if (partType === 'angle') {
    return {
      partType,
      thicknessMm: numbers.length >= 4 ? numbers[numbers.length - 2] : numbers[2] ?? null,
      widthMm: numbers[0] ?? null,
      heightMm: numbers.length > 1 ? numbers[numbers.length - 1] : null,
    };
  }

  return {
    partType,
    thicknessMm: pnThickness,
    widthMm: null,
    heightMm: null,
  };
}

function normalizePartType(value: unknown, source = ''): BOMPartType | null {
  const explicit = String(value ?? '').trim().toLowerCase();
  if (isBOMPartType(explicit)) return explicit;

  const text = `${explicit} ${source}`.trim().toLowerCase();
  if (!text) return null;

  if (/\b(bl|blech|sheet)\b/.test(text) || /лист|бт?\s*-\s*пн/i.test(text)) return 'sheet';
  if (/\b(unp|u)\b/.test(text) || /швеллер/i.test(text)) return 'channel';
  if (/\b(l|winkel)\b/.test(text) || /уголок/i.test(text)) return 'angle';
  if (/\b(ru|rundstahl|round)\b/.test(text) || /круг/i.test(text)) return 'round_bar';
  if (/\b(ro|rohr|tube)\b/.test(text) || /труба/i.test(text)) return 'tube';
  if (/\b(fl|flachstahl)\b/.test(text) || /полоса/i.test(text)) return 'flat_bar';

  return 'other';
}

function isBOMPartType(value: string): value is BOMPartType {
  return ['sheet', 'channel', 'angle', 'round_bar', 'tube', 'flat_bar', 'other'].includes(value);
}

function normalizeDetailEntry(entry: unknown): DetailEntry | null {
  if (!isRecord(entry)) return null;

  const materialFull = String(entry.material_full ?? entry.materialFull ?? '').trim();
  const materialType = normalizeMaterialType(String(entry.material_type ?? entry.materialType ?? materialFull));
  const bendInfo = String(entry.bend_info ?? entry.bendInfo ?? '').trim();
  const baseNotes = [entry.notes, bendInfo].map((value) => String(value ?? '').trim()).filter(Boolean).join('; ');
  const textForUnfolding = [
    entry.notes,
    entry.description,
    entry.name,
    materialFull,
    bendInfo,
  ].map((value) => String(value ?? '').trim()).filter(Boolean).join('\n');
  const unfolding = resolveUnfolding({
    text: textForUnfolding,
    providedWidth: normalizePositiveNumber(entry.unfolding_width ?? entry.unfoldingWidth),
    providedHeight: normalizePositiveNumber(entry.unfolding_height ?? entry.unfoldingHeight),
  });

  return {
    designation: String(entry.designation || '').trim(),
    name: String(entry.name ?? entry.description ?? '').trim(),
    materialFull,
    materialType,
    materialGrade: String(entry.material_grade ?? entry.materialGrade ?? '').trim(),
    thicknessMm: normalizePositiveNumber(entry.thickness_mm ?? entry.thicknessMm) ?? 0,
    unfoldingWidth: unfolding.width,
    unfoldingHeight: unfolding.height,
    massKg: normalizePositiveNumber(entry.mass_kg ?? entry.massKg),
    isSheetMetal: normalizeBoolean(entry.is_sheet_metal ?? entry.isSheetMetal),
    notes: mergeUnfoldingWarning(baseNotes, unfolding.warnings),
    sourcePage: normalizeSourcePage(entry.source_page ?? entry.sourcePage),
    source: 'ai',
  };
}

function failedPDFAnalysis(input: {
  rawResponse?: string;
  model: string;
  maxTokens: number;
  failureKind: PDFAnalysisFailureKind;
  finishReason?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  tokensUsed?: number;
  error: string;
}): PDFAnalysisResult {
  return {
    success: false,
    bom: [],
    details: [],
    rawResponse: input.rawResponse ?? '',
    model: input.model,
    tokensUsed: input.tokensUsed ?? 0,
    promptTokens: input.promptTokens ?? 0,
    completionTokens: input.completionTokens ?? 0,
    finishReason: input.finishReason ?? null,
    maxTokens: input.maxTokens,
    failureKind: input.failureKind,
    error: input.error,
  };
}

function normalizeFinishReason(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function positiveInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function normalizeSourcePage(value: unknown): number | null {
  const page = positiveInteger(value);
  return page > 0 ? page : null;
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
  if (lower.includes('нерж') || lower.includes('12х18') || lower.includes('08х18') || lower.includes('aisi') || /\b(304|316)\b/.test(lower)) return 'Нержавейка';
  if (lower.includes('алюм') || lower.includes('амг') || lower.includes('ад31')) return 'Алюминий';
  if (lower.includes('стал') || lower.includes('ст3') || lower.includes('09г2с') || /\bs(?:235|355)\b/.test(lower)) return 'Сталь';
  return 'Сталь';
}

function buildKnownSteelTypesText(steelTypes: SteelTypeCatalogItem[]): string {
  if (steelTypes.length === 0) return '';
  const names = steelTypes.map((steelType) => steelType.name).filter(Boolean).join(', ');
  return names ? `\n\nCRM steel_types: ${names}. Если марка стали есть в этом списке, запиши её в material_grade.` : '';
}
