import type { Multipart, MultipartFile } from '@fastify/multipart';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { devNull } from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config';
import { ValidationError } from '../lib/errors';
import { ensureDir } from '../lib/utils';
import { createBatchProjectSchema, createProjectSchema, type CreateBatchProject } from '../schemas/project.schema';

export interface UploadResult {
  stepFilePath: string;
  pdfFilePath: string | null;
  orderNumber: string;
  quantity: number;
}

export interface BatchUploadInput extends Omit<CreateBatchProject['inputs'][number], 'stepField' | 'pdfField'> {
  stepFilePath: string;
  pdfFilePath: string | null;
}

export interface BatchUploadResult {
  orderNumber: string;
  inputs: BatchUploadInput[];
}

type FieldPart = Extract<Multipart, { type: 'field' }>;

export class UploadService {
  private readonly STEP_EXTENSIONS = ['.step', '.stp'];
  private readonly PDF_EXTENSIONS = ['.pdf'];
  private readonly PDF_MAX_BYTES = 50 * 1024 * 1024;

  async processUpload(parts: AsyncIterableIterator<Multipart>, projectId: string): Promise<UploadResult> {
    const projectDir = path.join(config.UPLOAD_DIR, projectId);
    ensureDir(projectDir);

    let stepFilePath: string | null = null;
    let pdfFilePath: string | null = null;
    let orderNumber = '';
    let quantity = 1;

    try {
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname === 'stepFile') {
            if (stepFilePath) {
              await this.discardFile(part);
              throw new ValidationError('Можно загрузить только один STEP-файл');
            }

            stepFilePath = await this.saveUploadedFile(part, projectDir, 'model.step', this.STEP_EXTENSIONS);
            await this.validateFileSize(stepFilePath, config.MAX_FILE_SIZE_MB * 1024 * 1024, 'STEP-файл');
            await this.validateSignature(stepFilePath, 'ISO-10303-21', 'STEP-файл имеет неверную сигнатуру');
            continue;
          }

          if (part.fieldname === 'pdfFile') {
            if (pdfFilePath) {
              await this.discardFile(part);
              throw new ValidationError('Можно загрузить только один PDF-файл');
            }

            pdfFilePath = await this.saveUploadedFile(part, projectDir, 'drawing.pdf', this.PDF_EXTENSIONS);
            await this.validateFileSize(pdfFilePath, this.PDF_MAX_BYTES, 'PDF-файл');
            await this.validateSignature(pdfFilePath, '%PDF', 'PDF-файл имеет неверную сигнатуру');
            continue;
          }

          await this.discardFile(part);
          continue;
        }

        const field = part as FieldPart;
        if (field.fieldname === 'orderNumber') {
          orderNumber = String(field.value ?? '').trim();
        }

        if (field.fieldname === 'quantity') {
          quantity = Number(field.value ?? 1);
        }
      }

      if (!stepFilePath) {
        throw new ValidationError('STEP-файл обязателен');
      }

      const parsed = createProjectSchema.parse({ orderNumber, quantity });

      return {
        stepFilePath,
        pdfFilePath,
        orderNumber: parsed.orderNumber,
        quantity: parsed.quantity,
      };
    } catch (error) {
      await this.cleanupProjectFiles(projectId);
      throw error;
    }
  }

  async cleanupProjectFiles(projectId: string): Promise<void> {
    const uploadDir = path.join(config.UPLOAD_DIR, projectId);
    const outputDir = path.join(config.OUTPUT_DIR, projectId);

    this.assertInsideBase(uploadDir, config.UPLOAD_DIR, 'upload cleanup');
    this.assertInsideBase(outputDir, config.OUTPUT_DIR, 'output cleanup');

    await Promise.all([
      fs.rm(uploadDir, { recursive: true, force: true }),
      fs.rm(outputDir, { recursive: true, force: true }),
    ]);
  }

  async processBatchUpload(parts: AsyncIterableIterator<Multipart>, projectId: string): Promise<BatchUploadResult> {
    const projectDir = path.join(config.UPLOAD_DIR, projectId);
    ensureDir(projectDir);

    const files = new Map<string, string>();
    let metadata = '';

    try {
      for await (const part of parts) {
        if (part.type === 'file') {
          const fileKind = this.getBatchFileKind(part.fieldname);
          if (!fileKind) {
            await this.discardFile(part);
            continue;
          }

          if (files.has(part.fieldname)) {
            await this.discardFile(part);
            throw new ValidationError(`Ð¤Ð°Ð¹Ð»ÑŒÐ´ ${part.fieldname} Ð¿ÐµÑ€ÐµÐ´Ð°Ð½ Ð±Ð¾Ð»ÑŒÑˆÐµ Ð¾Ð´Ð½Ð¾Ð³Ð¾ Ñ€Ð°Ð·Ð°`);
          }

          const allowed = fileKind === 'step' ? this.STEP_EXTENSIONS : this.PDF_EXTENSIONS;
          const targetName = `${this.safeFileStem(part.fieldname)}${path.extname(part.filename).toLowerCase()}`;
          const filePath = await this.saveUploadedFile(part, projectDir, targetName, allowed);
          const label = fileKind === 'step' ? 'STEP-Ñ„Ð°Ð¹Ð»' : 'PDF-Ñ„Ð°Ð¹Ð»';
          const signature = fileKind === 'step' ? 'ISO-10303-21' : '%PDF';

          await this.validateFileSize(
            filePath,
            fileKind === 'step' ? config.MAX_FILE_SIZE_MB * 1024 * 1024 : this.PDF_MAX_BYTES,
            label
          );
          await this.validateSignature(filePath, signature, `${label} Ð¸Ð¼ÐµÐµÑ‚ Ð½ÐµÐ²ÐµÑ€Ð½ÑƒÑŽ ÑÐ¸Ð³Ð½Ð°Ñ‚ÑƒÑ€Ñƒ`);
          files.set(part.fieldname, filePath);
          continue;
        }

        const field = part as FieldPart;
        if (field.fieldname === 'metadata') {
          metadata = String(field.value ?? '');
        }
      }

      if (!metadata.trim()) {
        throw new ValidationError('metadata Ð¾Ð±ÑÐ·Ð°Ñ‚ÐµÐ»ÐµÐ½ Ð´Ð»Ñ Ð¿Ð°ÐºÐµÑ‚Ð½Ð¾Ð¹ Ñ€Ð°ÑÐºÐ»Ð°Ð´ÐºÐ¸');
      }

      let parsedMetadata: unknown;
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        throw new ValidationError('metadata Ð´Ð¾Ð»Ð¶ÐµÐ½ Ð±Ñ‹Ñ‚ÑŒ Ð²Ð°Ð»Ð¸Ð´Ð½Ñ‹Ð¼ JSON');
      }

      const parsed = createBatchProjectSchema.parse(parsedMetadata);
      const inputs = parsed.inputs.map((input): BatchUploadInput => {
        const stepFilePath = files.get(input.stepField);
        const pdfFilePath = input.pdfField ? files.get(input.pdfField) ?? null : null;

        if (!stepFilePath) {
          throw new ValidationError(`ÐÐµ Ð¿ÐµÑ€ÐµÐ´Ð°Ð½ STEP-Ñ„Ð°Ð¹Ð» ${input.stepField}`);
        }

        if (input.pdfField && !pdfFilePath) {
          throw new ValidationError(`ÐÐµ Ð¿ÐµÑ€ÐµÐ´Ð°Ð½ PDF-Ñ„Ð°Ð¹Ð» ${input.pdfField}`);
        }

        return {
          sourceId: input.sourceId,
          sourceType: input.sourceType,
          machineId: input.machineId,
          machineName: input.machineName,
          machineItemId: input.machineItemId,
          productId: input.productId,
          productName: input.productName,
          drawingNumber: input.drawingNumber,
          quantity: input.quantity,
          sortOrder: input.sortOrder,
          stepFilePath,
          pdfFilePath,
        };
      });

      return {
        orderNumber: parsed.orderNumber,
        inputs,
      };
    } catch (error) {
      await this.cleanupProjectFiles(projectId);
      throw error;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    const stat = await fs.stat(filePath);
    return stat.size;
  }

  private async saveUploadedFile(
    part: MultipartFile,
    projectDir: string,
    targetName: string,
    allowedExtensions: string[]
  ): Promise<string> {
    this.validateExtension(part.filename, allowedExtensions);

    const targetPath = path.join(projectDir, targetName);
    this.assertInsideBase(targetPath, projectDir, 'file upload');

    try {
      await pipeline(part.file, createWriteStream(targetPath));
      return targetPath;
    } catch (error) {
      await fs.rm(targetPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async discardFile(part: MultipartFile): Promise<void> {
    await pipeline(part.file, createWriteStream(devNull));
  }

  private getBatchFileKind(fieldname: string): 'step' | 'pdf' | null {
    if (fieldname.startsWith('stepFile_')) return 'step';
    if (fieldname.startsWith('pdfFile_')) return 'pdf';
    return null;
  }

  private safeFileStem(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'file';
  }

  private validateExtension(filename: string, allowed: string[]): void {
    const ext = path.extname(filename).toLowerCase();
    if (!allowed.includes(ext)) {
      throw new ValidationError(`Недопустимый формат файла: ${ext || 'без расширения'}. Разрешены: ${allowed.join(', ')}`);
    }
  }

  private async validateFileSize(filePath: string, maxBytes: number, label: string): Promise<void> {
    const size = await this.getFileSize(filePath);
    if (size <= 0) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      throw new ValidationError(`${label} пустой`);
    }

    if (size > maxBytes) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      throw new ValidationError(`${label} слишком большой. Максимум: ${Math.floor(maxBytes / 1024 / 1024)} МБ`);
    }
  }

  private async validateSignature(filePath: string, signature: string, message: string): Promise<void> {
    const file = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const head = buffer.subarray(0, bytesRead).toString('utf8');
      if (!head.includes(signature)) {
        await fs.rm(filePath, { force: true }).catch(() => undefined);
        throw new ValidationError(message);
      }
    } finally {
      await file.close();
    }
  }

  private assertInsideBase(targetPath: string, basePath: string, action: string): void {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(basePath);
    const relative = path.relative(resolvedBase, resolvedTarget);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path traversal detected during ${action}`);
    }
  }
}

export const uploadService = new UploadService();
