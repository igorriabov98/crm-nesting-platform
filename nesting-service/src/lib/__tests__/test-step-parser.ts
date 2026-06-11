import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseStepFile } from '../step-parser';

async function main(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log('Usage: npx tsx src/lib/__tests__/test-step-parser.ts <path.step>');
    console.log('Running smoke test with a minimal STEP file...\n');

    const minimalStep = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''), '2;1');
FILE_NAME('test', '2026-01-01', (''), (''), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;
    const tempPath = path.join(__dirname, 'test-minimal.step');

    fs.writeFileSync(tempPath, minimalStep);

    try {
      const result = await parseStepFile(tempPath);
      console.log('Minimal STEP result:');
      console.log('  success:', result.success);
      console.log('  totalMeshes:', result.totalMeshes);
      console.log('  parts:', result.parts.length);
      console.log('  errors:', result.errors);
      console.log('  parseTimeMs:', result.parseTimeMs);
      console.log('\nParser returned a structured result without crashing.');
    } finally {
      fs.rmSync(tempPath, { force: true });
    }

    return;
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Parsing: ${filePath}`);
  console.log(`File size: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB\n`);

  const result = await parseStepFile(filePath);

  console.log('=== RESULT ===');
  console.log(`Success: ${result.success}`);
  console.log(`Parse time: ${result.parseTimeMs}ms`);
  console.log(`Total meshes: ${result.totalMeshes}`);
  console.log(`Sheet metal parts: ${result.sheetMetalCount}`);
  console.log(`Warnings: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\nWarnings:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }

  console.log('\n=== PARTS ===');
  for (const part of result.parts) {
    const type = part.isSheetMetal ? 'SHEET' : 'NON-SHEET';
    console.log(`\n${type} "${part.name}"`);
    console.log(`  Thickness: ${part.thickness}mm`);
    console.log(`  Size: ${part.width} x ${part.height} mm`);
    console.log(`  Contour points: ${part.contour.length}`);
    console.log(`  Holes: ${part.holes.length}`);
    console.log(`  Confidence: ${(part.confidence * 100).toFixed(0)}%`);
    console.log(
      `  BBox: X[${part.boundingBox.minX.toFixed(1)}..${part.boundingBox.maxX.toFixed(1)}] ` +
        `Y[${part.boundingBox.minY.toFixed(1)}..${part.boundingBox.maxY.toFixed(1)}] ` +
        `Z[${part.boundingBox.minZ.toFixed(1)}..${part.boundingBox.maxZ.toFixed(1)}]`
    );

    if (part.thumbnailSvg) {
      const safeName = part.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'part';
      const svgPath = path.join(__dirname, `thumb_${safeName}.svg`);
      fs.writeFileSync(svgPath, part.thumbnailSvg);
      console.log(`  SVG: ${svgPath}`);
    }
  }

  console.log('\nParsing completed.');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
