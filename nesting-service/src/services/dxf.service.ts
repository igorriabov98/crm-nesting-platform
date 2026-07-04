import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { AppError, NotFoundError, ValidationError } from '../lib/errors';
import { buildDxfZipBuffer, writeDxfZipFile, type DxfZipEntry } from '../lib/dxf/download-archive';
import { generateDXFWithWarnings } from '../lib/dxf/generator';
import { validateDXF } from '../lib/dxf/validate';
import { prisma } from '../lib/prisma';
import { ensureDir, sanitizeFilename, transliterate } from '../lib/utils';
import { isStorageConfigured, uploadStorageBuffer } from '../lib/storage';
import { isCompletedProjectStatus } from '../lib/project-status';
import { buildSheetExportGeometry, dxfOptionsForSheet } from '../lib/export/sheet-geometry';

type DxfSheetResult = {
  filePath: string | null;
  fileName: string;
  dxfContent: string;
  storageUri: string | null;
  warnings: string[];
};

type DxfZipResult = {
  filePath: string | null;
  fileName: string;
  storageUri: string | null;
  warnings: string[];
};

export class DxfService {
  async generateForSheet(projectId: string, sheetId: string): Promise<DxfSheetResult> {
    const geometry = await buildSheetExportGeometry(projectId, sheetId);
    const { material, project, sheet } = geometry;
    const generation = generateDXFWithWarnings(
      {
        width: sheet.width,
        height: sheet.height,
        material,
        thickness: sheet.thickness,
      },
      geometry.dxfParts,
      geometry.remnant,
      dxfOptionsForSheet(geometry)
    );
    const { dxfContent, warnings } = generation;

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

    return { filePath, fileName, dxfContent, storageUri, warnings };
  }

  async generateZip(projectId: string): Promise<DxfZipResult> {
    const project = await prisma.nestingProject.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundError('Project', projectId);
    }

    if (!isCompletedProjectStatus(project.status)) {
      throw new ValidationError(`Calculation is not finished. Status: ${project.status}`);
    }

    const sheets = await prisma.nestingSheet.findMany({
      where: { projectId },
      orderBy: { sheetIndex: 'asc' },
    });

    if (sheets.length === 0) {
      throw new ValidationError('No sheets available for DXF export');
    }

    const files: DxfZipEntry[] = [];
    const warnings: string[] = [];
    for (const sheet of sheets) {
      const result = await this.generateForSheet(projectId, sheet.id);
      files.push({ fileName: result.fileName, content: result.dxfContent });
      warnings.push(...result.warnings);
    }

    const orderLatin = sanitizeFilename(transliterate(project.orderNumber));
    const fileName = sanitizeFilename(`${orderLatin}_all_sheets.zip`);
    let filePath: string | null = null;
    let storageUri: string | null = null;

    if (isStorageConfigured()) {
      const zipBuffer = await buildDxfZipBuffer(files, warnings);
      storageUri = await uploadStorageBuffer(`projects/${projectId}/${fileName}`, zipBuffer, 'application/zip');
    } else {
      const outputDir = path.resolve(config.OUTPUT_DIR, projectId);
      ensureDir(outputDir);
      filePath = path.join(outputDir, fileName);
      await writeDxfZipFile(filePath, files, warnings);
    }

    return { filePath, fileName, storageUri, warnings };
  }
}

export const dxfService = new DxfService();

function formatThicknessForFilename(thickness: number): string {
  return Number.parseFloat(thickness.toFixed(4)).toString().replace('.', '_');
}
