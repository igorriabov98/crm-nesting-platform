import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testsDir = path.resolve(__dirname, '../src/lib/__tests__');
const realFixtureTests = new Set([
  'test-leda-step-parser.ts',
  'test-leda525-fixture.ts',
  'test-purchased-parts.ts',
]);
const mode = process.argv.includes('--real')
  ? 'real'
  : process.argv.includes('--all')
    ? 'all'
    : 'unit';
const tests = readdirSync(testsDir)
  .filter((file) => /^test-.*\.ts$/.test(file))
  .filter((file) => {
    if (mode === 'all') return true;
    const isRealFixtureTest = realFixtureTests.has(file);
    return mode === 'real' ? isRealFixtureTest : !isRealFixtureTest;
  })
  .sort();

if (tests.length === 0) {
  console.error(`[test:${mode}] no test files selected`);
  process.exit(1);
}

for (const test of tests) {
  const testPath = path.join(testsDir, test);
  console.log(`[test:${mode}] ${test}`);
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', testPath], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`[test:${mode}] ${tests.length} test files passed`);
