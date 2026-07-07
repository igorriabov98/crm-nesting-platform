import * as fs from 'node:fs/promises';
import pdfParse from 'pdf-parse';
import type { BOMEntry, BOMPartType, DetailEntry } from './types';
import { mergeUnfoldingWarning, resolveUnfolding } from './unfolding-extraction';
import { normalizeCadText } from '../text-encoding';

type ParsedBOMLine = {
  position?: string;
  articleNumber: string;
  bomSection: string;
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
  sourcePage?: number;
};

export async function extractDeterministicBOMFromPdf(pdfFilePath: string): Promise<BOMEntry[]> {
  const buffer = await fs.readFile(pdfFilePath);
  const pages = await parsePdfPages(buffer);
  return parseDeterministicBOMPages(pages);
}

export async function extractDeterministicPdfDataFromPdf(pdfFilePath: string): Promise<{ bom: BOMEntry[]; details: DetailEntry[] }> {
  const buffer = await fs.readFile(pdfFilePath);
  const pages = await parsePdfPages(buffer);
  const text = pages.join('\n');
  return {
    bom: parseDeterministicBOMPages(pages),
    details: parseDeterministicDetailText(text),
  };
}

export function parseDeterministicBOMText(text: string, sourcePage?: number): BOMEntry[] {
  const entries = new Map<string, BOMEntry>();
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  let currentSection = '';

  for (const line of lines) {
    const section = detectBomSection(line);
    if (section) {
      currentSection = section;
      continue;
    }

    const parsed =
      parseRussianAssemblyLine(line, currentSection) ??
      parseRussianSpecTableLine(line, currentSection) ??
      parseMaterialLine(line, currentSection);
    if (!parsed) continue;

    addEntry(entries, createBOMEntry({ ...parsed, sourcePage }));
  }

  const candidates = buildCandidateSegments(text);

  for (const rawLine of candidates) {
    const line = normalizeLine(rawLine);
    const parsed = parseRussianAssemblyLine(line, '') ?? parseMaterialLine(line, '');
    if (!parsed) continue;

    addEntry(entries, createBOMEntry({ ...parsed, sourcePage }));
  }

  return Array.from(entries.values());
}

function parseDeterministicBOMPages(pages: string[]): BOMEntry[] {
  const merged = new Map<string, BOMEntry>();
  const order: string[] = [];

  pages.forEach((pageText, index) => {
    for (const entry of parseDeterministicBOMText(pageText, index + 1)) {
      const key = buildBOMKey(entry);
      if (!merged.has(key)) order.push(key);
      merged.set(key, merged.has(key) ? mergeBOMEntry(merged.get(key)!, entry) : entry);
    }
  });

  return order.map((key) => merged.get(key)!).filter(Boolean);
}

async function parsePdfPages(buffer: Buffer): Promise<string[]> {
  const pages: string[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const text = await renderPdfPageText(pageData);
      pages.push(text);
      return text;
    },
  });
  return pages;
}

async function renderPdfPageText(pageData: any): Promise<string> {
  const content = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | null = null;
  let text = '';

  for (const item of content.items ?? []) {
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      text += '\n';
    } else if (text && !text.endsWith('\n')) {
      text += '';
    }
    text += item.str;
    lastY = y;
  }

  return text;
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

export function parseDeterministicDetailText(text: string): DetailEntry[] {
  const details = new Map<string, DetailEntry>();
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  let currentDesignation = '';
  let currentName = '';
  let currentMaterialFull = '';
  let inExecutionTable = false;

  for (const line of lines) {
    const designation = extractDetailDesignation(line) || extractCompactDetailDesignation(line);
    if (designation) {
      currentDesignation = designation;
      currentName = extractDetailName(line, designation) || currentName;
    }

    if (isSheetMaterialLine(line)) {
      currentMaterialFull = line;
      upsertCurrentMaterialDetail(details, currentDesignation, currentName, currentMaterialFull, line);
    } else if (extractMaterialGrade(line)) {
      currentMaterialFull = [currentMaterialFull, line].filter(Boolean).join(' ');
      upsertCurrentMaterialDetail(details, currentDesignation, currentName, currentMaterialFull, line);
    }

    if (/(?:исполн|обозначение)/i.test(line) && /разв[её]рт/i.test(line)) {
      inExecutionTable = true;
    }

    if (inExecutionTable) {
      const row = parseExecutionUnfoldingRow(line, currentDesignation, currentName, currentMaterialFull);
      if (row) {
        details.set(normalizeDetailKey(row.designation), mergeDetailEntry(details.get(normalizeDetailKey(row.designation)), row));
        continue;
      } else if (/^\S+\s+\S+/.test(line) && !/[xх×]\s*\d/u.test(line) && !/(?:исполн|обозначение)/i.test(line)) {
        inExecutionTable = false;
      }
    }

    const explicit = resolveUnfolding({ text: line });
    if (explicit.width && explicit.height) {
      const detail = createDetailEntry({
        designation: currentDesignation || `unfolding-${details.size + 1}`,
        name: currentName,
        materialFull: currentMaterialFull,
        notes: line,
        unfoldingWidth: explicit.width,
        unfoldingHeight: explicit.height,
        warnings: explicit.warnings,
      });
      details.set(normalizeDetailKey(detail.designation), mergeDetailEntry(details.get(normalizeDetailKey(detail.designation)), detail));
      continue;
    }
  }

  return Array.from(details.values());
}

export function mergeDeterministicDetails(aiDetails: DetailEntry[], deterministicDetails: DetailEntry[]): DetailEntry[] {
  if (deterministicDetails.length === 0) return aiDetails;

  const details = new Map<string, DetailEntry>();
  const order: string[] = [];

  for (const detail of aiDetails) {
    const key = normalizeDetailKey(detail.designation);
    if (!details.has(key)) order.push(key);
    details.set(key, detail);
  }

  for (const detail of deterministicDetails) {
    const key = normalizeDetailKey(detail.designation);
    if (!details.has(key)) order.push(key);
    details.set(key, mergeDetailEntry(details.get(key), detail));
  }

  return order.map((key) => details.get(key)!).filter(Boolean);
}

function parseMaterialLine(line: string, bomSection: string): ParsedBOMLine | null {
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
    bomSection,
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

function parseRussianAssemblyLine(line: string, bomSection: string): ParsedBOMLine | null {
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
    bomSection,
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

function parseRussianSpecTableLine(line: string, bomSection: string): ParsedBOMLine | null {
  if (!bomSection || !isSpecItemSection(bomSection)) return null;

  const normalized = line
    .replace(/\s+/g, ' ')
    .replace(/(Заглушка)(пластмассовая)/giu, '$1 $2')
    .trim();
  const designationMatch = normalized.match(/^(?:[A-ZА-Я]\d)?(\d{1,3})([A-ZА-ЯЁ]+[A-ZА-ЯЁ]*\.\d+\.\d+\.\d+(?:-\d{1,3})?)(.+?)(\d{1,3})$/u);

  if (designationMatch) {
    const position = designationMatch[1];
    const designation = designationMatch[2];
    const name = repairSpecName(designationMatch[3]);
    const quantity = normalizePositiveNumber(designationMatch[4]);
    if (!name || !quantity) return null;

    return {
      position,
      articleNumber: '',
      bomSection,
      description: name,
      designation,
      quantity: Math.max(1, Math.round(quantity)),
      massKg: null,
      materialGrade: '',
      materialType: '',
      norm: '',
      partType: 'other',
      thicknessMm: null,
      widthMm: null,
      heightMm: null,
    };
  }

  const simpleMatch = normalized.match(/^(\d{1,3})(.+?)(\d{1,3})$/u);
  if (!simpleMatch) return null;

  const position = simpleMatch[1];
  const name = repairSpecName(simpleMatch[2]);
  const quantity = normalizePositiveNumber(simpleMatch[3]);
  if (!name || !quantity || name.length < 3 || !/[A-Za-zА-Яа-яЁё]/u.test(name)) return null;

  return {
    position,
    articleNumber: '',
    bomSection,
    description: name,
    designation: '',
    quantity: Math.max(1, Math.round(quantity)),
    massKg: null,
    materialGrade: '',
    materialType: '',
    norm: '',
    partType: 'other',
    thicknessMm: null,
    widthMm: null,
    heightMm: null,
  };
}

function detectBomSection(line: string): string | null {
  const normalized = line.toLowerCase();
  if (/прочие изделия/.test(normalized)) return 'Прочие изделия';
  if (/стандартные изделия/.test(normalized)) return 'Стандартные изделия';
  if (/\b(?:zukaufteile|kaufteile)\b/i.test(line)) return line.trim();
  if (/^\s*детали\s*$/iu.test(line)) return 'Детали';
  if (/^\s*документация\s*$/iu.test(line)) return 'Документация';
  return null;
}

function isSpecItemSection(section: string): boolean {
  return /^(?:Детали|Прочие изделия|Стандартные изделия)$/iu.test(section) || /\b(?:zukaufteile|kaufteile)\b/i.test(section);
}

function repairSpecName(value: string): string {
  return normalizeLine(value)
    .replace(/(Заглушка)(пластмассовая)/giu, '$1 $2')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .trim();
}

function addEntry(entries: Map<string, BOMEntry>, entry: BOMEntry): void {
  const key = buildBOMKey(entry);
  const existing = entries.get(key);
  if (existing && normalizeDescription(existing.description) !== normalizeDescription(entry.description)) {
    return;
  }
  entries.set(key, existing ? mergeBOMEntry(existing, entry) : entry);
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
  return new RegExp(String.raw`(?:BL\s+${number}\s*x\s*${number}\s*x\s*${number}|U\s+${number}(?:\s*x\s*${number})?\s*-\s*${number}|RU\s+${number}\s*-\s*${number}|RO\s+${number}(?:\s*x\s*${number})?\s*-\s*${number})\b`, 'gi');
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
  const bomSources = input.sourcePage ? [input.sourcePage] : undefined;

  return {
    articleNumber: input.articleNumber,
    position: input.position ?? '',
    bomSection: input.bomSection,
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
    bomSources,
  };
}

function createDetailEntry(input: {
  designation: string;
  name: string;
  materialFull: string;
  notes: string;
  unfoldingWidth?: number | null;
  unfoldingHeight?: number | null;
  warnings?: string[];
}): DetailEntry {
  const materialGrade = extractMaterialGrade(input.materialFull);
  const thicknessMm = extractSheetThickness(input.materialFull) ?? 0;

  return {
    designation: input.designation,
    name: input.name || input.designation,
    materialFull: input.materialFull,
    materialType: input.materialFull ? 'Сталь' : '',
    materialGrade,
    thicknessMm,
    unfoldingWidth: input.unfoldingWidth ?? null,
    unfoldingHeight: input.unfoldingHeight ?? null,
    massKg: null,
    isSheetMetal: true,
    notes: mergeUnfoldingWarning(input.notes, input.warnings ?? []),
  };
}

function mergeBOMEntry(base: BOMEntry, override: BOMEntry): BOMEntry {
  const baseIsSpec = isSpecItemSection(base.bomSection);
  const overrideIsSpec = isSpecItemSection(override.bomSection);
  const sourcePages = mergeSourcePages(base.bomSources, override.bomSources);

  return {
    ...base,
    position: override.position || base.position,
    articleNumber: override.articleNumber || base.articleNumber,
    bomSection: override.bomSection || base.bomSection,
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
    quantity: baseIsSpec && !overrideIsSpec ? base.quantity : override.quantity || base.quantity,
    thickness: override.thickness ?? base.thickness,
    notes: mergeNotes(base.notes, override.notes),
    bomSources: sourcePages.length > 0 ? sourcePages : undefined,
  };
}

function mergeDetailEntry(base: DetailEntry | undefined, override: DetailEntry): DetailEntry {
  if (!base) return override;

  return {
    ...base,
    name: override.name || base.name,
    materialFull: override.materialFull || base.materialFull,
    materialType: override.materialType || base.materialType,
    materialGrade: override.materialGrade || base.materialGrade,
    thicknessMm: override.thicknessMm || base.thicknessMm,
    unfoldingWidth: base.unfoldingWidth ?? override.unfoldingWidth,
    unfoldingHeight: base.unfoldingHeight ?? override.unfoldingHeight,
    massKg: override.massKg ?? base.massKg,
    isSheetMetal: override.isSheetMetal || base.isSheetMetal,
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

function mergeSourcePages(...values: Array<number[] | undefined>): number[] {
  return Array.from(
    new Set(
      values
        .flatMap((pages) => pages ?? [])
        .filter((page) => Number.isInteger(page) && page > 0)
    )
  ).sort((left, right) => left - right);
}

function upsertCurrentMaterialDetail(
  details: Map<string, DetailEntry>,
  currentDesignation: string,
  currentName: string,
  currentMaterialFull: string,
  notes: string
): void {
  if (!currentDesignation || !currentMaterialFull) return;

  const detail = createDetailEntry({
    designation: currentDesignation,
    name: currentName,
    materialFull: currentMaterialFull,
    notes,
  });
  const key = normalizeDetailKey(detail.designation);
  details.set(key, mergeDetailEntry(details.get(key), detail));
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

  if (lower.startsWith('ro')) {
    return { partType: 'tube', thicknessMm: null, widthMm: numbers[0] ?? null, heightMm: numbers[numbers.length - 1] ?? null };
  }

  return { partType: 'other', thicknessMm: null, widthMm: null, heightMm: null };
}

function buildBOMKey(entry: Pick<BOMEntry, 'articleNumber' | 'designation' | 'description' | 'name' | 'partType' | 'thicknessMm' | 'widthMm' | 'heightMm'>): string {
  const article = entry.articleNumber.trim().toLowerCase();
  if (article) return `article:${article}`;
  const designation = entry.designation.trim().toLowerCase();
  if (designation) return `designation:${designation}`;
  return [
    'desc',
    entry.partType,
    normalizeDescription(entry.description || entry.name),
    formatKeyNumber(entry.thicknessMm),
    formatKeyNumber(entry.widthMm),
    formatKeyNumber(entry.heightMm),
  ].join(':');
}

function normalizeLine(value: string): string {
  return normalizeCadText(value).replace(/õ/g, 'х').replace(/\s+/g, ' ').trim();
}

function formatKeyNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, '') : '';
}

function extractDetailDesignation(line: string): string {
  const match = line.match(/(?:^|\s)((?=[A-ZА-ЯЁ0-9.-]*\d)[A-ZА-ЯЁ]{2,}[-.0-9A-ZА-ЯЁ]+(?:-\d{1,3})?)(?=\s|$)/u);
  const value = match?.[1] ?? '';
  return /^(?:ГОСТ|БТ?-ПН)/iu.test(value) ? '' : value;
}

function extractCompactDetailDesignation(line: string): string {
  const match = line.match(/((?=[A-ZА-ЯЁ0-9.-]*\d)[A-ZА-ЯЁ]{2,}[-.0-9A-ZА-ЯЁ]*\.\d{2}\.\d{3})(?=\d{3,6}[,.])/u);
  const value = match?.[1] ?? '';
  return /^(?:ГОСТ|БТ?-ПН)/iu.test(value) ? '' : value;
}

function extractDetailName(line: string, designation: string): string {
  return line.replace(designation, '').replace(/\s+/g, ' ').trim();
}

function parseExecutionUnfoldingRow(
  line: string,
  currentDesignation: string,
  currentName: string,
  currentMaterialFull: string
): DetailEntry | null {
  if (/гост/i.test(line)) return null;

  const compact = parseCompactExecutionUnfoldingRow(line, currentDesignation);
  const match = compact ? null : line.match(/(?:^|\s)([-\w.а-яёА-ЯЁ]+)?\s+(\d{1,5}(?:[,.]\d+)?)\s*[xх×]\s*(\d{1,5}(?:[,.]\d+)?)(?:\s|$)/u);
  if (!compact && !match) return null;

  const width = compact?.width ?? normalizePositiveNumber(match?.[2]);
  const height = compact?.height ?? normalizePositiveNumber(match?.[3]);
  if (!width || !height) return null;

  const suffix = compact?.suffix ?? match?.[1] ?? '';
  const designation = compact?.designation ?? buildExecutionDesignation(currentDesignation, suffix);
  const resolved = resolveUnfolding({
    providedWidth: width,
    providedHeight: height,
    text: line,
  });
  if (!resolved.width || !resolved.height) return null;

  return createDetailEntry({
    designation,
    name: currentName,
    materialFull: currentMaterialFull,
    notes: line,
    unfoldingWidth: resolved.width,
    unfoldingHeight: resolved.height,
    warnings: resolved.warnings,
  });
}

function parseCompactExecutionUnfoldingRow(
  line: string,
  currentDesignation: string
): { designation: string; suffix: string; width: number; height: number } | null {
  const normalized = line.replace(/õ/g, 'х');
  const height = normalizePositiveNumber(normalized.match(/[xх×]\s*(\d{1,5}(?:[,.]\d+)?)/u)?.[1]);
  if (!height) return null;

  const suffixMatch = normalized.match(/(?:^|\s)(-\d{1,3})(?=\s|\d)/u);
  if (suffixMatch) {
    const afterSuffix = normalized.slice((suffixMatch.index ?? 0) + suffixMatch[0].length);
    const firstDigitsMatch = afterSuffix.match(/\d{3,6}/);
    const firstDigits = firstDigitsMatch?.[0] ?? '';
    if (firstDigits.length < 4) return null;
    const afterDigits = firstDigitsMatch?.index !== undefined
      ? afterSuffix.slice(firstDigitsMatch.index + firstDigits.length)
      : '';
    const widthSource = /^[xх×]/u.test(afterDigits.trimStart()) ? firstDigits : firstDigits.slice(0, -1);
    const width = normalizePositiveNumber(widthSource);
    if (!width) return null;
    const suffix = suffixMatch[1];
    return {
      designation: buildExecutionDesignation(currentDesignation, suffix),
      suffix,
      width,
      height,
    };
  }

  const explicitDesignation = extractDetailDesignation(normalized) || extractCompactDetailDesignation(normalized);
  if (!explicitDesignation || !currentDesignation) return null;
  const remainder = normalized.replace(explicitDesignation, '');
  const firstDigits = remainder.match(/\d{3,6}/)?.[0] ?? '';
  if (firstDigits.length < 4) return null;
  const width = normalizePositiveNumber(firstDigits.slice(0, -1));
  if (!width) return null;

  return {
    designation: explicitDesignation,
    suffix: '',
    width,
    height,
  };
}

function buildExecutionDesignation(baseDesignation: string, suffix: string): string {
  const cleanSuffix = suffix.trim();
  if (!baseDesignation) return cleanSuffix || 'execution';
  if (!cleanSuffix) return baseDesignation;
  if (/^-\d{1,3}$/.test(cleanSuffix)) {
    return `${baseDesignation.replace(/-\d{1,3}$/, '')}${cleanSuffix}`;
  }
  if (/^\d{1,3}$/.test(cleanSuffix)) {
    return `${baseDesignation.replace(/-\d{1,3}$/, '')}-${cleanSuffix.padStart(2, '0')}`;
  }
  return cleanSuffix;
}

function normalizeDetailKey(value: string): string {
  return value.trim().toLowerCase();
}

function isSheetMaterialLine(value: string): boolean {
  return /(?:\bлист\b|бт?\s*-\s*пн|sheet|blech)/iu.test(value);
}

function extractSheetThickness(value: string): number | null {
  return normalizePositiveNumber(value.match(/бт?\s*-\s*пн\s*-\s*(\d+(?:[,.]\d+)?)/iu)?.[1]);
}

function extractMaterialGrade(value: string): string {
  return lastMatch(value, /(?:Ст3сп|Ст3пс|09Г2С|12Х18Н10Т|AISI\s*304|AISI\s*430|40Х|65Г)(?=$|[^A-Za-zА-Яа-яЁё0-9])/giu) ?? '';
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
