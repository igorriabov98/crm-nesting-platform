export const DEFAULT_CUTTING_GAP_MM = 5;
export const DEFAULT_SHEET_MARGIN_MM = 5;

type ResolveNestingParamsInput = {
  material: string;
  thickness: number;
};

type ResolveNestingParamsOptions = {
  getGapForMaterial?: (material: string, thickness: number) => Promise<number | null>;
  warn?: (message: string) => void;
};

export type ResolvedNestingParams = {
  gap: number;
  margin: number;
};

export async function resolveNestingParams(
  input: ResolveNestingParamsInput,
  options: ResolveNestingParamsOptions = {}
): Promise<ResolvedNestingParams> {
  const getGapForMaterial = options.getGapForMaterial ?? ((material, thickness) =>
    getCatalogGapForMaterial(material, thickness));
  const warn = options.warn ?? ((message) => console.warn(message));
  const catalogGap = await getGapForMaterial(input.material, input.thickness);

  if (typeof catalogGap === 'number' && Number.isFinite(catalogGap) && catalogGap > 0) {
    return {
      gap: catalogGap,
      margin: DEFAULT_SHEET_MARGIN_MM,
    };
  }

  warn(
    `[nesting] GapTable rule not found for ${input.material}, thickness ${input.thickness} mm. ` +
    `Using default gap ${DEFAULT_CUTTING_GAP_MM} mm.`
  );

  return {
    gap: DEFAULT_CUTTING_GAP_MM,
    margin: DEFAULT_SHEET_MARGIN_MM,
  };
}

async function getCatalogGapForMaterial(material: string, thickness: number): Promise<number | null> {
  const { catalogService } = await import('../../services/catalog.service');
  return catalogService.getGapForMaterial(material, thickness);
}
