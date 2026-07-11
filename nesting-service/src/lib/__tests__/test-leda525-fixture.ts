import assert from 'node:assert/strict';
import path from 'node:path';
import { applyDimensionGuard } from '../ai/dimension-guard';
import { extractDeterministicPdfDataFromPdf } from '../ai/pdf-bom-fallback';
import { resolveBOMSteelTypes } from '../ai/steel-types';
import type { MatchResult, PartForMatching, SteelTypeCatalogItem } from '../ai/types';
import { matchBOMToParts } from '../ai/bom-matcher';
import { polygonNetArea, type Point2D } from '../geometry';
import type { PlacedPart, SheetResult } from '../nesting/types';
import { parseStepFile, type ParsedPart } from '../step-parser';
import { validateLayout } from '../validation/layout-validator';
import { validateSimpleUnfoldContour } from '../brep/unfolder';
import { assertUnfoldShape, openLoop } from './unfold-shape-assertions';

type FixturePart = ParsedPart & { id: string };

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/real');
const STEP_PATH = path.join(FIXTURES_DIR, 'LEDA525_Bulk_skip.STEP');
const PDF_PATH = path.join(FIXTURES_DIR, 'LEDA525_Detail.pdf');

const STEEL_TYPES: SteelTypeCatalogItem[] = [
  { id: 'steel-s235jrg2', name: 'S235JRG2', densityKgMm3: 0.00000785 },
  { id: 'steel-stahl', name: 'Stahl', densityKgMm3: 0.00000785 },
];

async function main(): Promise<void> {
  const startedAt = Date.now();
  const parsed = await parseStepFile(STEP_PATH);
  assert.equal(parsed.success, true, 'LEDA.525 STEP should parse');
  assert.equal(parsed.totalMeshes, 20, 'LEDA.525 totalBodies');
  assert.equal(parsed.parts.length, 20, 'LEDA.525 parsed part rows');
  assert.equal(parsed.brepUnfolded, 7, 'LEDA.525 unfolded count');
  assert.equal(parsed.parts.filter((part) => part.suspectedBend).length, 0, 'LEDA.525 suspectedFallback');
  assert.equal(parsed.parts.filter((part) => part.partType === 'PROFILE').length, 7, 'LEDA.525 profile count');
  assertNoMojibake(parsed.parts);
  assertAllContoursSimple(parsed.parts);

  const parts = parsed.parts.map((part, index) => ({ ...part, id: String(index) }));
  const pdf = await extractDeterministicPdfDataFromPdf(PDF_PATH);
  const bom = resolveBOMSteelTypes(pdf.bom, STEEL_TYPES);
  const matches = matchBOMToParts(bom, parts.map(toPartForMatching), pdf.details, STEEL_TYPES);

  assert.equal(bom.length, 9, 'LEDA.525 PDF BOM rows');
  assert.equal(matches.length, 20, 'LEDA.525 should produce one match per STEP body');
  assert.equal(matches.every((match) => match.matchType !== 'none'), true, 'all LEDA.525 bodies should match BOM');

  assertSidewalls(parts, bom, matches);
  assertRearWall(parts);
  assertSupports(parts);
  assertLugs(parts, matches);
  assertProfiles(parts, matches);
  assertProjectValidation(parts);

  console.log(`[leda525-fixture] parseMs=${parsed.parseTimeMs} elapsedMs=${Date.now() - startedAt}`);
  console.log('[leda525-fixture] all tests passed');
}

function assertSidewalls(
  parts: FixturePart[],
  bom: Awaited<ReturnType<typeof extractDeterministicPdfDataFromPdf>>['bom'],
  matches: MatchResult[]
): void {
  const sidewalls = ['Боковая стенка', 'Боковая стенка левая'].map((name) => mustFind(parts, name));
  const sideBomRows = bom.filter((entry) => entry.name === 'BL 2 x 702 x 1656');
  assert.equal(sideBomRows.length, 2, 'sidewalls should keep two separate BOM rows');
  assert.equal(sideBomRows.every((entry) => entry.quantity === 1), true, 'each sidewall BOM row should have qty=1');

  const sideMatches = matches.filter((match) => sidewalls.some((part) => part.id === match.partId));
  assert.equal(sideMatches.length, 2, 'sidewall BOM rows should map to two sidewall bodies');
  assert.deepEqual(new Set(sideMatches.map((match) => match.partName)), new Set(['Боковая стенка', 'Боковая стенка левая']));

  for (const part of sidewalls) {
    assert.equal(part.contourSource, 'UNFOLDED_BREP', `${part.name} contourSource`);
    assert.equal(part.bendCount, 5, `${part.name} bend count`);
    assert.equal(part.suspectedBend, false, `${part.name} should not need review`);
    assertApprox(part.width, 1656.29, 0.05, `${part.name} width`);
    assertApprox(part.height, 699.99, 0.05, `${part.name} height`);
    assertUnfoldShape(
      { contour: part.contour, holes: part.holes },
      {
        label: part.name,
        expectedArea: expectedArea(part),
        areaTolerance: 0.001,
        bomBbox: { width: 1656.29, height: 702, tolerance: 0.5 },
        minContourPoints: 8,
      }
    );
    assertHasUndirectedSegmentAngle(part.contour, 37, 0.75, 300, `${part.name} should keep long 37deg skew edge`);
  }
}

function assertRearWall(parts: FixturePart[]): void {
  const rear = mustFind(parts, 'Задняя стенка');
  assert.equal(rear.contourSource, 'UNFOLDED_BREP', 'rear wall contourSource');
  assert.equal(rear.bendCount, 5, 'rear wall bend count');
  assertApprox(rear.width, 995, 0.05, 'rear wall width');
  assertApprox(rear.height, 2319.39, 0.05, 'rear wall height');
  assertUnfoldShape(
    { contour: rear.contour, holes: rear.holes },
    {
      label: 'rear wall',
      expectedArea: expectedArea(rear),
      bomBbox: { width: 995, height: 2319.39, tolerance: 0.5 },
      exactContourPoints: 4,
    }
  );
}

function assertSupports(parts: FixturePart[]): void {
  const supports = parts.filter((part) => part.name === 'Опора');
  assert.equal(supports.length, 4, 'support quantity');

  for (const support of supports) {
    assert.equal(support.contourSource, 'UNFOLDED_BREP', 'support contourSource');
    assert.equal(support.bendCount, 3, 'support fragmented bend should merge to three bends');
    assertApprox(support.width, 75, 0.05, 'support width');
    assertApprox(support.height, 276.95, 0.05, 'support height');
    assertUnfoldShape(
      { contour: support.contour, holes: support.holes },
      {
        label: 'support',
        expectedArea: expectedArea(support),
        bomBbox: { width: 75, height: 276.95, tolerance: 0.5 },
        minContourPoints: 8,
        featurePoints: [
          { x: 32.5, y: 0, tolerance: 0.1, label: 'support tab left root' },
          { x: 42.5, y: 0, tolerance: 0.1, label: 'support tab right root' },
          { x: 32.5, y: 10, tolerance: 0.15, label: 'support tab left shoulder' },
          { x: 42.5, y: 10, tolerance: 0.15, label: 'support tab right shoulder' },
        ],
      }
    );
  }
}

function assertLugs(parts: FixturePart[], matches: MatchResult[]): void {
  const upper = parts.filter((part) => part.name === 'Проушина верхняя');
  const lower = parts.filter((part) => part.name === 'Проушина нижняя');
  assert.equal(upper.length, 4, 'upper lug quantity');
  assert.equal(lower.length, 2, 'lower lug quantity');

  for (const part of upper) {
    assert.equal(part.thickness, 20, 'upper lug thickness');
    assertApprox(part.width, 230, 0.05, 'upper lug width');
    assertApprox(part.height, 68, 0.05, 'upper lug STEP height');
    const match = mustFindMatch(matches, part.id);
    assert.equal(match.bomDesignation, '10464.geo', 'upper lug BOM designation');
    assert.equal(match.suggestedUnfoldingWidth, 65, 'upper lug PDF width');
    assert.equal(match.suggestedUnfoldingHeight, 230, 'upper lug PDF height');
    const guard = applyDimensionGuard({}, part, match.suggestedUnfoldingWidth, match.suggestedUnfoldingHeight);
    const data = guard.data as { dimensionMismatch?: boolean; mismatchNote?: string; width?: number; height?: number };
    assert.equal(guard.mismatch, true, 'upper lug should flag PDF65 vs STEP68 dimension mismatch');
    assert.equal(data.dimensionMismatch, true, 'upper lug dimensionMismatch flag');
    assert.equal(data.width, undefined, 'upper lug mismatch must keep STEP width');
    assert.equal(data.height, undefined, 'upper lug mismatch must keep STEP height');
    assert.match(data.mismatchNote ?? '', /PDF предлагает 65 x 230 мм/);
    assert.match(data.mismatchNote ?? '', /STEP содержит 230 x 68 мм/);
  }

  for (const part of lower) {
    assert.equal(part.thickness, 20, 'lower lug thickness');
    assertApprox(part.width, 160, 0.5, 'lower lug width');
    assertApprox(part.height, 90, 0.05, 'lower lug height');
    assert.equal(mustFindMatch(matches, part.id).bomDesignation, '10461.geo', 'lower lug BOM designation');
  }
}

function assertProfiles(parts: FixturePart[], matches: MatchResult[]): void {
  const u80 = parts.filter((part) => part.name === 'Профиль 690');
  const u50 = parts.filter((part) => part.name === 'Профиль 1090');
  const roundBars = parts.filter((part) => part.name === 'Круг');

  assert.equal(u80.length, 4, 'U80 profile quantity');
  assert.equal(u50.length, 1, 'U50 profile quantity');
  assert.equal(roundBars.length, 2, 'RU16 round bar quantity');

  for (const part of u80) {
    assert.equal(part.partType, 'PROFILE', 'U80 part type');
    assert.equal(part.contourSource, 'CONVEX_HULL', 'U80 contourSource');
    assertApprox(part.width, 80, 0.05, 'U80 width');
    assertApprox(part.height, 690, 0.05, 'U80 length');
    assert.match(mustFindMatch(matches, part.id).matchDetails, /type: channel/);
  }

  for (const part of u50) {
    assert.equal(part.partType, 'PROFILE', 'U50 part type');
    assert.equal(part.contourSource, 'CONVEX_HULL', 'U50 contourSource');
    assertApprox(part.height, 1090, 0.05, 'U50 length');
    const match = mustFindMatch(matches, part.id);
    assert.equal(match.suggestedPartType, 'PROFILE', 'U50 profile suggestion');
    assertApprox(match.matchConfidence, 0.7, 0.001, 'U50 simplified profile confidence');
  }

  for (const part of roundBars) {
    assert.equal(part.partType, 'PROFILE', 'RU16 part type');
    assert.equal(part.contourSource, 'CONVEX_HULL', 'RU16 contourSource');
    assertApprox(part.width, 16, 0.1, 'RU16 diameter');
    assertApprox(part.height, 60, 0.05, 'RU16 length');
    assert.match(mustFindMatch(matches, part.id).matchDetails, /type: round_bar/);
  }
}

function assertProjectValidation(parts: FixturePart[]): void {
  const placed = parts.filter((part) => part.contourSource === 'UNFOLDED_BREP');
  const profiles = parts.filter((part) => part.partType === 'PROFILE');
  const noSheet = parts.filter((part) => part.partType === 'SHEET' && part.thickness === 20);

  assert.equal(placed.length, 7, 'placed/unfolded parts');
  assert.equal(noSheet.length, 6, 't20 lugs should be noSheet warnings');

  const validation = validateLayout(
    placed.map(toValidationSheet),
    placed.map((part) => ({ id: part.id, name: part.name, quantity: 1 })),
    {
      stepSolidCount: parts.length,
      accountedBodies: placed.length + profiles.length + noSheet.length,
      excludedParts: profiles.map((part) => ({
        partId: part.id,
        name: part.name,
        quantity: 1,
        reason: 'PDF/BOM or geometry classified this body as profile',
        reasonCode: 'EXCLUDED_PROFILE' as const,
      })),
    }
  );
  const violationCount = validation.violations.filter((violation) => violation.severity !== 'info').length;
  assert.equal(noSheet.length, 6, 'LEDA.525 t20 lugs should be noSheet warnings');
  assert.equal(validation.valid, true, 'LEDA.525 geometry validation should be clean');
  assert.equal(violationCount, 0, 'LEDA.525 validation violationCount');
  assert.equal(noSheet.length > 0, true, 'production nesting status should be completed_with_warnings');
}

function toValidationSheet(part: FixturePart, index: number): SheetResult {
  const margin = 5;
  const x = 10;
  const y = 10;
  const contour = translate(part.contour, x, y);
  const holes = part.holes.map((hole) => translate(hole, x, y));

  return {
    sheetOptionId: `leda525-validation-${index}`,
    width: part.width + 20,
    height: part.height + 20,
    material: 'Сталь',
    steelTypeId: null,
    steelTypeName: null,
    thickness: part.thickness ?? 0,
    isRemnant: false,
    usedGap: 1,
    usedMargin: margin,
    placements: [{
      partId: part.id,
      name: part.name,
      x,
      y,
      rotation: 0,
      placedW: part.width,
      placedH: part.height,
      area: polygonNetArea(part.contour, part.holes),
      contour,
      holes,
    } satisfies PlacedPart],
    utilization: 0,
    bboxUtilization: 0,
    waste: 0,
    remnant: null,
  };
}

function toPartForMatching(part: FixturePart): PartForMatching {
  return {
    id: part.id,
    name: part.name,
    material: 'Сталь',
    steelTypeId: null,
    steelTypeName: null,
    steelTypeRaw: null,
    quantity: 1,
    thickness: part.thickness ?? 0,
    width: part.width,
    height: part.height,
    bboxSizeX: part.boundingBox.sizeX,
    bboxSizeY: part.boundingBox.sizeY,
    bboxSizeZ: part.boundingBox.sizeZ,
    contour: part.contour,
    meshVolume: part.meshVolume,
    meshArea: part.meshArea,
    facesCount: part.facesCount,
    isSheetMetal: part.isSheetMetal,
    partType: part.partType,
    hasBends: part.hasBends,
  };
}

function assertNoMojibake(parts: ParsedPart[]): void {
  for (const part of parts) {
    assert.equal(/[ÃÂÐÑ�]/.test(part.name), false, `mojibake in part name: ${part.name}`);
  }
}

function assertAllContoursSimple(parts: ParsedPart[]): void {
  for (const part of parts) {
    assert.equal(validateSimpleUnfoldContour(part.contour), null, `${part.name} contour should be simple`);
  }
}

function expectedArea(part: ParsedPart): number {
  assert.ok(part.thickness && part.thickness > 0, `${part.name} should have positive thickness`);
  return part.meshVolume / part.thickness;
}

function mustFind(parts: FixturePart[], name: string): FixturePart {
  const part = parts.find((candidate) => candidate.name === name);
  assert.ok(part, `missing part ${name}`);
  return part;
}

function mustFindMatch(matches: MatchResult[], partId: string): MatchResult {
  const match = matches.find((candidate) => candidate.partId === partId);
  assert.ok(match, `missing match for part ${partId}`);
  return match;
}

function assertHasUndirectedSegmentAngle(
  contour: Point2D[],
  expectedDeg: number,
  toleranceDeg: number,
  minLength: number,
  label: string
): void {
  const points = openLoop(contour);
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const length = Math.hypot(dx, dy);
    if (length < minLength) continue;
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    const undirected = angle > 90 ? 180 - angle : angle;
    if (Math.abs(undirected - expectedDeg) <= toleranceDeg) {
      return;
    }
  }

  assert.fail(label);
}

function assertApprox(actual: number, expected: number, tolerance: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} should be within ${tolerance} of ${expected}`
  );
}

function translate(points: Point2D[], x: number, y: number): Point2D[] {
  return points.map((point) => ({ x: point.x + x, y: point.y + y }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
