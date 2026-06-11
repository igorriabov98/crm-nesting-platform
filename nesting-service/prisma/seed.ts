import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const prisma = new PrismaClient();

const materials = ['Сталь', 'Нержавейка', 'Алюминий'] as const;
const thicknesses = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12] as const;
const sheetSizes = [
  [2500, 1250],
  [3000, 1500],
  [6000, 1500],
  [6000, 2000],
] as const;

const gapRows = [
  { material: 'Сталь', thicknessMin: 1, thicknessMax: 1, gap: 3 },
  { material: 'Сталь', thicknessMin: 1.01, thicknessMax: 2, gap: 4 },
  { material: 'Сталь', thicknessMin: 2.01, thicknessMax: 5, gap: 5 },
  { material: 'Сталь', thicknessMin: 5.01, thicknessMax: 10, gap: 7 },
  { material: 'Сталь', thicknessMin: 10.01, thicknessMax: 20, gap: 10 },
  { material: 'Нержавейка', thicknessMin: 1, thicknessMax: 1, gap: 3.5 },
  { material: 'Нержавейка', thicknessMin: 1.01, thicknessMax: 2, gap: 4.5 },
  { material: 'Нержавейка', thicknessMin: 2.01, thicknessMax: 5, gap: 6 },
  { material: 'Нержавейка', thicknessMin: 5.01, thicknessMax: 10, gap: 8 },
  { material: 'Алюминий', thicknessMin: 1, thicknessMax: 1, gap: 3 },
  { material: 'Алюминий', thicknessMin: 1.01, thicknessMax: 3, gap: 4 },
  { material: 'Алюминий', thicknessMin: 3.01, thicknessMax: 6, gap: 5 },
] as const;

const kFactorRows = [
  { material: 'Сталь', thicknessMin: 1, thicknessMax: 2, kFactor: 0.35 },
  { material: 'Сталь', thicknessMin: 2.01, thicknessMax: 5, kFactor: 0.4 },
  { material: 'Сталь', thicknessMin: 5.01, thicknessMax: 20, kFactor: 0.45 },
  { material: 'Нержавейка', thicknessMin: 1, thicknessMax: 2, kFactor: 0.35 },
  { material: 'Нержавейка', thicknessMin: 2.01, thicknessMax: 5, kFactor: 0.38 },
  { material: 'Нержавейка', thicknessMin: 5.01, thicknessMax: 10, kFactor: 0.42 },
  { material: 'Алюминий', thicknessMin: 1, thicknessMax: 3, kFactor: 0.33 },
  { material: 'Алюминий', thicknessMin: 3.01, thicknessMax: 6, kFactor: 0.38 },
] as const;

async function seedSheets() {
  for (const material of materials) {
    for (const thickness of thicknesses) {
      for (const [width, height] of sheetSizes) {
        await prisma.sheetCatalog.upsert({
          where: {
            sheet_catalog_unique_dimensions: {
              material,
              thickness,
              width,
              height,
            },
          },
          create: {
            material,
            thickness,
            width,
            height,
            price: null,
            stock: 10,
            isActive: true,
          },
          update: {
            stock: 10,
            isActive: true,
          },
        });
      }
    }
  }
}

async function seedGaps() {
  for (const row of gapRows) {
    await prisma.gapTable.upsert({
      where: {
        gap_table_unique_range: {
          material: row.material,
          thicknessMin: row.thicknessMin,
          thicknessMax: row.thicknessMax,
        },
      },
      create: row,
      update: {
        gap: row.gap,
      },
    });
  }
}

async function seedKFactors() {
  for (const row of kFactorRows) {
    await prisma.kFactor.upsert({
      where: {
        kfactor_unique_range: {
          material: row.material,
          thicknessMin: row.thicknessMin,
          thicknessMax: row.thicknessMax,
        },
      },
      create: row,
      update: {
        kFactor: row.kFactor,
      },
    });
  }
}

async function main() {
  await seedSheets();
  await seedGaps();
  await seedKFactors();

  const [sheetCount, gapCount, kFactorCount] = await Promise.all([
    prisma.sheetCatalog.count(),
    prisma.gapTable.count(),
    prisma.kFactor.count(),
  ]);

  console.log(`Seed completed: ${sheetCount} sheets, ${gapCount} gaps, ${kFactorCount} k-factors.`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
