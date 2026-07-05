import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { Prisma } from '@prisma/client';
import { parsePDFAnalysisResponse } from '../lib/ai/openrouter';
import type { MatchResult } from '../lib/ai/types';
import { generateDXFWithWarnings } from '../lib/dxf/generator';
import { transformContourForDxf } from '../lib/dxf/transform';
import { validateDXF } from '../lib/dxf/validate';
import { buildSheetExportGeometry, dxfOptionsForSheet, type SheetExportGeometry } from '../lib/export/sheet-geometry';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { isCompletedProjectStatus } from '../lib/project-status';
import { normalizeCadText } from '../lib/text-encoding';
import { sanitizeFilename, transliterate } from '../lib/utils';
import type { Point2D } from '../lib/nesting/types';

type DiagnosticPackageResult = {
  buffer: Buffer;
  fileName: string;
  warnings: string[];
};

type ReconciliationRow = {
  partId: string;
  partName: string;
  contourSource: string;
  stepWidthMm: number;
  stepHeightMm: number;
  pdfWidthMm: number | null;
  pdfHeightMm: number | null;
  mismatchPercent: number | null;
  stepAreaMismatchPercent: number | null;
  status: 'OK' | 'MISMATCH' | 'NO_PDF_DATA';
  kFactor: number | null;
  kFactorDefaulted: boolean;
  dimensionMismatch: boolean;
  mismatchNote: string | null;
};

const DIMENSION_MATCH_TOLERANCE_PERCENT = 1;

export class DiagnosticPackageService {
  async generate(projectId: string): Promise<DiagnosticPackageResult> {
    const project = await prisma.nestingProject.findUnique({
      where: { id: projectId },
      include: {
        parts: { orderBy: { name: 'asc' } },
        sheets: { orderBy: { sheetIndex: 'asc' } },
        specification: true,
      },
    });

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    if (!isCompletedProjectStatus(project.status)) {
      throw new ValidationError(`Calculation is not finished. Status: ${project.status}`);
    }

    if (project.sheets.length === 0) {
      throw new ValidationError('No sheets available for diagnostic package');
    }

    const geometryBySheetId = new Map<string, SheetExportGeometry>();
    const dxfFiles: Array<{ name: string; content: string }> = [];
    const svgFiles: Array<{ name: string; content: string }> = [];
    const warnings: string[] = [];

    for (const sheet of project.sheets) {
      const geometry = await buildSheetExportGeometry(project.id, sheet.id);
      geometryBySheetId.set(sheet.id, geometry);

      const dxf = generateDXFWithWarnings(
        {
          width: sheet.width,
          height: sheet.height,
          material: geometry.material,
          thickness: sheet.thickness,
        },
        geometry.dxfParts,
        geometry.remnant,
        dxfOptionsForSheet(geometry)
      );
      const validation = validateDXF(dxf.dxfContent);
      if (!validation.valid) {
        throw new AppError(500, `DXF validation failed for sheet ${sheet.sheetIndex}: ${validation.errors.join('; ')}`);
      }
      warnings.push(...dxf.warnings, ...validation.warnings.map((warning) => `sheet ${sheet.sheetIndex}: ${warning}`));

      dxfFiles.push({
        name: `dxf/${sheetFileBase(project.orderNumber, sheet.sheetIndex)}.dxf`,
        content: dxf.dxfContent,
      });
      svgFiles.push({
        name: `sheets/${sheetFileBase(project.orderNumber, sheet.sheetIndex)}.svg`,
        content: renderSheetSvg(geometry),
      });
    }

    const resultJson = buildResultJson(project);
    const parseReportJson = buildParseReportJson(project);
    const reconciliation = buildReconciliation(project);
    const validationReport = project.validationReport ?? { valid: true, violations: [], checkedAt: null };
    const files = [
      { name: 'result.json', content: stableJson(resultJson) },
      { name: 'parse-report.json', content: stableJson(parseReportJson) },
      { name: 'validation.json', content: stableJson(validationReport) },
      { name: 'reconciliation.json', content: stableJson(reconciliation) },
      { name: 'reconciliation.md', content: buildReconciliationMarkdown(reconciliation.rows) },
      { name: 'summary.md', content: buildSummaryMarkdown(project, resultJson, validationReport, reconciliation.rows, warnings) },
      ...svgFiles,
      ...dxfFiles,
    ];

    const buffer = await zipFiles(files);
    const orderLatin = sanitizeFilename(transliterate(project.orderNumber));

    return {
      buffer,
      fileName: sanitizeFilename(`${orderLatin}_diagnostic_package.zip`),
      warnings,
    };
  }
}

export const diagnosticPackageService = new DiagnosticPackageService();

function buildResultJson(project: Prisma.NestingProjectGetPayload<{
  include: { parts: true; sheets: true; specification: true };
}>) {
  const placedByPartId = new Map<string, number>();
  const sheets = project.sheets.map((sheet) => {
    const placements = readArray(sheet.placements).map((placement) => {
      if (isRecord(placement) && typeof placement.partId === 'string') {
        placedByPartId.set(placement.partId, (placedByPartId.get(placement.partId) ?? 0) + 1);
      }
      return placement;
    });

    return {
      id: sheet.id,
      sheetIndex: sheet.sheetIndex,
      material: normalizeCadText(sheet.material),
      steelTypeId: sheet.steelTypeId,
      steelTypeName: sheet.steelTypeName,
      thickness: sheet.thickness,
      width: sheet.width,
      height: sheet.height,
      usedGap: sheet.usedGap,
      usedMargin: sheet.usedMargin,
      utilization: sheet.utilization,
      bboxUtilization: sheet.bboxUtilization,
      waste: sheet.waste,
      isRemnant: Boolean(sheet.remnantId),
      placements,
      remnantGeom: sheet.remnantGeom,
    };
  });
  const totalParts = project.parts.reduce((sum, part) => sum + part.quantity * project.quantity, 0);
  const placedParts = Array.from(placedByPartId.values()).reduce((sum, count) => sum + count, 0);
  const unplacedParts = project.parts.flatMap((part) => {
    const required = part.quantity * project.quantity;
    const placed = placedByPartId.get(part.id) ?? 0;

    if (!part.isSheetMetal) {
      const reason = buildExcludedFromNestingReason(part);
      return Array.from({ length: required }, (_, index) => ({
        partId: part.id,
        name: `${normalizeCadText(part.name)} (#${index + 1}) - ${reason}`,
      }));
    }

    return Array.from({ length: Math.max(required - placed, 0) }, (_, index) => ({
      partId: part.id,
      name: `${normalizeCadText(part.name)} (#${placed + index + 1})`,
    }));
  });

  return {
    project: {
      id: project.id,
      orderNumber: project.orderNumber,
      quantity: project.quantity,
      strategy: project.strategy,
      status: project.status,
      errorMessage: project.errorMessage,
      supersededByProjectId: project.supersededByProjectId,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    sheets,
    unplacedParts,
    totalParts,
    placedParts,
    totalSheets: sheets.length,
    avgUtilization: sheets.length > 0 ? roundPercent(sheets.reduce((sum, sheet) => sum + sheet.utilization, 0) / sheets.length) : 0,
    totalWaste: sheets.length > 0 ? roundPercent(sheets.reduce((sum, sheet) => sum + sheet.waste, 0) / sheets.length) : 0,
  };
}

function buildParseReportJson(project: Prisma.NestingProjectGetPayload<{
  include: { parts: true; sheets: true; specification: true };
}>) {
  return {
    parseReport: project.parseReport,
    parts: project.parts.map((part) => ({
      id: part.id,
      name: normalizeCadText(part.name),
      sourceInputId: part.sourceInputId,
      sourceId: part.sourceId,
      sourceType: part.sourceType,
      sourceLabel: part.sourceLabel,
      material: normalizeCadText(part.material),
      steelTypeId: part.steelTypeId,
      steelTypeName: part.steelTypeName,
      steelTypeRaw: part.steelTypeRaw,
      thickness: part.thickness,
      quantity: part.quantity,
      isSheetMetal: part.isSheetMetal,
      width: part.width,
      height: part.height,
      bboxSizeX: part.bboxSizeX,
      bboxSizeY: part.bboxSizeY,
      bboxSizeZ: part.bboxSizeZ,
      contourSource: part.contourSource,
      bendCount: part.bendCount,
      kFactor: part.kFactor,
      kFactorDefaulted: part.kFactorDefaulted,
      dimensionMismatch: part.dimensionMismatch,
      mismatchNote: part.mismatchNote,
      classificationMethod: part.classificationMethod,
      warnings: [part.classificationWarning].filter(Boolean),
    })),
  };
}

function buildReconciliation(project: Prisma.NestingProjectGetPayload<{
  include: { parts: true; sheets: true; specification: true };
}>): { rows: ReconciliationRow[]; pdfAnalysis: Record<string, unknown> | null } {
  const matches = readMatches(project.specification?.matches);
  const matchesByPartId = new Map(matches.map((match) => [match.partId, match]));
  const details = project.specification?.rawResponse ? parseDetails(project.specification.rawResponse) : [];

  return {
    pdfAnalysis: project.specification
      ? {
          model: project.specification.model,
          tokensUsed: project.specification.tokensUsed,
          cost: project.specification.cost,
          budgetWarning: project.specification.budgetWarning,
          bom: project.specification.bom,
          unmatchedBom: project.specification.unmatchedBom,
          details,
        }
      : null,
    rows: project.parts.filter((part) => part.isSheetMetal).map((part) => {
      const match = matchesByPartId.get(part.id);
      const pdfWidth = toPositiveNumber(match?.suggestedUnfoldingWidth);
      const pdfHeight = toPositiveNumber(match?.suggestedUnfoldingHeight);
      const mismatchPercent = pdfWidth && pdfHeight
        ? compareDimensionsPercent(part.width, part.height, pdfWidth, pdfHeight)
        : null;
      const stepAreaMismatchPercent = pdfWidth && pdfHeight
        ? compareStepAreaPercent(part.width, part.height, pdfWidth, pdfHeight)
        : null;

      return {
        partId: part.id,
        partName: normalizeCadText(part.name),
        contourSource: part.contourSource,
        stepWidthMm: roundMm(part.width),
        stepHeightMm: roundMm(part.height),
        pdfWidthMm: pdfWidth ? roundMm(pdfWidth) : null,
        pdfHeightMm: pdfHeight ? roundMm(pdfHeight) : null,
        mismatchPercent,
        stepAreaMismatchPercent,
        status: mismatchPercent === null
          ? 'NO_PDF_DATA'
          : mismatchPercent <= DIMENSION_MATCH_TOLERANCE_PERCENT
            ? 'OK'
            : 'MISMATCH',
        kFactor: part.kFactor,
        kFactorDefaulted: part.kFactorDefaulted,
        dimensionMismatch: part.dimensionMismatch,
        mismatchNote: part.mismatchNote,
      };
    }),
  };
}

function buildReconciliationMarkdown(rows: ReconciliationRow[]): string {
  const lines = [
    '# PDF/STEP reconciliation',
    '',
    'Conventions:',
    '- Mismatch: max side delta after orientation normalization; each side is divided by the corresponding PDF side.',
    '- STEP area mismatch: absolute area delta divided by STEP unfolding area.',
    '',
    '| Part | STEP mm | PDF mm | Mismatch | STEP area mismatch | Status | K factor | Notes |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |',
  ];

  for (const row of rows) {
    lines.push([
      escapeMarkdown(row.partName),
      `${row.stepWidthMm} x ${row.stepHeightMm}`,
      row.pdfWidthMm && row.pdfHeightMm ? `${row.pdfWidthMm} x ${row.pdfHeightMm}` : 'n/a',
      row.mismatchPercent === null ? 'n/a' : `${row.mismatchPercent}%`,
      row.stepAreaMismatchPercent === null ? 'n/a' : `${row.stepAreaMismatchPercent}%`,
      row.status,
      row.kFactor === null ? 'n/a' : String(row.kFactor),
      escapeMarkdown(row.mismatchNote || (row.kFactorDefaulted ? 'K factor defaulted' : '')),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  return `${lines.join('\n')}\n`;
}

function buildSummaryMarkdown(
  project: Prisma.NestingProjectGetPayload<{ include: { parts: true; sheets: true; specification: true } }>,
  resultJson: ReturnType<typeof buildResultJson>,
  validationReport: Prisma.JsonValue | { valid: boolean; violations: unknown[]; checkedAt: null },
  reconciliationRows: ReconciliationRow[],
  warnings: string[]
): string {
  const violations = isRecord(validationReport) && Array.isArray(validationReport.violations)
    ? validationReport.violations.length
    : 0;
  const mismatchCount = reconciliationRows.filter((row) => row.status === 'MISMATCH').length;
  const noPdfDataCount = reconciliationRows.filter((row) => row.status === 'NO_PDF_DATA').length;

  return [
    `# Diagnostic package: ${project.orderNumber}`,
    '',
    `- Project: ${project.id}`,
    `- Status: ${project.status}`,
    `- Sheets: ${resultJson.totalSheets}`,
    `- Parts: ${resultJson.placedParts}/${resultJson.totalParts}${resultJson.placedParts < resultJson.totalParts ? ' PROBLEM: not all project parts are placed' : ''}`,
    `- Average utilization: ${resultJson.avgUtilization}%`,
    `- Waste: ${resultJson.totalWaste}%`,
    `- Validation violations: ${violations}`,
    `- PDF/STEP mismatches: ${mismatchCount}`,
    `- Parts without PDF unfolding data: ${noPdfDataCount}`,
    `- DXF/SVG warnings: ${warnings.length}`,
    '',
    '## Included files',
    '',
    '- result.json',
    '- parse-report.json',
    '- validation.json',
    '- sheets/*.svg',
    '- dxf/*.dxf',
    '- reconciliation.json',
    '- reconciliation.md',
    '- summary.md',
    '',
  ].join('\n');
}

function buildExcludedFromNestingReason(part: {
  classificationMethod: string | null;
  classificationWarning: string | null;
}): string {
  if (part.classificationMethod === 'manual') {
    return 'ручная метка "Профиль/круг — не для листового раскроя"';
  }

  if (part.classificationMethod === 'pdf_bom') {
    return 'PDF/BOM указал профиль/круг — не для листового раскроя';
  }

  return part.classificationWarning || 'автоматическая классификация как не листовая деталь';
}

function renderSheetSvg(geometry: SheetExportGeometry): string {
  const { sheet } = geometry;
  const strokeWidth = Math.max(Math.min(sheet.width, sheet.height) / 600, 0.35);
  const parts = geometry.dxfParts.map((part, index) => {
    const outer = transformContourForDxf(part.contour, part.rotation, part.x, part.y, part.originalW, part.originalH);
    const holes = part.holes.map((hole) => transformContourForDxf(hole, part.rotation, part.x, part.y, part.originalW, part.originalH));
    const labelX = part.x + part.placedW / 2;
    const labelY = part.y + part.placedH / 2;

    return [
      `<polygon points="${toSvgPoints(outer, sheet.height)}" fill="${index % 2 === 0 ? '#d7ebff' : '#e1f5df'}" stroke="#145ea8" stroke-width="${strokeWidth}"/>`,
      ...holes.map((hole) => `<polygon points="${toSvgPoints(hole, sheet.height)}" fill="#ffffff" stroke="#a86b14" stroke-width="${strokeWidth}"/>`),
      `<text x="${roundMm(labelX)}" y="${roundMm(flipY(labelY, sheet.height))}" font-size="${Math.max(8, Math.min(18, sheet.width / 90))}" text-anchor="middle" dominant-baseline="central" fill="#1f2937">${escapeXml(part.name)}</text>`,
    ].join('\n');
  });
  const remnant = geometry.remnant
    ? `<rect x="${geometry.remnant.x}" y="${flipY(geometry.remnant.y + geometry.remnant.height, sheet.height)}" width="${geometry.remnant.width}" height="${geometry.remnant.height}" fill="none" stroke="#ef4444" stroke-width="${strokeWidth * 1.5}" stroke-dasharray="${strokeWidth * 8} ${strokeWidth * 4}"/>`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheet.width} ${sheet.height}" width="${sheet.width}mm" height="${sheet.height}mm">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<rect x="${sheet.usedMargin}" y="${sheet.usedMargin}" width="${sheet.width - sheet.usedMargin * 2}" height="${sheet.height - sheet.usedMargin * 2}" fill="none" stroke="#94a3b8" stroke-width="${strokeWidth}" stroke-dasharray="${strokeWidth * 4} ${strokeWidth * 3}"/>`,
    `<rect x="0" y="0" width="${sheet.width}" height="${sheet.height}" fill="none" stroke="#111827" stroke-width="${strokeWidth * 1.5}"/>`,
    remnant,
    ...parts,
    '</svg>',
  ].filter(Boolean).join('\n');
}

async function zipFiles(files: Array<{ name: string; content: string }>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) {
      archive.append(file.content, { name: file.name });
    }
    archive.finalize().catch(reject);
  });
}

function sheetFileBase(orderNumber: string, sheetIndex: number): string {
  return sanitizeFilename(`${transliterate(orderNumber)}_sheet${sheetIndex}`);
}

function readMatches(value: unknown): MatchResult[] {
  return readArray(value).filter(isMatchResult);
}

function parseDetails(rawResponse: string): unknown[] {
  try {
    return parsePDFAnalysisResponse(rawResponse).details;
  } catch {
    return [];
  }
}

function compareDimensionsPercent(stepWidth: number, stepHeight: number, pdfWidth: number, pdfHeight: number): number {
  const step = [stepWidth, stepHeight].sort((a, b) => a - b);
  const pdf = [pdfWidth, pdfHeight].sort((a, b) => a - b);
  const widthMismatch = pdf[0] > 0 ? Math.abs(step[0] - pdf[0]) / pdf[0] : 0;
  const heightMismatch = pdf[1] > 0 ? Math.abs(step[1] - pdf[1]) / pdf[1] : 0;
  return roundPercent(Math.max(widthMismatch, heightMismatch) * 100);
}

function compareStepAreaPercent(stepWidth: number, stepHeight: number, pdfWidth: number, pdfHeight: number): number {
  const stepArea = stepWidth * stepHeight;
  const pdfArea = pdfWidth * pdfHeight;
  if (stepArea <= 0 || !Number.isFinite(stepArea) || !Number.isFinite(pdfArea)) {
    return 0;
  }

  return roundPercent((Math.abs(pdfArea - stepArea) / stepArea) * 100);
}

function isMatchResult(value: unknown): value is MatchResult {
  return isRecord(value) && typeof value.partId === 'string';
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function toSvgPoints(points: Point2D[], sheetHeight: number): string {
  return points.map((point) => `${roundMm(point.x)},${roundMm(flipY(point.y, sheetHeight))}`).join(' ');
}

function flipY(y: number, sheetHeight: number): number {
  return sheetHeight - y;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeMarkdown(value: string): string {
  return value.replace(/[|\\]/g, '\\$&').replace(/\r?\n/g, ' ');
}
