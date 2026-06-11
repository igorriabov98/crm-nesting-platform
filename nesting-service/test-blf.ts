import { nestOnSheet } from './src/lib/nesting/blf';
import type { NestingParams, NestingPart } from './src/lib/nesting/types';

const parts: NestingPart[] = [
  {
    id: '1',
    name: 'A',
    width: 400,
    height: 300,
    contour: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
      { x: 0, y: 0 },
    ],
    holes: [],
    grainLock: false,
    area: 120000,
  },
  {
    id: '2',
    name: 'B',
    width: 200,
    height: 150,
    contour: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
      { x: 0, y: 0 },
    ],
    holes: [],
    grainLock: false,
    area: 30000,
  },
  {
    id: '3',
    name: 'C',
    width: 300,
    height: 200,
    contour: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
      { x: 0, y: 0 },
    ],
    holes: [],
    grainLock: false,
    area: 60000,
  },
  {
    id: '4',
    name: 'D',
    width: 150,
    height: 100,
    contour: [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ],
    holes: [],
    grainLock: false,
    area: 15000,
  },
];

const params: NestingParams = { strategy: 'minWaste', gap: 5, grainDirection: 'horizontal' };
const { placed, unplaced } = nestOnSheet(parts, 1000, 500, params);

console.log(`Placed: ${placed.length}/${parts.length}`);
console.log(`Unplaced: ${unplaced.length}`);

for (const placement of placed) {
  console.log(
    `  ${placement.name}: (${placement.x}, ${placement.y}) ${placement.placedW}x${placement.placedH} rot=${placement.rotation}`
  );

  if (placement.x < 0 || placement.y < 0) {
    throw new Error(`${placement.name}: negative coordinates`);
  }

  if (placement.x + placement.placedW > 1000) {
    throw new Error(`${placement.name}: exceeds sheet width`);
  }

  if (placement.y + placement.placedH > 500) {
    throw new Error(`${placement.name}: exceeds sheet height`);
  }
}

if (placed.length !== 4 || unplaced.length !== 0) {
  throw new Error('Expected all four parts to be placed');
}

for (let i = 0; i < placed.length; i += 1) {
  for (let j = i + 1; j < placed.length; j += 1) {
    const a = placed[i];
    const b = placed[j];
    const gap = params.gap;
    const overlap = !(
      a.x + a.placedW + gap <= b.x ||
      b.x + b.placedW + gap <= a.x ||
      a.y + a.placedH + gap <= b.y ||
      b.y + b.placedH + gap <= a.y
    );

    if (overlap) {
      throw new Error(`Collision: ${a.name} vs ${b.name}`);
    }
  }
}

const tallPart: NestingPart = {
  id: 'tall',
  name: 'Tall',
  width: 600,
  height: 200,
  contour: [
    { x: 0, y: 0 },
    { x: 600, y: 0 },
    { x: 600, y: 200 },
    { x: 0, y: 200 },
    { x: 0, y: 0 },
  ],
  holes: [],
  grainLock: true,
  area: 120000,
};

const locked = nestOnSheet([tallPart], 500, 1000, params);
console.log('GrainLock=true, 600 into 500: placed =', locked.placed.length);
if (locked.placed.length !== 0) {
  throw new Error('Expected grain locked part not to fit');
}

const unlocked = nestOnSheet([{ ...tallPart, grainLock: false }], 500, 1000, params);
console.log('GrainLock=false, 600 into 500: placed =', unlocked.placed.length);
if (unlocked.placed.length !== 1) {
  throw new Error('Expected unlocked part to fit after rotation');
}

console.log('BLF test done');
