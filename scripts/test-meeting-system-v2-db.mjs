import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ??
    "postgresql://localhost/crm_full_schema_test",
);
assert.equal(databaseUrl.protocol, "postgresql:");
assert.ok(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
assert.ok(databaseName.toLowerCase().includes("test"));

const env = { ...process.env };
delete env.PGDATABASE;
env.PGHOST = databaseUrl.hostname;
env.PGPORT = databaseUrl.port || "5432";
env.PGSSLMODE = databaseUrl.searchParams.get("sslmode") || "disable";
if (databaseUrl.username) env.PGUSER = decodeURIComponent(databaseUrl.username);
if (databaseUrl.password)
  env.PGPASSWORD = decodeURIComponent(databaseUrl.password);

const sql = readFileSync(
  path.join(root, "supabase", "tests", "meeting_system_v2_test.sql"),
  "utf8",
);
const result = spawnSync(
  "psql",
  ["-X", "-v", "ON_ERROR_STOP=1", "-d", databaseName],
  {
    cwd: root,
    env,
    input: sql,
    encoding: "utf8",
  },
);
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("Meeting system v2 database contracts: OK");
