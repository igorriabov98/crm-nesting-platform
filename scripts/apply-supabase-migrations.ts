import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  classifySupabaseMigrations,
  listSupabaseMigrationFiles,
  orderSupabaseMigrationFiles,
} from './supabase-migration-order.mjs';

const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const databaseUrl = requiredEnv('SUPABASE_DB_URL');
const ledgerTable = 'public._repo_supabase_migrations';

function main() {
  const files = orderSupabaseMigrationFiles(listSupabaseMigrationFiles(migrationsDir));

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

  const applied = psqlAt(`SELECT name || chr(9) || checksum FROM ${ledgerTable} ORDER BY name;`)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [file, checksum] = line.split('\t');
      if (!file || !checksum) throw new Error(`Invalid migration ledger row: ${line}`);
      return { file, checksum };
    });
  const localMigrations = files.map((file) => ({
    file,
    checksum: sha256(readFileSync(path.join(migrationsDir, file), 'utf8')),
  }));
  const { pending, renamed } = classifySupabaseMigrations(localMigrations, applied);

  for (const migration of renamed) {
    console.log(`[supabase:migrate] ${migration.file} already tracked under its previous name`);
  }

  if (pending.length === 0) {
    console.log(`[supabase:migrate] ${files.length} migrations tracked, pending 0`);
    return;
  }

  const organizationBatch = pending.filter(({ file }) => /^20260919(?:120000|121000|121500|122000|123000|124000|124500|125000|125500)_/.test(file));
  for (const migration of pending) {
    if (organizationBatch.includes(migration)) {
      if (migration !== organizationBatch[0]) continue;
      runMigrations(organizationBatch, true);
      for (const item of organizationBatch) console.log(`[supabase:migrate] applied ${item.file}`);
    } else {
      runMigrations([migration]);
      console.log(`[supabase:migrate] applied ${migration.file}`);
    }
  }
}

function runMigrations(migrations: {file: string; checksum: string}[], organizationCutover = false) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'supabase-migration-'));
  const wrapper = path.join(tmpDir, 'apply.sql');
  try {
    writeFileSync(
      wrapper,
      [
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        ...(organizationCutover ? [
          "SET LOCAL lock_timeout = '10s';",
          "SELECT pg_advisory_xact_lock(hashtextextended('crm:organization', 0));",
          'LOCK TABLE public.users, public.departments, public.positions, public.department_members, public.department_access_permissions IN SHARE ROW EXCLUSIVE MODE;',
        ] : []),
        ...migrations.flatMap(({file, checksum}) => [
          `\\i ${escapePsqlPath(path.join(migrationsDir, file))}`,
          `INSERT INTO ${ledgerTable} (name, checksum) VALUES (${sqlLiteral(file)}, ${sqlLiteral(checksum)});`,
        ]),
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
