import archiver from 'archiver';
import { createWriteStream, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { Part } from '@prisma/client';
import { config } from '../config';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';
import { CAM_DXF_OPTIONS, generateDXF, type DxfPartData, type DxfRemnantData } from '../lib/dxf/generator';
import { readFittedPartGeometry } from '../lib/dxf/part-geometry';
import { validateDXF } from '../lib/dxf/validate';
import type { DxfRotation } from '../lib/dxf/transform';
import { prisma } from '../lib/prisma';
import { normalizeCadText } from '../lib/text-encoding';
import { ensureDir, sanitizeFilename, transliterate } from '../lib/utils';
import { isStorageConfigured, uploadStorageBuffer } from '../lib/storage';

type PlacementForDxf = {
  partId: string;
  name?: string;
  x: number;
  y: number;
  rotation: DxfRotation;
  placedW: number;
  placedH: number;
};

type DxfSheetResult = {
  filePath: string | null;
  fileName: string;
  dxfContent: string;
  storageUri: string | null;
};

type DxfZipResult = {
  filePath: string | null;
  fileName: string;
  storageUri: string | null;
};

export class DxfService {
  async generateForSheet(projectId: string, sheetId: string): Promise<DxfSheetResult> {
    const project = await prisma.nestingProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    if (project.status !== 'done') {
      throw new ValidationError(`Calculation is not finished. Status: ${project.status}`);
    }

    const sheet = await prisma.nestingSheet.findUnique({
      where: { id: sheetId },
    });

    if (!sheet || sheet.projectId !== projectId) {
      throw new NotFoundError('Sheet', sheetId);
    }

    const placements = readPlacements(sheet.placements, sheetId);
    const partIds = Array.from(new Set(placements.map((placement) => placement.partId)));
    const parts = await prisma.part.findMany({
      where: { id: { in: partIds }, projectId },
    });
    const partsById = new Map(parts.map((part) => [part.id, part]));

    const dxfParts = placements.map((placement) => {
      const part = partsById.get(placement.partId);

      if (!part) {
        throw new ValidationError(`Placement references missing part ${placement.partId}`);
      }

      return toDxfPartData(placement, part);
    });

    const remnant = readRemnant(sheet.remnantGeom, sheetId);
    const material = normalizeCadText(sheet.material);
    const dxfContent = generateDXF(
      {
        width: sheet.width,
        height: sheet.height,
        material,
        thickness: sheet.thickness,
      },
      dxfParts,
      remnant,
      CAM_DXF_OPTIONS
    );

    const validation = validateDXF(dxfContent);
    if (!validation.valid) {
      throw new AppError(500, `DXF validation failed: ${validation.errors.join('; ')}`);
    }

    if (validation.warnings.length > 0) {
      console.warn('[dxf] warnings:', validation.warnings);
    }

    const orderLatin = sanitizeFilename(transliterate(project.orderNumber));
    const materialLatin = sanitizeFilename(transliterate(material));
    const thickness = formatThicknessForFilename(sheet.thickness);
    const fileName = sanitizeFilename(`${orderLatin}_${materialLatin}_${thickness}mm_sheet${sheet.sheetIndex}.dxf`);
    let filePath: string | null = null;
    let storageUri: string | null = null;

    if (isStorageConfigured()) {
      storageUri = await uploadStorageBuffer(
        `projects/${projectId}/${fileName}`,
        Buffer.from(dxfContent, 'utf8'),
        'application/dxf'
      );
    } else {
      const outputDir = path.resolve(config.OUTPUT_DIR, projectId);
      ensureDir(outputDir);
      filePath = path.join(outputDir, fileName);
      writeFileSync(filePath, dxfContent, 'utf-8');
    }

    await prisma.nestingSheet.update({
      where: { id: sheetId },
      data: { dxfFileUrl: filePath, dxfStorageUri: storageUri },
    });

    return { filePath, fileName, dxfContent, storageUri };
  }

  async generateZip(projectId: string): Promise<DxfZipResult> {
    const project = await prisma.nestingProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    if (project.status !== 'done') {
      throw new ValidationError(`Calculation is not finished. Status: ${project.status}`);
    }

    const sheets = await prisma.nestingSheet.findMany({
      where: { projectId },
      orderBy: { sheetIndex: 'asc' },
    });

    if (sheets.length === 0) {
      throw new ValidationError('No sheets available for DXF export');
    }

    const files: { fileName: string; content: string }[] = [];
    for (const sheet of sheets) {
      const result = await this.generateForSheet(projectId, sheet.id);
      files.push({ fileName: result.fileName, content: result.dxfContent });
    }

    const orderLatin = sanitizeFilename(transliterate(project.orderNumber));
    const fileName = sanitizeFilename(`${orderLatin}_all_sheets.zip`);
    let filePath: string | null = null;
    let storageUri: string | null = null;

    if (isStorageConfigured()) {
      const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
        const output = new PassThrough();
        const chunks: Buffer[] = [];
        output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        output.on('end', () => resolve(Buffer.concat(chunks)));
        output.on('error', reject);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', reject);
        archive.pipe(output);
        for (const file of files) archive.append(file.content, { name: file.fileName });
        archive.finalize().catch(reject);
      });
      storageUri = await uploadStorageBuffer(`projects/${projectId}/${fileName}`, zipBuffer, 'application/zip');
    } else {
      const outputDir = path.resolve(config.OUTPUT_DIR, projectId);
      ensureDir(outputDir);
      filePath = path.join(outputDir, fileName);
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath!);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);

      for (const file of files) {
        archive.append(file.content, { name: file.fileName });
      }

        archive.finalize().catch(reject);
      });
    }

    return { filePath, fileName, storageUri };
  }
}

export const dxfService = new DxfService();

function toDxfPartData(placement: PlacementForDxf, part: Part): DxfPartData {
  const localWidth = isQuarterTurn(placement.rotation) ? placement.placedH : placement.placedW;
  const localHeight = isQuarterTurn(placement.rotation) ? placement.placedW : placement.placedH;
  const { contour, holes } = readFittedPartGeometry(part.contour, part.holes, localWidth, localHeight);

  return {
    name: normalizeCadText(placement.name || part.name),
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation,
    placedW: placement.placedW,
    placedH: placement.placedH,
    contour,
    holes,
    originalW: localWidth,
    originalH: localHeight,
    grainLock: part.grainLock,
  };
}

function readPlacements(value: unknown, sheetId: string): PlacementForDxf[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`Sheet ${sheetId} placements are not an array`);
  }

  return value.map((placement, index) => readPlacement(placement, sheetId, index));
}

function readPlacement(value: unknown, sheetId: string, index: number): PlacementForDxf {
  if (!isRecord(value)) {
    throw new ValidationError(`Sheet ${sheetId} placement #${index + 1} is not an object`);
  }

  const rotation = readRotation(value.rotation);

  if (
    typeof value.partId !== 'string' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    rotation === null ||
    !isFiniteNumber(value.placedW) ||
    !isFiniteNumber(value.placedH)
  ) {
    throw new ValidationError(`Sheet ${sheetId} placement #${index + 1} has invalid geometry`);
  }

  if (value.placedW <= 0 || value.placedH <= 0) {
    throw new ValidationError(`Sheet ${sheetId} placement #${index + 1} has non-positive size`);
  }

  return {
    partId: value.partId,
    name: typeof value.name === 'string' ? value.name : undefined,
    x: value.x,
    y: value.y,
    rotation,
    placedW: value.placedW,
    placedH: value.placedH,
  };
}

function readRemnant(value: unknown, sheetId: string): DxfRemnantData | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new ValidationError(`Sheet ${sheetId} remnant geometry is invalid`);
  }

  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    throw new ValidationError(`Sheet ${sheetId} remnant geometry has invalid dimensions`);
  }

  if (value.width <= 0 || value.height <= 0) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

function readRotation(value: unknown): DxfRotation | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) {
    return value;
  }

  return null;
}

function isQuarterTurn(rotation: DxfRotation): boolean {
  return rotation === 90 || rotation === 270;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatThicknessForFilename(thickness: number): string {
  return Number.parseFloat(thickness.toFixed(4)).toString().replace('.', '_');
}
