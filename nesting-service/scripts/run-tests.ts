import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testsDir = path.resolve(__dirname, '../src/lib/__tests__');
const tests = readdirSync(testsDir)
  .filter((file) => /^test-.*\.ts$/.test(file))
  .sort();

for (const test of tests) {
  const testPath = path.join(testsDir, test);
  console.log(`[test:all] ${test}`);
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', testPath], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`[test:all] ${tests.length} test files passed`);
