import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/** Persisted intent closes CRM access immediately; leases serialize Auth retries. */
export async function synchronizeUserAuth(userId?: string) {
  const client = createAdminClient();
  const db = client as unknown as SupabaseClient;
  const token = randomUUID();
  const { data, error } = await db.rpc("crm_claim_auth_sync", {
    p_token: token,
    p_user_id: userId || null,
  });
  if (error)
    throw new Error("Не удалось прочитать очередь синхронизации входа");
  for (const row of data || []) {
    let failure: string | null = null;
    try {
      const { error: authError } = await client.auth.admin.updateUserById(
        row.user_id,
        {
          ban_duration: row.desired_active ? "none" : "876600h",
          ...(row.desired_email
            ? { email: row.desired_email, email_confirm: true }
            : {}),
        },
      );
      if (authError) failure = "Сервис авторизации временно недоступен";
    } catch {
      failure = "Сервис авторизации временно недоступен";
    }
    const { error: saveError } = await db.rpc("crm_finish_auth_sync", {
      p_user_id: row.user_id,
      p_token: token,
      p_generation: row.generation,
      p_error: failure,
    });
    if (saveError)
      throw new Error("Синхронизация входа ожидает повторной попытки");
  }
  let pendingQuery = db
    .from("user_auth_sync")
    .select("user_id", { count: "exact", head: true })
    .is("synced_at", null);
  if (userId) pendingQuery = pendingQuery.eq("user_id", userId);
  const pending = await pendingQuery;
  if (pending.error)
    throw new Error("Не удалось проверить синхронизацию входа");
  return { pending: pending.count || 0 };
}
