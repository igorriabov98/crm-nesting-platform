import { z } from 'zod'

export type TransportCargoSnapshotItemV1 = {
  title: string
  drawingLabel: string | null
  description: string | null
  quantityLabel: string | null
  quantity: number | null
  requiredQuantity: number | null
  excessQuantity: number | null
  unit: string | null
  weightKg: number | null
  pieceLengthMm: number | null
  pieceCount: number | null
  machineLabel: string | null
  characteristics: Array<{ label: string; value: string }>
}

export type TransportCargoSnapshotV1 = {
  version: 1
  title: string
  subtitle: string
  itemLabels: string[]
  itemDetails: TransportCargoSnapshotItemV1[]
  volumeLabel: string | null
  weightKg: number | null
}

type CargoSnapshotSource = Omit<TransportCargoSnapshotV1, 'version' | 'itemDetails'> & {
  itemDetails: TransportCargoSnapshotItemV1[]
}

const nullableNumber = z.number().finite().nullable()
const nullableText = z.string().nullable()

const snapshotItemSchema = z.object({
  title: z.string(),
  drawingLabel: nullableText,
  description: nullableText,
  quantityLabel: nullableText,
  quantity: nullableNumber,
  requiredQuantity: nullableNumber,
  excessQuantity: nullableNumber,
  unit: nullableText,
  weightKg: nullableNumber,
  pieceLengthMm: nullableNumber,
  pieceCount: nullableNumber,
  machineLabel: nullableText,
  characteristics: z.array(z.object({ label: z.string(), value: z.string() })),
})

const snapshotSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  subtitle: z.string(),
  itemLabels: z.array(z.string()),
  itemDetails: z.array(snapshotItemSchema),
  volumeLabel: nullableText,
  weightKg: nullableNumber,
})

export function createTransportCargoSnapshot(source: CargoSnapshotSource): TransportCargoSnapshotV1 {
  return {
    version: 1,
    title: source.title,
    subtitle: source.subtitle,
    itemLabels: [...source.itemLabels],
    itemDetails: source.itemDetails.map((item) => ({
      title: item.title,
      drawingLabel: item.drawingLabel,
      description: item.description,
      quantityLabel: item.quantityLabel,
      quantity: item.quantity,
      requiredQuantity: item.requiredQuantity,
      excessQuantity: item.excessQuantity,
      unit: item.unit,
      weightKg: item.weightKg,
      pieceLengthMm: item.pieceLengthMm,
      pieceCount: item.pieceCount,
      machineLabel: item.machineLabel,
      characteristics: item.characteristics.map((entry) => ({ ...entry })),
    })),
    volumeLabel: source.volumeLabel,
    weightKg: source.weightKg,
  }
}

export function parseTransportCargoSnapshot(value: unknown): TransportCargoSnapshotV1 | null {
  const parsed = snapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
