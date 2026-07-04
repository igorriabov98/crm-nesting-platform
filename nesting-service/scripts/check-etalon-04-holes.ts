import * as path from 'node:path';
import { parseStepFile } from '../src/lib/step-parser';
import type { Point2D } from '../src/lib/geometry';

type HoleMeasurement = {
  x: number;
  y: number;
  diameter: number;
};

const DEFAULT_FIXTURE_DIR = '/Users/igorrabov/Downloads/etalon-step-pdf-fixtures';
const FILE_NAME = '04_L_50x40_t2_r3_w100_2holes_D8.step';
const TOLERANCE_MM = 0.1;
const K_FACTOR = 0.4;
const THICKNESS = 2;
const INNER_RADIUS = 3;
const BEND_ALLOWANCE = Math.PI / 2 * (INNER_RADIUS + K_FACTOR * THICKNESS);
const EXPECTED_Y = 35 + BEND_ALLOWANCE + 25;
const EXPECTED: HoleMeasurement[] = [
  { x: 30, y: EXPECTED_Y, diameter: 8 },
  { x: 70, y: EXPECTED_Y, diameter: 8 },
];

async function main(): Promise<void> {
  const fixtureDir = path.resolve(process.argv[2] ?? DEFAULT_FIXTURE_DIR);
  const file = path.join(fixtureDir, FILE_NAME);
  const parsed = await parseStepFile(file, {
    resolveKFactor: () => ({ kFactor: K_FACTOR, defaulted: false }),
  });

  if (!parsed.success || parsed.parts.length !== 1) {
    throw new Error(`Expected one parsed part, got success=${parsed.success} parts=${parsed.parts.length}`);
  }

  const part = parsed.parts[0];
  if (part.contourSource !== 'UNFOLDED_BREP') {
    throw new Error(`Expected UNFOLDED_BREP, got ${part.contourSource}`);
  }

  const actual = part.holes
    .map((hole) => toPassportCoordinates(measureHole(hole), part.width, part.height))
    .sort((left, right) => left.x - right.x);

  if (actual.length !== EXPECTED.length) {
    throw new Error(`Expected ${EXPECTED.length} holes, got ${actual.length}`);
  }

  console.log(`04 holes check: source=${part.contourSource} size=${format(part.width)}x${format(part.height)} K=${K_FACTOR}`);
  console.log('| Hole | Metric | Expected | Actual | Delta | Verdict |');
  console.log('| --- | --- | ---: | ---: | ---: | --- |');

  let failed = false;
  for (let index = 0; index < EXPECTED.length; index += 1) {
    const expected = EXPECTED[index];
    const measured = actual[index];
    for (const metric of ['x', 'y', 'diameter'] as const) {
      const delta = measured[metric] - expected[metric];
      const ok = Math.abs(delta) <= TOLERANCE_MM;
      failed ||= !ok;
      console.log(
        `| ${index + 1} | ${metric} | ${format(expected[metric])} | ${format(measured[metric])} | ${format(delta)} | ${ok ? 'OK' : 'FAIL'} |`
      );
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

function measureHole(hole: Point2D[]): HoleMeasurement {
  const points = openLoop(hole);
  const x = average(points.map((point) => point.x));
  const y = average(points.map((point) => point.y));
  let diameter = 0;

  for (const a of points) {
    for (const b of points) {
      diameter = Math.max(diameter, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }

  return { x, y, diameter };
}

function toPassportCoordinates(measurement: HoleMeasurement, width: number, height: number): HoleMeasurement {
  if (width >= height) {
    return measurement;
  }

  return {
    x: measurement.y,
    y: measurement.x,
    diameter: measurement.diameter,
  };
}

function openLoop(points: Point2D[]): Point2D[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6 ? points.slice(0, -1) : points;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function format(value: number): string {
  return value.toFixed(3);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
