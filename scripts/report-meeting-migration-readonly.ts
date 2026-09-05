import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};
type CountQuery = PromiseLike<CountResult> & {
  gte: (column: string, value: unknown) => CountQuery;
  lt: (column: string, value: unknown) => CountQuery;
  eq: (column: string, value: unknown) => CountQuery;
  in: (column: string, values: unknown[]) => CountQuery;
  is: (column: string, value: unknown) => CountQuery;
  not: (column: string, operator: string, value: unknown) => CountQuery;
};

async function exactCount(
  table: string,
  apply?: (query: CountQuery) => CountQuery,
) {
  let query = (db as SupabaseClient)
    .from(table)
    .select("id", { count: "exact", head: true }) as unknown as CountQuery;
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Uzhgorod",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

async function main() {
  const [
    types,
    recurrenceRules,
    futureMeetings,
    pastArchive,
    openAgenda,
    decisions,
    linkedTasks,
    pool,
  ] = await Promise.all([
    db.from("meeting_types").select("key, label, is_active").order("label"),
    db
      .from("meeting_recurrence_rules")
      .select(
        "id, meeting_type, is_active, start_date, end_date, occurrence_count, weekdays",
      )
      .order("created_at"),
    exactCount("meetings", (query) =>
      query.gte("meeting_date", today).eq("status", "planned"),
    ),
    exactCount("meetings", (query) =>
      query.lt("meeting_date", today).in("status", ["completed", "cancelled"]),
    ),
    exactCount("meeting_agenda_items", (query) =>
      query.is("resolved_at", null),
    ),
    exactCount("meeting_decisions"),
    exactCount("meeting_action_items", (query) =>
      query.not("related_task_id", "is", null),
    ),
    db.from("meeting_agenda_pool_items").select("status"),
  ]);

  for (const result of [types, recurrenceRules, pool]) {
    if (result.error) throw new Error(result.error.message);
  }

  const poolByStatus = Object.fromEntries(
    [...new Set((pool.data || []).map((item) => item.status))].map((status) => [
      status,
      (pool.data || []).filter((item) => item.status === status).length,
    ]),
  );

  console.log(
    JSON.stringify(
      {
        report: "meeting-system-v2-pre-migration",
        mode: "read-only",
        snapshotAt: new Date().toISOString(),
        timezone: "Europe/Uzhgorod",
        meetingTypes: types.data || [],
        recurrenceSeries: recurrenceRules.data || [],
        counts: {
          futurePlannedMeetings: futureMeetings,
          immutablePastMeetings: pastArchive,
          unresolvedLegacyAgendaItems: openAgenda,
          legacyDecisions: decisions,
          linkedGeneralTasks: linkedTasks,
          legacyPoolByStatus: poolByStatus,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
