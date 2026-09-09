import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const pdfDirectory = path.resolve('src/lib/pdf')
const files = (await readdir(pdfDirectory))
  .filter((file) => file.endsWith('.tsx') && file !== 'PdfText.tsx' && !file.endsWith('.test.tsx'))

const uncovered = []
for (const file of files) {
  const source = await readFile(path.join(pdfDirectory, file), 'utf8')
  if (source.includes('<Text') && !source.includes("import { PdfText as Text } from './PdfText'")) {
    uncovered.push(file)
  }
}

assert.deepEqual(uncovered, [], `PDF components bypass PdfText: ${uncovered.join(', ')}`)
console.log(`PDF text guard covers ${files.length} components`)
