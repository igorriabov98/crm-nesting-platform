import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { PassThrough } from 'node:stream';

export type DxfZipEntry = {
  fileName: string;
  content: string;
};

export async function buildDxfZipBuffer(files: DxfZipEntry[], warnings: string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(output);
    appendDxfZipEntries(archive, files, warnings);
    archive.finalize().catch(reject);
  });
}

export async function writeDxfZipFile(filePath: string, files: DxfZipEntry[], warnings: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    appendDxfZipEntries(archive, files, warnings);
    archive.finalize().catch(reject);
  });
}

export function createWarningsJson(warnings: string[]): string | null {
  if (warnings.length === 0) return null;
  return `${JSON.stringify({ warnings }, null, 2)}\n`;
}

function appendDxfZipEntries(archive: ReturnType<typeof archiver>, files: DxfZipEntry[], warnings: string[]): void {
  for (const file of files) {
    archive.append(file.content, { name: file.fileName });
  }

  const warningsJson = createWarningsJson(warnings);
  if (warningsJson) {
    archive.append(warningsJson, { name: 'warnings.json' });
  }
}
