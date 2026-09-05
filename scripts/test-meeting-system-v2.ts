import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260905150000_meeting_system_v2.sql"),
  "utf8",
);
const permissions = readFileSync(
  resolve(root, "src/lib/permissions/resources.ts"),
  "utf8",
);
const engine = readFileSync(
  resolve(root, "src/lib/meetings-v2/engine.ts"),
  "utf8",
);
const catalog = readFileSync(
  resolve(root, "src/lib/meetings-v2/catalog.ts"),
  "utf8",
);
const shadowReport = readFileSync(
  resolve(root, "supabase/reports/meeting_system_v2_shadow.sql"),
  "utf8",
);
const deployWorkflow = readFileSync(
  resolve(root, ".github/workflows/deploy.yml"),
  "utf8",
);

for (const table of [
  "meeting_templates",
  "meeting_schedule_versions",
  "meeting_schedule_exceptions",
  "meeting_question_templates",
  "meeting_rules",
  "meeting_rule_versions",
  "meeting_questions",
  "meeting_question_members",
  "meeting_question_outcomes",
  "meeting_question_task_links",
  "meeting_question_events",
  "meeting_rule_events",
  "meeting_rule_runs",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`),
  );
}

assert.match(
  migration,
  /idx_meeting_questions_active_episode[\s\S]+WHERE rule_id IS NOT NULL AND status IN/,
);
assert.match(migration, /FOR UPDATE SKIP LOCKED/);
assert.match(migration, /claim_meeting_rule_events_v2/);
assert.match(migration, /assign_meeting_question_v2/);
assert.match(migration, /start_meeting_v2/);
assert.match(migration, /complete_meeting_v2/);
assert.match(migration, /cancel_meeting_v2/);
assert.match(migration, /reschedule_meeting_v2/);
assert.match(migration, /set_meeting_system_v2_mode/);
assert.match(migration, /claim_meeting_reminder_delivery_v2/);
assert.match(migration, /record_meeting_question_outcome_v2/);
assert.match(migration, /meeting_question_meeting_history/);
assert.match(migration, /meeting-rules-reconcile-v2/);
assert.match(migration, /'\*\/15 \* \* \* \*'/);
assert.match(migration, /is_pinned boolean NOT NULL DEFAULT false/);
assert.match(migration, /priority_rank smallint GENERATED ALWAYS/);
assert.match(migration, /linked_task_status_changed/);
assert.match(migration, /meeting_postgres_timezone_v2/);
assert.match(migration, /row_number\(\) OVER \([\s\S]+PARTITION BY template\.id/);
assert.match(migration, /execution_mode text NOT NULL DEFAULT 'active'/);
assert.match(migration, /group_count integer NOT NULL DEFAULT 0/);
assert.match(migration, /PERFORM public\.enqueue_meeting_rule_reconciliation_v2\(\)/);

for (const resource of [
  "meeting_templates",
  "meeting_question_templates",
  "meeting_rules",
]) {
  assert.match(permissions, new RegExp(`\\| ["']${resource}["']`));
  assert.match(migration, new RegExp(`\\('${resource}'\\)`));
}

for (const requiredTemplate of [
  "Просроченные задачи",
  "Запрос долго не взят в работу",
  "Просроченная надобность производства",
  "Риск опоздания материала",
  "Фактическое опоздание материала",
]) {
  assert.match(migration, new RegExp(requiredTemplate));
}

for (const forbidden of ["salary", "phone", "email", "invoice_amount"]) {
  assert.equal(
    catalog.includes(`key: '${forbidden}'`),
    false,
    `${forbidden} must not be exposed in the rule catalogue`,
  );
}

assert.match(engine, /status === 'in_meeting'|status === "in_meeting"/);
assert.match(engine, /manual_assignment_locked/);
assert.match(engine, /condition_cleared/);
assert.match(engine, /source_changed_during_meeting/);
assert.match(engine, /sendTelegramMessage/);
assert.match(engine, /meeting_question_critical/);
assert.match(engine, /executionMode === "shadow"/);
assert.match(engine, /group_count: groups\.size/);
assert.match(shadowReport, /BEGIN TRANSACTION READ ONLY/);
assert.match(shadowReport, /futurePlannedMeetingsWithoutTemplate/);
assert.match(shadowReport, /duplicateActiveEpisodes/);
assert.match(shadowReport, /stalePendingEvents/);
assert.match(deployWorkflow, /meeting_system_v2_shadow\.sql/);
assert.match(deployWorkflow, /meeting-system-v2-shadow-\$\{\{ github\.sha \}\}/);

console.log("Meeting system v2 contracts: OK");
