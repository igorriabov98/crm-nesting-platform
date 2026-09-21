"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireAnyPermission,
  requirePermission,
} from "@/lib/permissions/server";
import { synchronizeUserAuth } from "@/lib/organization/auth-sync";
import { getPasswordResetRedirectUrl } from "@/lib/config";
import type {
  OrganizationAudit,
  OrganizationChange,
  OrganizationData,
  OffboardingPreview,
} from "@/lib/organization/types";

const uuid = z.string().uuid();
const version = z.string().regex(/^\d+$/);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Не удалось выполнить операцию";
async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const client =
    (await createServerSupabaseClient()) as unknown as SupabaseClient;
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
function refreshOrganization() {
  revalidatePath("/admin/organization");
  revalidatePath("/admin/settings/access");
  revalidatePath("/", "layout");
}
export async function getOrganizationData() {
  try {
    const context = await requireAnyPermission([
      { resourceKey: "admin_users", operation: "view" },
      { resourceKey: "departments", operation: "view" },
    ]);
    const snapshot = await rpc<OrganizationData>("crm_organization_snapshot");
    return {
      data: {
        ...snapshot,
        currentUserId: context.userId,
        isAdmin: context.permissionDetails.isAdminPosition,
        permissions: context.permissions,
      },
      error: null,
    };
  } catch (error) {
    return { data: null, error: errorText(error) };
  }
}
export async function applyOrganizationChange(input: OrganizationChange) {
  try {
    const parsed = z
      .object({
        kind: z.enum([
          "profile",
          "department",
          "position",
          "assignment",
          "remove_assignment",
          "consolidate_assignment",
          "head",
        ]),
        id: uuid.nullable(),
        data: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
        expectedVersion: version,
      })
      .parse(input);
    const result = await rpc<{ id: string; version: string }>(
      "crm_change_organization",
      {
        p_kind: parsed.kind,
        p_id: parsed.id,
        p_data: parsed.data,
        p_expected_version: parsed.expectedVersion,
      },
    );
    if (parsed.kind === "profile" && parsed.id && parsed.data.email) {
      try {
        await synchronizeUserAuth(parsed.id);
      } catch {
        /* Durable outbox retries. */
      }
    }
    refreshOrganization();
    return { success: true, data: result, error: null };
  } catch (error) {
    return { success: false, data: null, error: errorText(error) };
  }
}
export async function setOrganizationAdministrator(
  userId: string,
  enabled: boolean,
  expectedVersion: string,
) {
  try {
    await rpc("crm_set_administrator", {
      p_user_id: uuid.parse(userId),
      p_enabled: z.boolean().parse(enabled),
      p_expected_version: version.parse(expectedVersion),
    });
    refreshOrganization();
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: errorText(error) };
  }
}
export async function getOrganizationHistory(userId: string) {
  try {
    await requirePermission("admin_users", "view");
    const id = uuid.parse(userId);
    const db = createAdminClient() as unknown as SupabaseClient;
    const { data, error } = await db
      .from("organization_audit_log")
      .select("*")
      .or(
        `entity_id.eq.${id},before_data->>user_id.eq.${id},after_data->>user_id.eq.${id}`,
      )
      .order("id", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { data: data as OrganizationAudit[], error: null };
  } catch (error) {
    return { data: null, error: errorText(error) };
  }
}
export async function previewOffboarding(userId: string) {
  try {
    return {
      data: await rpc<OffboardingPreview>("crm_preview_offboarding", {
        p_user_id: uuid.parse(userId),
      }),
      error: null,
    };
  } catch (error) {
    return { data: null, error: errorText(error) };
  }
}
export async function handoffObligation(input: {
  operationId: string;
  userId: string;
  targetUserId: string;
  key: string;
  fingerprint: string;
  targetMembershipId: string | null;
}) {
  try {
    const parsed = z
      .object({
        operationId: uuid,
        userId: uuid,
        targetUserId: uuid,
        key: z.string().min(1),
        fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
        targetMembershipId: uuid.nullable(),
      })
      .parse(input);
    await rpc("crm_handoff_obligation", {
      p_operation_id: parsed.operationId,
      p_user_id: parsed.userId,
      p_target_user_id: parsed.targetUserId,
      p_key: parsed.key,
      p_fingerprint: parsed.fingerprint,
      p_target_membership_id: parsed.targetMembershipId,
    });
    refreshOrganization();
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: errorText(error) };
  }
}
export async function changeOrganizationUserStatus(
  userId: string,
  active: boolean,
  expectedVersion: string,
) {
  try {
    await rpc("crm_change_user_status", {
      p_user_id: uuid.parse(userId),
      p_active: z.boolean().parse(active),
      p_expected_version: version.parse(expectedVersion),
    });
    let authPending = true;
    try {
      authPending = (await synchronizeUserAuth(userId)).pending > 0;
    } catch {
      /* The persisted outbox is retried by the scheduled worker. */
    }
    refreshOrganization();
    return { success: true, authPending, error: null };
  } catch (error) {
    return { success: false, authPending: false, error: errorText(error) };
  }
}
export async function retryOrganizationAuthSync(userId: string) {
  try {
    await requirePermission("admin_users", "manage");
    const { pending } = await synchronizeUserAuth(uuid.parse(userId));
    refreshOrganization();
    return {
      success: pending === 0,
      error: pending ? "Синхронизация входа ожидает повторной попытки" : null,
    };
  } catch (error) {
    return { success: false, error: errorText(error) };
  }
}

export async function sendOrganizationPasswordReset(userId: string) {
  let requestId: string | null = null;
  try {
    const id = uuid.parse(userId);
    const prepared = await rpc<{ request_id: string; email: string }>(
      "crm_prepare_password_reset",
      { p_user_id: id },
    );
    requestId = uuid.parse(prepared.request_id);
    const email = z.string().email().parse(prepared.email);
    const admin = createAdminClient();
    const { data: authData, error: authLookupError } =
      await admin.auth.admin.getUserById(id);
    if (authLookupError || !authData.user)
      throw new Error(
        authLookupError?.message || "Аккаунт не найден в сервисе входа",
      );
    if (authData.user.email?.toLowerCase() !== email.toLowerCase())
      throw new Error(
        "Email профиля ещё не синхронизирован с сервисом входа",
      );
    const redirectTo = getPasswordResetRedirectUrl();
    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw new Error(error.message);
    const finish = await (admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    }).rpc("crm_finish_password_reset_request", {
      p_request_id: requestId,
      p_sent: true,
      p_error: null,
    });
    if (finish.error) throw new Error(finish.error.message);
    return { success: true, email, error: null };
  } catch (error) {
    if (requestId) {
      const admin = createAdminClient();
      await (admin as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      }).rpc("crm_finish_password_reset_request", {
        p_request_id: requestId,
        p_sent: false,
        p_error: errorText(error),
      });
    }
    return { success: false, email: null, error: errorText(error) };
  }
}
export async function createOrganizationUser(input: {
  email: string;
  password: string;
  full_name: string;
  department_id: string;
  position_id: string;
  factory_id: string | null;
  reports_to_membership_id: string | null;
  is_department_head: boolean;
  expectedVersion: string;
}) {
  let createdId: string | null = null;
  let profileCreated = false;
  try {
    await requirePermission("admin_users", "manage");
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(12),
        full_name: z.string().trim().min(2),
        department_id: uuid,
        position_id: uuid,
        factory_id: uuid.nullable(),
        reports_to_membership_id: uuid.nullable(),
        is_department_head: z.boolean(),
        expectedVersion: version,
      })
      .parse(input);
    const client = createAdminClient();
    const { data, error } = await client.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      ban_duration: "876600h",
    });
    if (error || !data.user)
      throw new Error(error?.message || "Не удалось создать аккаунт");
    createdId = data.user.id;
    const { password: secret, expectedVersion, ...profile } = parsed;
    void secret;
    await rpc("crm_change_organization", {
      p_kind: "user",
      p_id: createdId,
      p_data: profile,
      p_expected_version: expectedVersion,
    });
    profileCreated = true;
    let authPending = true;
    try {
      authPending = (await synchronizeUserAuth(createdId)).pending > 0;
    } catch {
      /* durable outbox */
    }
    refreshOrganization();
    return { success: true, id: createdId, authPending, error: null };
  } catch (error) {
    if (createdId && !profileCreated) {
      // A transport error can follow a committed RPC. Never delete its Auth identity.
      const admin = createAdminClient();
      const check = await admin
        .from("users")
        .select("id")
        .eq("id", createdId)
        .maybeSingle();
      if (!check.error && !check.data)
        await admin.auth.admin.deleteUser(createdId);
    }
    return {
      success: false,
      id: null,
      authPending: false,
      error: errorText(error),
    };
  }
}

export async function archiveOrganizationUser(
  userId: string,
  expectedVersion: string,
) {
  try {
    await rpc("crm_archive_user", {
      p_user_id: uuid.parse(userId),
      p_expected_version: version.parse(expectedVersion),
    });
    let authPending = true;
    try {
      authPending = (await synchronizeUserAuth(userId)).pending > 0;
    } catch {
      /* Durable outbox. */
    }
    refreshOrganization();
    return { success: true, authPending, error: null };
  } catch (error) {
    return { success: false, authPending: false, error: errorText(error) };
  }
}
