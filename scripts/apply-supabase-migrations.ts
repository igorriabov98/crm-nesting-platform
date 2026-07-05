import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const databaseUrl = requiredEnv('SUPABASE_DB_URL');
const ledgerTable = 'public._repo_supabase_migrations';

function main() {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[supabase:migrate] no SQL migrations found');
    return;
  }

  const ledgerExists = psqlAt(`SELECT to_regclass('${ledgerTable}') IS NOT NULL;`).trim() === 't';
  if (!ledgerExists) {
    throw new Error(
      [
        `${ledgerTable} does not exist.`,
        'Bootstrap it once in production before enabling automated Supabase SQL migrations:',
        `CREATE TABLE ${ledgerTable} (`,
        '  name text PRIMARY KEY,',
        '  checksum text NOT NULL,',
        '  applied_at timestamptz NOT NULL DEFAULT now()',
        ');',
        'Then backfill rows for already-applied historical migrations before running this workflow.',
      ].join('\n')
    );
  }

  const applied = new Set(
    psqlAt(`SELECT name FROM ${ledgerTable} ORDER BY name;`)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log(`[supabase:migrate] ${files.length} migrations tracked, pending 0`);
    return;
  }

  for (const file of pending) {
    const fullPath = path.join(migrationsDir, file);
    const checksum = sha256(readFileSync(fullPath, 'utf8'));
    runMigration(fullPath, file, checksum);
    console.log(`[supabase:migrate] applied ${file}`);
  }
}

function runMigration(filePath: string, fileName: string, checksum: string) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'supabase-migration-'));
  const wrapper = path.join(tmpDir, 'apply.sql');
  try {
    writeFileSync(
      wrapper,
      [
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        `\\i ${escapePsqlPath(filePath)}`,
        `INSERT INTO ${ledgerTable} (name, checksum) VALUES (${sqlLiteral(fileName)}, ${sqlLiteral(checksum)});`,
        'COMMIT;',
        '',
      ].join('\n'),
      'utf8'
    );
    psql(['-f', wrapper], true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function psqlAt(sql: string) {
  return psql(['-X', '-A', '-t', '-c', sql], false).stdout;
}

function psql(args: string[], inherit: boolean) {
  const result = spawnSync('psql', [databaseUrl, ...args], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `psql exited with ${result.status}`);
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function sha256(value: string) {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(value).digest('hex');
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapePsqlPath(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '');
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main();
