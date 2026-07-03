import * as fs from 'node:fs';
import * as path from 'node:path';
import { readBrepTopology } from '../src/lib/brep/brep-reader';

async function main(): Promise<void> {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npm run brep:dump -- <path-to-file.step>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(resolvedPath);
  const fileBytes = new Uint8Array(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength);
  const result = await readBrepTopology(fileBytes);

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
