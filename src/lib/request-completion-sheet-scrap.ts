import { rectangularDimensions } from '@/lib/materials/rotatable-dimensions'

export type SheetScrapInput = { lengthMm: number; widthMm: number; quantity: number }

const roundKg = (value: number) => Math.round(value * 1000) / 1000

export function calculateSheetScrap(
  sheetSize: string,
  sheetQuantity: number,
  weightKg: number,
  scraps: SheetScrapInput[],
  wastePercent: number,
) {
  const sides = rectangularDimensions(sheetSize)
  if (!sides || !Number.isInteger(sheetQuantity) || sheetQuantity <= 0 || !Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('Не рассчитаны размер, количество или вес исходных листов')
  }
  const [length, width] = sides
  const sheetArea = length * width
  const totalArea = sheetArea * sheetQuantity
  let usedArea = 0
  const rows = scraps.map((scrap) => {
    const { lengthMm, widthMm, quantity } = scrap
    if (!Number.isFinite(lengthMm) || !Number.isFinite(widthMm) || lengthMm <= 0 || widthMm <= 0
      || !Number.isInteger(quantity) || quantity <= 0 || quantity > sheetQuantity
      || Math.round(lengthMm * 10) !== lengthMm * 10 || Math.round(widthMm * 10) !== widthMm * 10) {
      throw new Error('Укажите размеры с точностью до 0,1 мм и целое количество не больше числа исходных листов')
    }
    const fits = (lengthMm <= length && widthMm <= width) || (lengthMm <= width && widthMm <= length)
    if (!fits || lengthMm * widthMm >= sheetArea) throw new Error('Деловой остаток должен помещаться в исходный лист и быть меньше него')
    const area = lengthMm * widthMm * quantity
    usedArea += area
    const rowWeightKg = roundKg(weightKg * area / totalArea)
    if (rowWeightKg <= 0) throw new Error('Вес делового остатка должен быть не меньше 0,001 кг')
    return { ...scrap, weightKg: rowWeightKg }
  })
  if (usedArea > totalArea + 0.000001) throw new Error('Суммарная площадь деловых остатков превышает площадь исходных листов')
  if (!Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent > 100 || Math.round(wastePercent * 10) !== wastePercent * 10) {
    throw new Error('Отходность должна быть от 0 до 100% с точностью до 0,1%')
  }
  const scrapWeightKg = roundKg(rows.reduce((sum, row) => sum + row.weightKg, 0))
  const wasteBasisKg = roundKg(weightKg - scrapWeightKg)
  if (wasteBasisKg < 0) throw new Error('Вес деловых остатков превышает вес исходных листов')
  const metalScrapKg = roundKg(wasteBasisKg * wastePercent / 100)
  return {
    rows,
    scrapWeightKg,
    wasteBasisKg,
    metalScrapKg,
    usefulKg: roundKg(weightKg - scrapWeightKg - metalScrapKg),
  }
}
