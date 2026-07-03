import * as fs from 'node:fs';
import * as path from 'node:path';
import { readBrepSolids, type SolidInfo } from '../src/lib/brep/brep-reader';

async function main(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npm run brep:solids -- <path-to-file.step>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(resolvedPath);
  const fileBytes = new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
  const result = await readBrepSolids(fileBytes);
  const jsonPath = buildJsonPath(resolvedPath);

  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

  if (!result.ok) {
    console.error(`B-Rep solids read failed: ${result.error ?? 'unknown error'}`);
    console.error(`Full JSON: ${jsonPath}`);
    process.exit(1);
  }

  console.log(`solidCount=${result.solidCount}${result.isShellFallback ? ' isShellFallback=true' : ''}`);
  for (const solid of result.solids) {
    console.log(formatSolidLine(solid));
  }
  console.log(`fullJson=${jsonPath}`);
}

function buildJsonPath(filePath: string): string {
  const baseName = path.parse(filePath).name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'brep';
  return path.join('/tmp', `${baseName}-solids.json`);
}

function formatSolidLine(solid: SolidInfo): string {
  const size = solid.bbox.size;
  const radii = solid.thickness.byBendRadii.map(formatNumber).join(',');

  return (
    `[${solid.index}] ` +
    `vol=${formatNumber(solid.volume)} ` +
    `area=${formatNumber(solid.surfaceArea)} ` +
    `size=(${formatNumber(size.x)},${formatNumber(size.y)},${formatNumber(size.z)}) ` +
    `planes=${solid.planeCount} ` +
    `cyls=${solid.cylinderCount} ` +
    `tVolArea=${formatNumber(solid.thickness.byVolumeArea)} ` +
    `tBendRadii=[${radii}]`
  );
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(rounded.toFixed(3)).toString();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
