import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import type { Pagination } from '../schemas/common.schema';
import type {
  CreateGap,
  CreateKFactor,
  CreateRemnant,
  CreateSheet,
  RemnantFilter,
  SheetFilter,
  UpdateGap,
  UpdateKFactor,
  UpdateRemnant,
  UpdateSheet,
} from '../schemas/catalog.schema';

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
};

type Sheet = Prisma.SheetCatalogGetPayload<Record<string, never>>;
type Gap = Prisma.GapTableGetPayload<Record<string, never>>;
type KFactor = Prisma.KFactorGetPayload<Record<string, never>>;
type Remnant = Prisma.RemnantGetPayload<Record<string, never>>;

function ensureNonEmptyUpdate(data: Record<string, unknown>) {
  if (Object.keys(data).length === 0) {
    throw new ValidationError('Нужно передать хотя бы одно поле для обновления');
  }
}

function handleUniqueError(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictError(message);
  }

  throw error;
}

export class CatalogService {
  async getSheets(filter: SheetFilter, pagination: Pagination): Promise<PaginatedResult<Sheet>> {
    const where: Prisma.SheetCatalogWhereInput = {
      isActive: true,
      material: filter.material,
      thickness: filter.thickness,
    };

    const [data, total] = await prisma.$transaction([
      prisma.sheetCatalog.findMany({
        where,
        orderBy: [{ material: 'asc' }, { thickness: 'asc' }, { width: 'asc' }, { height: 'asc' }],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.sheetCatalog.count({ where }),
    ]);

    return {
      data,
      total,
      page: pagination.page,
      totalPages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
    };
  }

  async createSheet(data: CreateSheet): Promise<Sheet> {
    const existing = await prisma.sheetCatalog.findUnique({
      where: {
        sheet_catalog_unique_dimensions: {
          material: data.material,
          thickness: data.thickness,
          width: data.width,
          height: data.height,
        },
      },
    });

    if (existing?.isActive) {
      return existing;
    }

    if (existing) {
      return prisma.sheetCatalog.update({
        where: { id: existing.id },
        data: {
          ...data,
          price: data.price ?? null,
          isActive: true,
        },
      });
    }

    return prisma.sheetCatalog.create({
      data: {
        ...data,
        price: data.price ?? null,
      },
    });
  }

  async updateSheet(id: string, data: UpdateSheet): Promise<Sheet> {
    ensureNonEmptyUpdate(data);

    const existing = await prisma.sheetCatalog.findUnique({ where: { id } });
    if (!existing || !existing.isActive) {
      throw new NotFoundError('Лист', id);
    }

    try {
      return await prisma.sheetCatalog.update({
        where: { id },
        data: {
          ...data,
          price: 'price' in data ? data.price : undefined,
        },
      });
    } catch (error) {
      return handleUniqueError(error, 'Лист с такими параметрами уже существует');
    }
  }

  async deleteSheet(id: string): Promise<void> {
    const existing = await prisma.sheetCatalog.findUnique({ where: { id } });
    if (!existing || !existing.isActive) {
      throw new NotFoundError('Лист', id);
    }

    await prisma.sheetCatalog.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getGaps(filter?: { material?: string }): Promise<Gap[]> {
    return prisma.gapTable.findMany({
      where: { material: filter?.material },
      orderBy: [{ material: 'asc' }, { thicknessMin: 'asc' }],
    });
  }

  async getGapForMaterial(material: string, thickness: number): Promise<number | null> {
    const rule = await prisma.gapTable.findFirst({
      where: {
        material,
        thicknessMin: { lte: thickness },
        thicknessMax: { gte: thickness },
      },
      orderBy: { thicknessMin: 'desc' },
    });

    return rule?.gap ?? null;
  }

  async createGap(data: CreateGap): Promise<Gap> {
    try {
      return await prisma.gapTable.create({ data });
    } catch (error) {
      return handleUniqueError(error, 'Правило перемычки для этого диапазона уже существует');
    }
  }

  async updateGap(id: string, data: UpdateGap): Promise<Gap> {
    ensureNonEmptyUpdate(data);

    const existing = await prisma.gapTable.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Правило перемычки', id);
    }

    const nextMin = data.thicknessMin ?? existing.thicknessMin;
    const nextMax = data.thicknessMax ?? existing.thicknessMax;
    if (nextMin > nextMax) {
      throw new ValidationError('thicknessMin должен быть меньше или равен thicknessMax');
    }

    try {
      return await prisma.gapTable.update({ where: { id }, data });
    } catch (error) {
      return handleUniqueError(error, 'Правило перемычки для этого диапазона уже существует');
    }
  }

  async deleteGap(id: string): Promise<void> {
    await this.ensureGapExists(id);
    await prisma.gapTable.delete({ where: { id } });
  }

  async getKFactors(filter?: { material?: string }): Promise<KFactor[]> {
    return prisma.kFactor.findMany({
      where: { material: filter?.material },
      orderBy: [{ material: 'asc' }, { thicknessMin: 'asc' }],
    });
  }

  async getKFactorForMaterial(material: string, thickness: number): Promise<number> {
    const rule = await prisma.kFactor.findFirst({
      where: {
        material,
        thicknessMin: { lte: thickness },
        thicknessMax: { gte: thickness },
      },
      orderBy: { thicknessMin: 'desc' },
    });

    return rule?.kFactor ?? 0.4;
  }

  async createKFactor(data: CreateKFactor): Promise<KFactor> {
    try {
      return await prisma.kFactor.create({ data });
    } catch (error) {
      return handleUniqueError(error, 'K-factor для этого диапазона уже существует');
    }
  }

  async updateKFactor(id: string, data: UpdateKFactor): Promise<KFactor> {
    ensureNonEmptyUpdate(data);

    const existing = await prisma.kFactor.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('K-factor', id);
    }

    const nextMin = data.thicknessMin ?? existing.thicknessMin;
    const nextMax = data.thicknessMax ?? existing.thicknessMax;
    if (nextMin > nextMax) {
      throw new ValidationError('thicknessMin должен быть меньше или равен thicknessMax');
    }

    try {
      return await prisma.kFactor.update({ where: { id }, data });
    } catch (error) {
      return handleUniqueError(error, 'K-factor для этого диапазона уже существует');
    }
  }

  async deleteKFactor(id: string): Promise<void> {
    await this.ensureKFactorExists(id);
    await prisma.kFactor.delete({ where: { id } });
  }

  async getRemnants(filter?: RemnantFilter): Promise<Remnant[]> {
    return prisma.remnant.findMany({
      where: {
        isAvailable: filter?.availableOnly === false ? undefined : true,
        material: filter?.material,
        thickness: filter?.thickness,
      },
      orderBy: [{ material: 'asc' }, { thickness: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createRemnant(data: CreateRemnant): Promise<Remnant> {
    return prisma.remnant.create({ data });
  }

  async updateRemnant(id: string, data: UpdateRemnant): Promise<Remnant> {
    ensureNonEmptyUpdate(data);

    const existing = await prisma.remnant.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Остаток', id);
    }

    return prisma.remnant.update({ where: { id }, data });
  }

  async markRemnantUsed(id: string, usedInOrder: string): Promise<void> {
    const existing = await prisma.remnant.findUnique({ where: { id } });
    if (!existing || !existing.isAvailable) {
      throw new NotFoundError('Доступный остаток', id);
    }

    await prisma.remnant.update({
      where: { id },
      data: {
        isAvailable: false,
        usedAt: new Date(),
        usedInOrder,
      },
    });
  }

  async deleteRemnant(id: string): Promise<void> {
    const existing = await prisma.remnant.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Остаток', id);
    }

    await prisma.remnant.delete({ where: { id } });
  }

  private async ensureGapExists(id: string): Promise<void> {
    const existing = await prisma.gapTable.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('Правило перемычки', id);
    }
  }

  private async ensureKFactorExists(id: string): Promise<void> {
    const existing = await prisma.kFactor.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError('K-factor', id);
    }
  }
}

export const catalogService = new CatalogService();
