import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type CronAuthDb = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function requestSecret(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  return request.headers.get("x-cron-secret")?.trim() || bearer;
}

export async function authorizeMeetingCron(request: Request) {
  const provided = requestSecret(request);
  if (!provided) return false;

  const environmentSecrets = [
    process.env.MEETING_RULES_CRON_SECRET,
    process.env.MEETING_REMINDER_CRON_SECRET,
    process.env.CRON_SECRET,
  ]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (environmentSecrets.includes(provided)) return true;

  const database = createAdminClient() as unknown as CronAuthDb;
  const { data, error } = await database.rpc(
    "verify_meeting_system_v2_cron_secret",
    { p_secret: provided },
  );
  return !error && data === true;
}
