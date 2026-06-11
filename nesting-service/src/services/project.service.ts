import type { NestingProject, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateId } from '../lib/utils';
import { AppError, NotFoundError } from '../lib/errors';
import type { ProjectListFilter } from '../schemas/project.schema';
import { queueService } from './queue.service';
import { uploadService } from './upload.service';
import type { BatchUploadInput } from './upload.service';

interface CreateProjectInput {
  id?: string;
  orderNumber: string;
  quantity: number;
}

export interface ProjectWithStats {
  id: string;
  orderNumber: string;
  quantity: number;
  strategy: string;
  status: string;
  errorMessage: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  stepFileUrl: string | null;
  pdfFileUrl: string | null;
  partsCount: number;
  sheetsCount: number;
  avgUtilization: number | null;
}

export interface PaginatedProjectResult {
  data: ProjectWithStats[];
  total: number;
  page: number;
  totalPages: number;
}

type ProjectWithCounts = NestingProject & {
  _count: {
    parts: number;
    sheets: number;
  };
  inputs?: Array<{
    pdfFileUrl: string | null;
  }>;
};

function toProjectWithStats(project: ProjectWithCounts, avgUtilization: number | null = null): ProjectWithStats {
  const inputPdfFileUrl = project.inputs?.find((input) => input.pdfFileUrl)?.pdfFileUrl ?? null;

  return {
    id: project.id,
    orderNumber: project.orderNumber,
    quantity: project.quantity,
    strategy: project.strategy,
    status: project.status,
    errorMessage: project.errorMessage,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    stepFileUrl: project.stepFileUrl,
    pdfFileUrl: project.pdfFileUrl ?? inputPdfFileUrl,
    partsCount: project._count.parts,
    sheetsCount: project._count.sheets,
    avgUtilization,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new AppError(500, message)), timeoutMs);

    promise
      .then(resolve)
      .catch((error) => reject(error instanceof AppError ? error : new AppError(500, message)))
      .finally(() => clearTimeout(timeoutId));
  });
}

export class ProjectService {
  async createProject(
    input: CreateProjectInput,
    stepFilePath: string,
    pdfFilePath: string | null
  ): Promise<{ id: string; status: string }> {
    const id = input.id ?? generateId();
    let created = false;

    try {
      await prisma.nestingProject.create({
        data: {
          id,
          orderNumber: input.orderNumber,
          quantity: input.quantity,
          status: 'created',
          stepFileUrl: stepFilePath,
          pdfFileUrl: pdfFilePath,
        },
      });
      created = true;

      await withTimeout(
        queueService.addStepParsingJob({ projectId: id, stepFilePath, pdfFilePath }),
        5000,
        'Не удалось поставить STEP-файл в очередь парсинга'
      );

      const project = await prisma.nestingProject.update({
        where: { id },
        data: {
          status: 'parsing',
          errorMessage: null,
        },
      });

      return { id: project.id, status: project.status };
    } catch (error) {
      if (created) {
        await prisma.nestingProject.delete({ where: { id } }).catch(() => undefined);
      }
      await uploadService.cleanupProjectFiles(id).catch(() => undefined);
      throw error;
    }
  }

  async createBatchProject(
    input: Pick<CreateProjectInput, 'id' | 'orderNumber'>,
    batchInputs: BatchUploadInput[]
  ): Promise<{ id: string; status: string }> {
    const id = input.id ?? generateId();
    let created = false;

    try {
      const createdInputs = await prisma.$transaction(async (tx) => {
        await tx.nestingProject.create({
          data: {
            id,
            orderNumber: input.orderNumber,
            quantity: 1,
            status: 'created',
            stepFileUrl: null,
            pdfFileUrl: null,
          },
        });

        const rows = [];
        for (const batchInput of batchInputs) {
          const sourceLabel = batchInput.productName || batchInput.drawingNumber || batchInput.sourceId;
          rows.push(await tx.projectInput.create({
            data: {
              projectId: id,
              sourceId: batchInput.sourceId,
              sourceType: batchInput.sourceType,
              machineId: batchInput.machineId ?? null,
              machineName: batchInput.machineName ?? null,
              machineItemId: batchInput.machineItemId ?? null,
              productId: batchInput.productId ?? null,
              productName: batchInput.productName ?? sourceLabel,
              drawingNumber: batchInput.drawingNumber ?? null,
              quantity: batchInput.quantity,
              stepFileUrl: batchInput.stepFilePath,
              pdfFileUrl: batchInput.pdfFilePath,
              sortOrder: batchInput.sortOrder,
            },
          }));
        }
        return rows;
      });
      created = true;

      await withTimeout(
        queueService.addStepParsingJob({
          projectId: id,
          inputs: createdInputs.map((row) => ({
            sourceInputId: row.id,
            sourceId: row.sourceId,
            sourceType: row.sourceType,
            sourceLabel: row.productName || row.drawingNumber || row.sourceId,
            sourceMachineId: row.machineId,
            sourceMachineName: row.machineName,
            sourceMachineItemId: row.machineItemId,
            sourceProductId: row.productId,
            quantity: row.quantity,
            stepFilePath: row.stepFileUrl,
            pdfFilePath: row.pdfFileUrl,
          })),
        }),
        5000,
        'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¿Ð¾ÑÑ‚Ð°Ð²Ð¸Ñ‚ÑŒ STEP-Ñ„Ð°Ð¹Ð»Ñ‹ Ð² Ð¾Ñ‡ÐµÑ€ÐµÐ´ÑŒ Ð¿Ð°Ñ€ÑÐ¸Ð½Ð³Ð°'
      );

      const project = await prisma.nestingProject.update({
        where: { id },
        data: {
          status: 'parsing',
          errorMessage: null,
        },
      });

      return { id: project.id, status: project.status };
    } catch (error) {
      if (created) {
        await prisma.nestingProject.delete({ where: { id } }).catch(() => undefined);
      }
      await uploadService.cleanupProjectFiles(id).catch(() => undefined);
      throw error;
    }
  }

  async getProject(id: string): Promise<ProjectWithStats> {
    const project = await prisma.nestingProject.findUnique({
      where: { id },
      include: {
        inputs: {
          select: { pdfFileUrl: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { parts: true, sheets: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Проект', id);
    }

    const avgUtilization =
      project.status === 'done'
        ? (
            await prisma.nestingSheet.aggregate({
              where: { projectId: id },
              _avg: { utilization: true },
            })
          )._avg.utilization
        : null;

    return toProjectWithStats(project, avgUtilization);
  }

  async listProjects(filter: ProjectListFilter): Promise<PaginatedProjectResult> {
    const where: Prisma.NestingProjectWhereInput = {
      status: filter.status,
      orderNumber: filter.search
        ? {
            contains: filter.search,
            mode: 'insensitive',
          }
        : undefined,
    };

    const [projects, total] = await prisma.$transaction([
      prisma.nestingProject.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        include: {
          _count: {
            select: { parts: true, sheets: true },
          },
        },
      }),
      prisma.nestingProject.count({ where }),
    ]);

    const doneIds = projects.filter((project) => project.status === 'done').map((project) => project.id);
    const averages = doneIds.length
      ? await prisma.nestingSheet.groupBy({
          by: ['projectId'],
          where: { projectId: { in: doneIds } },
          _avg: { utilization: true },
        })
      : [];
    const avgByProjectId = new Map(averages.map((item) => [item.projectId, item._avg.utilization ?? null]));

    return {
      data: projects.map((project) => toProjectWithStats(project, avgByProjectId.get(project.id) ?? null)),
      total,
      page: filter.page,
      totalPages: total === 0 ? 0 : Math.ceil(total / filter.limit),
    };
  }

  async deleteProject(id: string): Promise<void> {
    const project = await prisma.nestingProject.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundError('Проект', id);
    }

    if (project.status === 'parsing' || project.status === 'calculating') {
      await withTimeout(
        queueService.cancelProjectJobs(id),
        1500,
        'Не удалось удалить задачи проекта из очереди'
      ).catch(() => undefined);
    }

    await prisma.nestingProject.delete({ where: { id } });
    await uploadService.cleanupProjectFiles(id);
  }

  async updateStatus(id: string, status: string, errorMessage?: string): Promise<void> {
    await prisma.nestingProject.update({
      where: { id },
      data: {
        status,
        errorMessage: errorMessage ?? null,
      },
    });
  }

  async getStatus(id: string): Promise<{ id: string; status: string; errorMessage: string | null }> {
    const project = await prisma.nestingProject.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        errorMessage: true,
      },
    });

    if (!project) {
      throw new NotFoundError('Проект', id);
    }

    return project;
  }
}

export const projectService = new ProjectService();
