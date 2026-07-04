import * as fs from 'node:fs/promises';
import pdfParse from 'pdf-parse';
import type { BOMEntry, BOMPartType } from './types';

type ParsedBOMLine = {
  position?: string;
  articleNumber: string;
  description: string;
  designation: string;
  quantity: number;
  massKg: number | null;
  materialGrade: string;
  materialType: string;
  norm: string;
  partType: BOMPartType;
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
};

export async function extractDeterministicBOMFromPdf(pdfFilePath: string): Promise<BOMEntry[]> {
  const buffer = await fs.readFile(pdfFilePath);
  const parsed = await pdfParse(buffer);
  return parseDeterministicBOMText(parsed.text || '');
}

export function parseDeterministicBOMText(text: string): BOMEntry[] {
  const entries = new Map<string, BOMEntry>();
  const candidates = buildCandidateSegments(text);

  for (const rawLine of candidates) {
    const line = normalizeLine(rawLine);
    const parsed = parseRussianAssemblyLine(line) ?? parseMaterialLine(line);
    if (!parsed) continue;

    const entry = createBOMEntry(parsed);
    const key = buildBOMKey(entry);
    const existing = entries.get(key);
    if (existing && normalizeDescription(existing.description) !== normalizeDescription(entry.description)) {
      continue;
    }
    entries.set(key, existing ? mergeBOMEntry(existing, entry) : entry);
  }

  return Array.from(entries.values());
}

export function mergeDeterministicBOM(aiBom: BOMEntry[], deterministicBom: BOMEntry[]): BOMEntry[] {
  if (deterministicBom.length === 0) return aiBom;

  const entries = new Map<string, BOMEntry>();
  const order: string[] = [];

  for (const entry of aiBom) {
    const key = buildBOMKey(entry);
    entries.set(key, entry);
    order.push(key);
  }

  for (const entry of deterministicBom) {
    const key = buildBOMKey(entry);
    if (!entries.has(key)) order.push(key);
    entries.set(key, entries.has(key) ? mergeBOMEntry(entries.get(key)!, entry) : entry);
  }

  return order.map((key) => entries.get(key)!).filter(Boolean);
}

function parseMaterialLine(line: string): ParsedBOMLine | null {
  const articleMatches = Array.from(line.matchAll(/7\d{10,}/g));
  if (articleMatches.length > 1) return null;
  const articleMatch = articleMatches[articleMatches.length - 1];
  if (!articleMatch) return null;

  const articleNumber = articleMatch[0];
  const articleAtStart = line.trim().startsWith(articleNumber);
  const remainder = line.replace(articleNumber, ' ').trim();
  const descriptionMatches = Array.from(remainder.matchAll(descriptionPattern()));
  const descriptionMatch = descriptionMatches[descriptionMatches.length - 1];
  if (!descriptionMatch) return null;

  const description = normalizeDescription(descriptionMatch[0]);
  const afterDescription = remainder.slice(descriptionMatch.index! + descriptionMatch[0].length).trim();
  const beforeDescription = remainder.slice(0, descriptionMatch.index).trim();
  const context = `${beforeDescription} ${afterDescription}`;
  if (!/(?:FL|FZ)/i.test(context)) return null;

  const geometry = parseDescriptionGeometry(description);
  const quantity = parseQuantity(beforeDescription, afterDescription, articleAtStart);
  const designation = extractDesignation(context);
  const materialGrade = lastMatch(context, /S(?:235|355)(?:JRG2|JR|J2|J0)?/gi)?.toUpperCase() ?? '';
  const norm = extractNorm(context);
  const massSource = articleAtStart ? afterDescription : beforeDescription;
  const masses = Array.from(massSource.matchAll(/(\d+(?:[,.]\d+)?)\s*kg/gi))
    .map((match) => normalizePositiveNumber(match[1]))
    .filter((value): value is number => typeof value === 'number');

  return {
    position: '',
    articleNumber,
    description,
    designation,
    quantity,
    massKg: articleAtStart ? masses[0] ?? null : masses[masses.length - 1] ?? null,
    materialGrade,
    materialType: materialGrade ? 'Сталь' : '',
    norm,
    partType: geometry.partType,
    thicknessMm: geometry.thicknessMm,
    widthMm: geometry.widthMm,
    heightMm: geometry.heightMm,
  };
}

function parseRussianAssemblyLine(line: string): ParsedBOMLine | null {
  const thicknessMatch = line.match(/\s[sS]\s*(\d+(?:[,.]\d+)?)\s*$/);
  if (!thicknessMatch) return null;

  const thicknessMm = normalizePositiveNumber(thicknessMatch[1]);
  if (!thicknessMm) return null;

  const withoutThickness = line.slice(0, thicknessMatch.index).trim();
  const headerMatch = withoutThickness.match(/^(\d{1,3})\s*([A-ZА-ЯЁ]+-\d+(?:\.\d+)*)\s*(.+)$/u);
  if (!headerMatch) return null;

  const position = headerMatch[1];
  const designation = headerMatch[2];
  const tail = headerMatch[3].trim();
  const materialMatch = tail.match(standardSteelPattern());
  if (!materialMatch || materialMatch.index === undefined) return null;

  const materialGrade = materialMatch[0].replace(/\s+/g, ' ').trim();
  const beforeMaterial = tail.slice(0, materialMatch.index).trim();
  const quantityMatch = beforeMaterial.match(/(\d{1,3})\s*$/);
  if (!quantityMatch || quantityMatch.index === undefined) return null;

  const quantity = Math.max(1, Math.round(Number(quantityMatch[1])));
  const name = beforeMaterial.slice(0, quantityMatch.index).trim();
  if (!name) return null;

  return {
    position,
    articleNumber: '',
    description: name,
    designation,
    quantity,
    massKg: null,
    materialGrade,
    materialType: 'Сталь',
    norm: '',
    partType: 'sheet',
    thicknessMm,
    widthMm: null,
    heightMm: null,
  };
}

function standardSteelPattern(): RegExp {
  return /(?:Ст3сп|Ст3пс|09Г2С|12Х18Н10Т|AISI\s*304|AISI\s*430|40Х|65Г|10|20|45)\s*$/iu;
}

function buildCandidateSegments(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const candidates = [...lines];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/7\d{10,}/.test(lines[index])) continue;

    for (let lookback = 1; lookback <= 4; lookback += 1) {
      const start = Math.max(0, index - lookback);
      candidates.push(lines.slice(start, index + 1).join(' '));
    }
  }

  return candidates;
}

function descriptionPattern(): RegExp {
  const number = String.raw`\d{1,5}(?:[,.]\d+)?`;
  return new RegExp(String.raw`(?:BL\s+${number}\s*x\s*${number}\s*x\s*${number}|U\s+${number}(?:\s*x\s*${number})?\s*-\s*${number}|RU\s+${number}\s*-\s*${number})\b`, 'gi');
}

function parseQuantity(beforeDescription: string, afterDescription: string, articleAtStart: boolean): number {
  const source = articleAtStart ? afterDescription : beforeDescription;
  const normal = lastCapture(source, /\b(?:FL|FZ)\s+(\d{1,3})\b/gi);
  const reversed = lastCapture(source, /(\d)\s*(?:FL|FZ)/gi);
  const quantity = normalizePositiveNumber(normal ?? reversed);
  return quantity ? Math.max(1, Math.round(quantity)) : 1;
}

function lastCapture(value: string, pattern: RegExp): string | null {
  const matches = Array.from(value.matchAll(pattern));
  return matches[matches.length - 1]?.[1] ?? null;
}

function lastMatch(value: string, pattern: RegExp): string | null {
  const matches = Array.from(value.matchAll(pattern));
  return matches[matches.length - 1]?.[0] ?? null;
}

function extractDesignation(value: string): string {
  return (
    lastCapture(value, /(?:^|\s|\d)(?:FL|FZ)\s*([\w.-]+\.geo)(?=BL|\s|$)/gi)
    ?? lastCapture(value, /(?:^|\s)([\w.-]+\.geo)(?=BL|\s|$)/gi)
    ?? ''
  );
}

function createBOMEntry(input: ParsedBOMLine): BOMEntry {
  return {
    articleNumber: input.articleNumber,
    position: input.position ?? '',
    designation: input.designation,
    description: input.description,
    partType: input.partType,
    thicknessMm: input.thicknessMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    massKg: input.massKg,
    materialGrade: input.materialGrade,
    materialType: input.materialType || 'Сталь',
    norm: input.norm,
    name: input.description,
    material: input.materialType || 'Сталь',
    steelTypeRaw: input.materialGrade || null,
    steelTypeId: null,
    steelTypeName: null,
    steelTypeWarning: null,
    quantity: input.quantity,
    thickness: input.thicknessMm,
    notes: input.norm,
  };
}

function mergeBOMEntry(base: BOMEntry, override: BOMEntry): BOMEntry {
  return {
    ...base,
    position: override.position || base.position,
    articleNumber: override.articleNumber || base.articleNumber,
    designation: override.designation || base.designation,
    description: override.description || base.description,
    partType: override.partType !== 'other' ? override.partType : base.partType,
    thicknessMm: override.thicknessMm ?? base.thicknessMm,
    widthMm: override.widthMm ?? base.widthMm,
    heightMm: override.heightMm ?? base.heightMm,
    massKg: override.massKg ?? base.massKg,
    materialGrade: override.materialGrade || base.materialGrade,
    materialType: override.materialType || base.materialType,
    norm: override.norm || base.norm,
    name: override.name || base.name,
    material: override.material || base.material,
    steelTypeRaw: override.steelTypeRaw ?? base.steelTypeRaw,
    quantity: override.quantity || base.quantity,
    thickness: override.thickness ?? base.thickness,
    notes: mergeNotes(base.notes, override.notes),
  };
}

function mergeNotes(...values: Array<string | null | undefined>): string {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (value ?? '').split(';'))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).join('; ');
}

function parseDescriptionGeometry(description: string): {
  partType: BOMPartType;
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
} {
  const numbers = Array.from(description.matchAll(/\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
  const lower = description.toLowerCase();

  if (lower.startsWith('bl')) {
    return { partType: 'sheet', thicknessMm: numbers[0] ?? null, widthMm: numbers[1] ?? null, heightMm: numbers[2] ?? null };
  }

  if (lower.startsWith('ru')) {
    return { partType: 'round_bar', thicknessMm: null, widthMm: numbers[0] ?? null, heightMm: numbers[1] ?? null };
  }

  if (lower.startsWith('u')) {
    return { partType: 'channel', thicknessMm: null, widthMm: numbers[0] ?? null, heightMm: numbers[numbers.length - 1] ?? null };
  }

  return { partType: 'other', thicknessMm: null, widthMm: null, heightMm: null };
}

function buildBOMKey(entry: Pick<BOMEntry, 'articleNumber' | 'description' | 'partType' | 'quantity'>): string {
  const article = entry.articleNumber.trim().toLowerCase();
  if (article) return `article:${article}`;
  return [
    'desc',
    entry.partType,
    normalizeDescription(entry.description),
    entry.quantity,
  ].join(':');
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeDescription(value: string): string {
  const normalized = normalizeLine(value)
    .replace(/[×х]/gi, 'x')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/,/g, '.')
    .replace(/\s*x\s*/gi, ' x ')
    .replace(/\s*-\s*/g, ' - ');

  return normalized.replace(/^(bl|ru|u)\b/i, (prefix) => prefix.toUpperCase());
}

function normalizeNorm(value: string): string {
  return normalizeLine(value).replace(/\s+/g, ' ').toUpperCase();
}

function extractNorm(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  if (compact.includes('DINEN10130')) return 'DIN EN 10130';
  if (compact.includes('DIN1026')) return 'DIN1026';
  if (compact.includes('EN10060')) return 'EN 10060';
  return normalizeNorm(lastMatch(value, /\b(?:DIN\s+EN\s+\d{4,5}|DIN\s*\d{4,5}|EN\s+\d{4,5})/gi) ?? '');
}

function normalizePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : null;
}
