import * as fs from 'node:fs/promises';
import { getOpenRouterConfig } from './settings';
import type { BOMEntry, PDFAnalysisResult, SteelTypeCatalogItem } from './types';

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

export async function analyzePDF(
  pdfFilePath: string,
  options: { steelTypes?: SteelTypeCatalogItem[] } = {}
): Promise<PDFAnalysisResult> {
  const cfg = await getOpenRouterConfig();
  const pdfBuffer = await fs.readFile(pdfFilePath);
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  const knownSteelTypes = buildKnownSteelTypesText(options.steelTypes ?? []);

  const requestBody = {
    model: cfg.model,
    messages: [
      {
        role: 'system',
        content:
          'Ты опытный технолог производства листового металла. Извлеки из PDF-чертежа спецификацию BOM. ' +
          'Если спецификация таблицей, извлеки все строки. Если материал указан общий для изделия, применяй его ко всем деталям. ' +
          'Если материал не указан, используй строку "Не указан". Отвечай строго по JSON Schema. ' +
          'Если в PDF есть марка/тип стали, запиши её в steelTypeRaw как отдельное значение; если нет, верни null.' +
          knownSteelTypes,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Извлеки спецификацию из чертежа. Для каждой позиции нужны position, name, material, steelTypeRaw, quantity, thickness, notes.',
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
        name: 'bom_extraction',
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
                  name: { type: 'string' },
                  material: { type: 'string' },
                  steelTypeRaw: { type: ['string', 'null'] },
                  quantity: { type: 'integer' },
                  thickness: { type: ['number', 'null'] },
                  notes: { type: 'string' },
                },
                required: ['position', 'name', 'material', 'steelTypeRaw', 'quantity', 'thickness', 'notes'],
              },
            },
          },
          required: ['bom'],
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

    try {
      bom = parseBOM(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[openrouter] JSON parse error:', message);
      return {
        success: false,
        bom: [],
        rawResponse: content,
        model: cfg.model,
        tokensUsed,
        error: `Не удалось разобрать ответ AI: ${message}`,
      };
    }

    console.log(`[openrouter] PDF analyzed: ${bom.length} BOM entries, ${tokensUsed} tokens`);

    return {
      success: true,
      bom,
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
      rawResponse: '',
      model: cfg.model,
      tokensUsed: 0,
      error: `Ошибка подключения к OpenRouter: ${message}`,
    };
  }
}

export async function testOpenRouterConnection(): Promise<{ ok: boolean; model: string; error: string | null }> {
  const cfg = await getOpenRouterConfig();

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

export function parseBOM(content: string): BOMEntry[] {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const parsed = JSON.parse(jsonStr) as unknown;
  let entries: unknown[] = [];

  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (isRecord(parsed)) {
    if (Array.isArray(parsed.bom)) entries = parsed.bom;
    else if (Array.isArray(parsed.entries)) entries = parsed.entries;
    else if (Array.isArray(parsed.data)) entries = parsed.data;
  }

  return entries
    .map((entry) => normalizeBOMEntry(entry))
    .filter((entry): entry is BOMEntry => Boolean(entry && entry.name.length > 0));
}

function normalizeBOMEntry(entry: unknown): BOMEntry | null {
  if (!isRecord(entry)) return null;

  const quantity = Number(entry.quantity);
  const rawThickness = entry.thickness === null || entry.thickness === undefined || entry.thickness === ''
    ? null
    : Number(entry.thickness);

  return {
    position: String(entry.position || ''),
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

function buildKnownSteelTypesText(steelTypes: SteelTypeCatalogItem[]): string {
  if (steelTypes.length === 0) return '';
  const names = steelTypes.map((steelType) => steelType.name).filter(Boolean).join(', ');
  return names ? ` CRM steel_types: ${names}.` : '';
}
