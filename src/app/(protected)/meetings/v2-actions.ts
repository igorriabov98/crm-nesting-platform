"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  requireAnyPermission,
  requirePermission,
} from "@/lib/permissions/server";
import type { ResourceKey } from "@/lib/permissions/resources";
import { ROUTES } from "@/lib/constants/routes";
import {
  MEETING_SOURCE_BY_KEY,
  MEETING_SOURCE_CATALOG,
} from "@/lib/meetings-v2/catalog";
import {
  previewMeetingRule,
  processPendingMeetingRuleEvents,
} from "@/lib/meetings-v2/engine";
import { validateMeetingRuleDsl } from "@/lib/meetings-v2/dsl";
import { buildMeetingOccurrenceDates } from "@/lib/meetings-v2/schedule";
import type {
  MeetingQuestionStatus,
  MeetingRuleDraft,
} from "@/lib/meetings-v2/types";

type DbError = { code?: string; message?: string } | null;
type DbResult = { data: unknown; error: DbError; count?: number | null };
type Query = PromiseLike<DbResult> & {
  select: (columns?: string, options?: Record<string, unknown>) => Query;
  insert: (
    values: Record<string, unknown> | Record<string, unknown>[],
  ) => Query;
  update: (values: Record<string, unknown>) => Query;
  upsert: (
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: Record<string, unknown>,
  ) => Query;
  delete: () => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, values: unknown[]) => Query;
  is: (column: string, value: unknown) => Query;
  gte: (column: string, value: unknown) => Query;
  lte: (column: string, value: unknown) => Query;
  ilike: (column: string, pattern: string) => Query;
  order: (column: string, options?: Record<string, unknown>) => Query;
  range: (from: number, to: number) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<DbResult>;
  single: () => Promise<DbResult>;
};
type Db = {
  from: (table: string) => Query;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<DbResult>;
};

function adminDb() {
  return createAdminClient() as unknown as Db;
}

function dataRows(result: DbResult, label: string) {
  if (result.error)
    throw new Error(
      `${label}: ${result.error.message || "ошибка базы данных"}`,
    );
  return Array.isArray(result.data)
    ? (result.data as Record<string, unknown>[])
    : [];
}

function dataOne(result: DbResult, label: string) {
  if (result.error || !result.data)
    throw new Error(
      `${label}: ${result.error?.message || "запись не найдена"}`,
    );
  return result.data as Record<string, unknown>;
}

function invalidateMeetings() {
  revalidatePath(ROUTES.MEETINGS);
  revalidatePath(ROUTES.MEETINGS_AGENDA_POOL);
  revalidatePath(ROUTES.ADMIN_MEETINGS_SETTINGS);
}

const uuidSchema = z.string().uuid();
const prioritySchema = z.enum(["low", "normal", "high", "critical"]);

export async function getMeetingDashboardV2(
  input: { page?: number; pageSize?: number; from?: string; to?: string } = {},
) {
  await requirePermission("meetings", "view");
  const db = adminDb();
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(
    100,
    Math.max(10, Math.floor(input.pageSize || 25)),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let listQuery = db.from("meetings").select(
    `
    id, title, meeting_date, meeting_time, starts_at, ends_at, status, started_at,
    completed_at, legacy_read_only, template_id,
    template:meeting_templates(id, name, color),
    questions:meeting_questions(id, status, priority)
  `,
    { count: "exact" },
  );
  if (input.from) listQuery = listQuery.gte("meeting_date", input.from);
  if (input.to) listQuery = listQuery.lte("meeting_date", input.to);
  const now = new Date().toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [
    listResult,
    upcomingResult,
    monthResult,
    openResult,
    unassignedResult,
    controlResult,
    templatesResult,
  ] = await Promise.all([
    listQuery.order("starts_at", { ascending: false }).range(from, to),
    db
      .from("meetings")
      .select(
        "id, title, meeting_date, meeting_time, starts_at, ends_at, status, template:meeting_templates(id, name, color), questions:meeting_questions(id, priority, status)",
      )
      .eq("status", "planned")
      .gte("starts_at", now)
      .order("starts_at", { ascending: true })
      .limit(5),
    db
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .gte("meeting_date", monthStart.toISOString().slice(0, 10)),
    db
      .from("meeting_questions")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "new",
        "assigned",
        "in_meeting",
        "on_control",
        "deferred",
      ]),
    db
      .from("meeting_questions")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "deferred"])
      .is("assigned_meeting_id", null),
    db
      .from("meeting_questions")
      .select("id", { count: "exact", head: true })
      .eq("status", "on_control"),
    db
      .from("meeting_templates")
      .select("*")
      .eq("is_active", true)
      .order("name"),
  ]);
  return {
    upcoming: dataRows(
      upcomingResult,
      "Не удалось загрузить ближайшие совещания",
    ),
    list: dataRows(listResult, "Не удалось загрузить совещания"),
    total: listResult.count || 0,
    page,
    pageSize,
    metrics: {
      meetingsThisMonth: monthResult.count || 0,
      openQuestions: openResult.count || 0,
      unassignedQuestions: unassignedResult.count || 0,
      controlledQuestions: controlResult.count || 0,
    },
    templates: dataRows(templatesResult, "Не удалось загрузить шаблоны"),
  };
}

export async function getAgendaPoolV2(
  input: {
    status?: MeetingQuestionStatus | "closed";
    priority?: string;
    factoryId?: string;
    responsibleUserId?: string;
    ruleId?: string;
    query?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  await requirePermission("meetings_agenda_pool", "view");
  const db = adminDb();
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(
    100,
    Math.max(10, Math.floor(input.pageSize || 50)),
  );
  let query = db.from("meeting_questions").select(
    `
    *,
    factory:factories(id, name), responsible:users(id, full_name), rule:meeting_rules(id, name),
    meeting:meetings(id, title, meeting_date, meeting_time, status, starts_at, template:meeting_templates(id, name)),
    members:meeting_question_members(id, source_key, source_type, source_id, title, source_url, condition_active, snapshot, opened_at, cleared_at)
  `,
    { count: "exact" },
  );
  if (input.status === "closed")
    query = query.in("status", ["resolved", "auto_closed", "dismissed"]);
  else if (input.status) query = query.eq("status", input.status);
  else
    query = query.in("status", [
      "new",
      "assigned",
      "in_meeting",
      "on_control",
      "deferred",
    ]);
  if (input.priority) query = query.eq("priority", input.priority);
  if (input.factoryId) query = query.eq("factory_id", input.factoryId);
  if (input.responsibleUserId)
    query = query.eq("responsible_user_id", input.responsibleUserId);
  if (input.ruleId) query = query.eq("rule_id", input.ruleId);
  if (input.query?.trim())
    query = query.ilike("title", `%${input.query.trim().slice(0, 120)}%`);
  const result = await query
    .order("is_pinned", { ascending: false })
    .order("priority_rank", { ascending: false })
    .order("deadline", { ascending: true, nullsFirst: false })
    .order("opened_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  const [meetingsResult, filtersResult, rulesResult, usersResult] =
    await Promise.all([
      db
        .from("meetings")
        .select(
          "id, title, meeting_date, meeting_time, starts_at, template:meeting_templates(id, name)",
        )
        .eq("status", "planned")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(200),
      db.from("factories").select("id, name").order("name"),
      db.from("meeting_rules").select("id, name").order("name"),
      db
        .from("users")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
    ]);
  return {
    questions: dataRows(result, "Не удалось загрузить пул повесток"),
    total: result.count || 0,
    page,
    pageSize,
    meetings: dataRows(meetingsResult, "Не удалось загрузить совещания"),
    factories: dataRows(filtersResult, "Не удалось загрузить заводы"),
    rules: dataRows(rulesResult, "Не удалось загрузить правила"),
    users: dataRows(usersResult, "Не удалось загрузить сотрудников"),
  };
}

export async function getMeetingDetailV2(meetingId: string) {
  await requirePermission("meetings", "view");
  uuidSchema.parse(meetingId);
  const db = adminDb();
  const meetingResult = await db
    .from("meetings")
    .select(
      `
    *, template:meeting_templates(*), schedule_version:meeting_schedule_versions(*),
    facilitator:users!meetings_facilitator_user_id_fkey(id, full_name),
    attendees:meeting_attendees(id, user_id, is_confirmed, attended, user:users(id, full_name)),
    external_attendees:meeting_external_attendees(*)
  `,
    )
    .eq("id", meetingId)
    .maybeSingle();
  const meeting = dataOne(meetingResult, "Совещание не найдено");
  const historyResult = await db
    .from("meeting_question_meeting_history")
    .select("question_id, agenda_snapshot, entered_at, left_at")
    .eq("meeting_id", meetingId);
  const history = dataRows(
    historyResult,
    "Не удалось загрузить снимок повестки",
  );
  const questionIds = history.map((item) => String(item.question_id));
  const currentResult = await db
    .from("meeting_questions")
    .select("id")
    .eq("assigned_meeting_id", meetingId);
  const allQuestionIds = [
    ...new Set([
      ...questionIds,
      ...dataRows(currentResult, "Не удалось загрузить текущую повестку").map(
        (item) => String(item.id),
      ),
    ]),
  ];
  const [
    questionsResult,
    legacyAgenda,
    legacyDecisions,
    legacyActions,
    usersResult,
  ] = await Promise.all([
    allQuestionIds.length
      ? db
          .from("meeting_questions")
          .select(
            `
      *, question_template:meeting_question_templates(allowed_outcomes, expected_outcome, task_sla_days, default_responsible_user_id),
      members:meeting_question_members(*), outcomes:meeting_question_outcomes(*, responsible:users(id, full_name)),
      task_links:meeting_question_task_links(*, task:tasks(id, title, status, deadline, assigned_to)),
      events:meeting_question_events(*)
    `,
          )
          .in("id", allQuestionIds)
          .order("is_pinned", { ascending: false })
          .order("priority_rank", { ascending: false })
          .order("deadline", { ascending: true, nullsFirst: false })
          .order("opened_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    meeting.legacy_read_only
      ? db
          .from("meeting_agenda_items")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("sort_order")
      : Promise.resolve({ data: [], error: null }),
    meeting.legacy_read_only
      ? db.from("meeting_decisions").select("*").eq("meeting_id", meetingId)
      : Promise.resolve({ data: [], error: null }),
    meeting.legacy_read_only
      ? db.from("meeting_action_items").select("*").eq("meeting_id", meetingId)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("users")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name"),
  ]);
  return {
    meeting,
    questions: dataRows(questionsResult, "Не удалось загрузить вопросы"),
    history,
    legacy: {
      agenda: dataRows(legacyAgenda, "Не удалось загрузить архивную повестку"),
      decisions: dataRows(
        legacyDecisions,
        "Не удалось загрузить архивные решения",
      ),
      actions: dataRows(legacyActions, "Не удалось загрузить архивные задачи"),
    },
    users: dataRows(usersResult, "Не удалось загрузить сотрудников"),
    today: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Uzhgorod",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  };
}

export async function getMeetingSettingsV2() {
  await requirePermission("meeting_templates", "view");
  const [canViewQuestions, canViewRules] = await Promise.all([
    requirePermission("meeting_question_templates", "view")
      .then(() => true)
      .catch(() => false),
    requirePermission("meeting_rules", "view")
      .then(() => true)
      .catch(() => false),
  ]);
  const db = adminDb();
  const [
    templates,
    questionTemplates,
    rules,
    users,
    departments,
    factories,
    runs,
    rolloutMode,
    legacyPool,
    openQuestions,
    pendingEvents,
    missingFutureTemplates,
    rolloutEvents,
  ] = await Promise.all([
    db
      .from("meeting_templates")
      .select(
        "*, participants:meeting_template_participants(*), schedule_versions:meeting_schedule_versions(*), fixed_questions:meeting_template_questions(question_template_id, sort_order)",
      )
      .order("name"),
    canViewQuestions
      ? db.from("meeting_question_templates").select("*").order("name")
      : Promise.resolve({ data: [], error: null }),
    canViewRules
      ? db
          .from("meeting_rules")
          .select(
            "*, question_template:meeting_question_templates(*), current_version:meeting_rule_versions!meeting_rules_current_version_id_fkey(*)",
          )
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    db
      .from("users")
      .select("id, full_name, role")
      .eq("is_active", true)
      .order("full_name"),
    db.from("departments").select("id, name").order("name"),
    db.from("factories").select("id, name").order("name"),
    canViewRules
      ? db
          .from("meeting_rule_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("app_settings")
      .select("value")
      .eq("key", "meeting_system_v2_mode")
      .maybeSingle(),
    db
      .from("meeting_agenda_pool_items")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "assigned"]),
    db
      .from("meeting_questions")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "new",
        "assigned",
        "in_meeting",
        "on_control",
        "deferred",
      ]),
    canViewRules
      ? db
          .from("meeting_rule_events")
          .select("id", { count: "exact", head: true })
          .is("processed_at", null)
      : Promise.resolve({ data: [], error: null, count: 0 }),
    db
      .from("meetings")
      .select("id", { count: "exact", head: true })
      .eq("status", "planned")
      .gte("meeting_date", new Date().toISOString().slice(0, 10))
      .is("template_id", null),
    canViewRules
      ? db
          .from("meeting_system_rollout_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (rolloutMode.error)
    throw new Error(
      rolloutMode.error.message || "Не удалось определить режим запуска",
    );
  const modeRecord = rolloutMode.data as Record<string, unknown> | null;
  return {
    templates: dataRows(templates, "Не удалось загрузить шаблоны совещаний"),
    questionTemplates: dataRows(
      questionTemplates,
      "Не удалось загрузить шаблоны вопросов",
    ),
    rules: dataRows(rules, "Не удалось загрузить правила"),
    users: dataRows(users, "Не удалось загрузить сотрудников"),
    departments: dataRows(departments, "Не удалось загрузить отделы"),
    factories: dataRows(factories, "Не удалось загрузить заводы"),
    runs: dataRows(runs, "Не удалось загрузить журнал правил"),
    rolloutMode:
      modeRecord?.value === "active"
        ? ("active" as const)
        : ("shadow" as const),
    rolloutComparison: {
      legacyPoolOpen: legacyPool.count || 0,
      openQuestions: openQuestions.count || 0,
      pendingEvents: pendingEvents.count || 0,
      missingFutureTemplates: missingFutureTemplates.count || 0,
    },
    rolloutEvents: dataRows(
      rolloutEvents,
      "Не удалось загрузить журнал переключений",
    ),
    sources: canViewRules ? MEETING_SOURCE_CATALOG : [],
  };
}

const participantSchema = z
  .object({
    participantType: z.enum(["user", "role", "department", "external"]),
    userId: z.string().uuid().nullable().optional(),
    role: z.string().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    externalName: z.string().max(160).nullable().optional(),
    externalRole: z.string().max(160).nullable().optional(),
    externalEmail: z.string().email().nullable().optional(),
    externalPhone: z.string().max(60).nullable().optional(),
    isRequired: z.boolean().default(true),
  })
  .superRefine((participant, context) => {
    const missing =
      (participant.participantType === "user" && !participant.userId) ||
      (participant.participantType === "role" && !participant.role) ||
      (participant.participantType === "department" &&
        !participant.departmentId) ||
      (participant.participantType === "external" &&
        !participant.externalName?.trim());
    if (missing)
      context.addIssue({
        code: "custom",
        message: "Заполните участника выбранного типа",
      });
  });

const meetingTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  scopeType: z.enum(["all", "factory", "department", "custom"]).default("all"),
  scopeId: z.string().uuid().nullable().optional(),
  facilitatorUserId: z.string().uuid().nullable().optional(),
  defaultDurationMinutes: z.number().int().min(15).max(480),
  acceptedCategories: z
    .array(z.string().trim().min(1).max(80))
    .max(50)
    .default([]),
  reminderOffsetsMinutes: z
    .array(z.number().int().min(1).max(10080))
    .max(10)
    .default([1440, 30]),
  notificationChannels: z
    .array(z.enum(["crm", "telegram"]))
    .min(1)
    .default(["crm", "telegram"]),
  fallbackTemplateId: z.string().uuid().nullable().optional(),
  participants: z.array(participantSchema).max(100).default([]),
  fixedQuestionTemplateIds: z.array(z.string().uuid()).max(100).default([]),
});

export async function saveMeetingTemplateV2(
  input: z.input<typeof meetingTemplateSchema>,
) {
  const { user } = await requirePermission("meeting_templates", "manage");
  const parsed = meetingTemplateSchema.parse(input);
  const db = adminDb();
  const values = {
    name: parsed.name,
    description: parsed.description || null,
    scope_type: parsed.scopeType,
    scope_id: parsed.scopeId || null,
    facilitator_user_id: parsed.facilitatorUserId || null,
    default_duration_minutes: parsed.defaultDurationMinutes,
    accepted_categories: parsed.acceptedCategories,
    reminder_offsets_minutes: parsed.reminderOffsetsMinutes,
    notification_channels: parsed.notificationChannels,
    fallback_template_id: parsed.fallbackTemplateId || null,
    created_by: user.id,
  };
  const result = parsed.id
    ? await db
        .from("meeting_templates")
        .update(values)
        .eq("id", parsed.id)
        .select("id")
        .single()
    : await db.from("meeting_templates").insert(values).select("id").single();
  const templateId = String(dataOne(result, "Не удалось сохранить шаблон").id);
  await db
    .from("meeting_template_participants")
    .delete()
    .eq("template_id", templateId);
  if (parsed.participants.length > 0) {
    const participants = parsed.participants.map((item) => ({
      template_id: templateId,
      participant_type: item.participantType,
      user_id: item.userId || null,
      role: item.role || null,
      department_id: item.departmentId || null,
      external_name: item.externalName || null,
      external_role: item.externalRole || null,
      external_email: item.externalEmail || null,
      external_phone: item.externalPhone || null,
      is_required: item.isRequired,
    }));
    const insert = await db
      .from("meeting_template_participants")
      .insert(participants);
    if (insert.error)
      throw new Error(
        insert.error.message || "Не удалось сохранить участников",
      );
  }
  const clearFixed = await db
    .from("meeting_template_questions")
    .delete()
    .eq("template_id", templateId);
  if (clearFixed.error)
    throw new Error(
      clearFixed.error.message || "Не удалось обновить постоянные вопросы",
    );
  if (parsed.fixedQuestionTemplateIds.length > 0) {
    const fixedResult = await db.from("meeting_template_questions").insert(
      parsed.fixedQuestionTemplateIds.map((questionTemplateId, index) => ({
        template_id: templateId,
        question_template_id: questionTemplateId,
        sort_order: index,
      })),
    );
    if (fixedResult.error)
      throw new Error(
        fixedResult.error.message || "Не удалось сохранить постоянные вопросы",
      );
  }
  invalidateMeetings();
  return { id: templateId };
}

const scheduleSchema = z
  .object({
    templateId: z.string().uuid(),
    recurrenceKind: z.enum(["one_time", "weekly", "monthly", "interval"]),
    startDate: z.iso.date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.literal("Europe/Uzhgorod").default("Europe/Uzhgorod"),
    durationMinutes: z.number().int().min(15).max(480),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    monthDay: z.number().int().min(1).max(31).nullable().optional(),
    intervalDays: z.number().int().min(1).max(365).nullable().optional(),
    endDate: z.iso.date().nullable().optional(),
    occurrenceCount: z.number().int().min(1).max(520).nullable().optional(),
  })
  .superRefine((schedule, context) => {
    if (schedule.recurrenceKind === "weekly" && schedule.weekdays.length === 0)
      context.addIssue({ code: "custom", message: "Выберите день недели" });
    if (schedule.recurrenceKind === "monthly" && !schedule.monthDay)
      context.addIssue({ code: "custom", message: "Укажите день месяца" });
    if (schedule.recurrenceKind === "interval" && !schedule.intervalDays)
      context.addIssue({ code: "custom", message: "Укажите интервал" });
    if (schedule.endDate && schedule.occurrenceCount)
      context.addIssue({
        code: "custom",
        message: "Выберите дату окончания или количество повторений",
      });
  });

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>(
      (acc, part) => ({ ...acc, [part.type]: part.value }),
      {},
    );
  const represented = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return new Date(guess - (represented - guess));
}

function previousIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function saveMeetingScheduleV2(
  input: z.input<typeof scheduleSchema>,
) {
  const { user } = await requireAnyPermission([
    { resourceKey: "meeting_templates", operation: "manage" },
    { resourceKey: "meetings", operation: "manage" },
  ]);
  const parsed = scheduleSchema.parse(input);
  const db = adminDb();
  const templateResult = await db
    .from("meeting_templates")
    .select("*, participants:meeting_template_participants(*)")
    .eq("id", parsed.templateId)
    .maybeSingle();
  const template = dataOne(templateResult, "Шаблон совещания не найден");
  const versionRows = dataRows(
    await db
      .from("meeting_schedule_versions")
      .select("version_no, effective_from, is_active")
      .eq("template_id", parsed.templateId)
      .order("version_no", { ascending: false })
      .limit(1),
    "Не удалось определить версию расписания",
  );
  const versionNo = Number(versionRows[0]?.version_no || 0) + 1;
  const activeVersion = versionRows.find((row) => row.is_active === true);
  const effectiveTo =
    activeVersion &&
    String(activeVersion.effective_from || "") < parsed.startDate
      ? previousIsoDate(parsed.startDate)
      : parsed.startDate;
  await db
    .from("meeting_schedule_versions")
    .update({ is_active: false, effective_to: effectiveTo })
    .eq("template_id", parsed.templateId)
    .eq("is_active", true);
  const versionResult = await db
    .from("meeting_schedule_versions")
    .insert({
      template_id: parsed.templateId,
      version_no: versionNo,
      recurrence_kind: parsed.recurrenceKind,
      start_date: parsed.startDate,
      start_time: parsed.startTime,
      timezone: parsed.timezone,
      duration_minutes: parsed.durationMinutes,
      weekdays: parsed.weekdays,
      month_day: parsed.monthDay || null,
      interval_days: parsed.intervalDays || null,
      end_date: parsed.endDate || null,
      occurrence_count: parsed.occurrenceCount || null,
      effective_from: parsed.startDate,
      created_by: user.id,
    })
    .select("id")
    .single();
  const versionId = String(
    dataOne(versionResult, "Не удалось сохранить расписание").id,
  );
  const dates = buildMeetingOccurrenceDates(
    {
      recurrenceKind: parsed.recurrenceKind,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      occurrenceCount: parsed.occurrenceCount,
      weekdays: parsed.weekdays,
      monthDay: parsed.monthDay,
      intervalDays: parsed.intervalDays,
    },
    90,
  );
  const meetings = dates.map((date) => {
    const startsAt = zonedDateTimeToUtc(
      date,
      parsed.startTime,
      parsed.timezone,
    );
    const endsAt = new Date(
      startsAt.getTime() + parsed.durationMinutes * 60_000,
    );
    return {
      meeting_type: template.legacy_type_key || null,
      title: template.name,
      meeting_date: date,
      meeting_time: parsed.startTime,
      status: "planned",
      created_by: user.id,
      duration_minutes: parsed.durationMinutes,
      template_id: parsed.templateId,
      schedule_version_id: versionId,
      facilitator_user_id: template.facilitator_user_id || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      occurrence_key: `${versionId}:${date}:${parsed.startTime}`,
    };
  });
  const meetingsResult = meetings.length
    ? await db
        .from("meetings")
        .upsert(meetings, { onConflict: "occurrence_key" })
        .select("id, occurrence_key")
    : { data: [], error: null };
  const createdMeetings = dataRows(
    meetingsResult,
    "Не удалось создать встречи серии",
  );
  const participants = Array.isArray(template.participants)
    ? (template.participants as Record<string, unknown>[])
    : [];
  const directUserIds = participants
    .filter((item) => item.participant_type === "user")
    .map((item) => String(item.user_id))
    .filter(Boolean);
  const departmentIds = participants
    .filter((item) => item.participant_type === "department")
    .map((item) => String(item.department_id))
    .filter(Boolean);
  const roles = participants
    .filter((item) => item.participant_type === "role")
    .map((item) => String(item.role))
    .filter(Boolean);
  const [departmentMembers, roleUsers] = await Promise.all([
    departmentIds.length
      ? db
          .from("department_members")
          .select("user_id")
          .in("department_id", departmentIds)
      : Promise.resolve({ data: [], error: null }),
    roles.length
      ? db.from("users").select("id").in("role", roles).eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const userIds = [
    ...new Set([
      ...directUserIds,
      ...dataRows(
        departmentMembers,
        "Не удалось раскрыть участников отдела",
      ).map((item) => String(item.user_id)),
      ...dataRows(roleUsers, "Не удалось раскрыть участников роли").map(
        (item) => String(item.id),
      ),
    ]),
  ];
  if (userIds.length && createdMeetings.length) {
    await db.from("meeting_attendees").upsert(
      createdMeetings.flatMap((meeting) =>
        userIds.map((userId) => ({ meeting_id: meeting.id, user_id: userId })),
      ),
      { onConflict: "meeting_id,user_id" },
    );
  }
  const external = participants.filter(
    (item) => item.participant_type === "external",
  );
  if (external.length && createdMeetings.length) {
    await db.from("meeting_external_attendees").insert(
      createdMeetings.flatMap((meeting) =>
        external.map((item) => ({
          meeting_id: meeting.id,
          full_name: item.external_name,
          role_description: item.external_role,
          email: item.external_email,
          phone: item.external_phone,
        })),
      ),
    );
  }
  const fixedTemplates = dataRows(
    await db
      .from("meeting_template_questions")
      .select("question_template:meeting_question_templates(*)")
      .eq("template_id", parsed.templateId),
    "Не удалось загрузить постоянные вопросы",
  );
  const fixedQuestions = createdMeetings.flatMap((meeting) =>
    fixedTemplates.map((link) => {
      const questionTemplate = Array.isArray(link.question_template)
        ? link.question_template[0]
        : link.question_template;
      const item = questionTemplate as Record<string, unknown>;
      return {
        question_template_id: item.id,
        assigned_meeting_id: meeting.id,
        episode_key: `fixed:${item.id}:${meeting.id}`,
        source_type: "fixed",
        title: item.title_template,
        description: item.description_template,
        category: item.category,
        priority: item.priority,
        status: "assigned",
        condition_active: true,
        created_by: user.id,
      };
    }),
  );
  if (fixedQuestions.length)
    await db.from("meeting_questions").insert(fixedQuestions);
  invalidateMeetings();
  return { versionId, occurrences: createdMeetings.length };
}

const questionTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(160),
  titleTemplate: z.string().trim().min(2).max(300),
  descriptionTemplate: z.string().trim().max(2000).nullable().optional(),
  category: z.string().trim().min(1).max(80),
  priority: prioritySchema,
  expectedOutcome: z.string().trim().max(1000).nullable().optional(),
  allowedOutcomes: z
    .array(z.enum(["decision", "task", "defer", "dismiss", "source_update"]))
    .min(1),
  defaultResponsibleUserId: z.string().uuid().nullable().optional(),
  taskSlaDays: z.number().int().min(0).max(365).nullable().optional(),
  sourceUrlTemplate: z.string().max(500).nullable().optional(),
  fixedForEveryOccurrence: z.boolean().default(false),
});

export async function saveMeetingQuestionTemplateV2(
  input: z.input<typeof questionTemplateSchema>,
) {
  const { user } = await requirePermission(
    "meeting_question_templates",
    "manage",
  );
  const parsed = questionTemplateSchema.parse(input);
  const values = {
    name: parsed.name,
    title_template: parsed.titleTemplate,
    description_template: parsed.descriptionTemplate || null,
    category: parsed.category,
    priority: parsed.priority,
    expected_outcome: parsed.expectedOutcome || null,
    allowed_outcomes: parsed.allowedOutcomes,
    default_responsible_user_id: parsed.defaultResponsibleUserId || null,
    task_sla_days: parsed.taskSlaDays ?? null,
    source_url_template: parsed.sourceUrlTemplate || null,
    fixed_for_every_occurrence: parsed.fixedForEveryOccurrence,
    created_by: user.id,
  };
  const db = adminDb();
  const result = parsed.id
    ? await db
        .from("meeting_question_templates")
        .update(values)
        .eq("id", parsed.id)
        .select("id")
        .single()
    : await db
        .from("meeting_question_templates")
        .insert(values)
        .select("id")
        .single();
  invalidateMeetings();
  return {
    id: String(dataOne(result, "Не удалось сохранить шаблон вопроса").id),
  };
}

const ruleDraftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(160),
  questionTemplateId: z.string().uuid(),
  triggerType: z.enum([
    "record_state",
    "relative_time",
    "field_change",
    "aggregate",
  ]),
  sourceKey: z.string().min(1),
  dsl: z.unknown(),
  grouping: z.object({
    mode: z.enum(["none", "smart"]),
    fields: z.array(z.string()).max(10),
  }),
  routing: z.object({
    strategy: z.enum(["nearest_matching", "specific_template", "pool_only"]),
    templateId: z.string().uuid().nullable().optional(),
    requireParticipant: z
      .enum(["responsible", "department", "supply", "none"])
      .optional(),
    fallback: z.enum(["pool", "fallback_template"]),
  }),
  lifecycle: z.object({
    clearBehavior: z.enum(["auto_close", "keep_for_confirmation"]),
    taskBehavior: z.enum(["wait_for_completion", "close_after_creation"]),
  }),
  notifications: z.object({
    channels: z.array(z.enum(["crm", "telegram"])).min(1),
    criticalOnly: z.boolean(),
  }),
});

async function requireSourceView(sourceKey: string) {
  const source = MEETING_SOURCE_BY_KEY[sourceKey];
  if (!source) throw new Error("Источник данных недоступен");
  await requirePermission(source.resourceKey as ResourceKey, "view");
}

export async function previewMeetingRuleV2(input: unknown) {
  await requirePermission("meeting_rules", "manage");
  const parsed = ruleDraftSchema.parse(input);
  await requireSourceView(parsed.sourceKey);
  return previewMeetingRule({
    ...parsed,
    dsl: validateMeetingRuleDsl(parsed.sourceKey, parsed.dsl),
  } as MeetingRuleDraft);
}

export async function saveMeetingRuleDraftV2(input: unknown) {
  const { user } = await requirePermission("meeting_rules", "manage");
  const parsed = ruleDraftSchema.parse(input);
  await requireSourceView(parsed.sourceKey);
  const dsl = validateMeetingRuleDsl(parsed.sourceKey, parsed.dsl);
  const db = adminDb();
  const ruleResult = parsed.id
    ? await db
        .from("meeting_rules")
        .update({
          name: parsed.name,
          question_template_id: parsed.questionTemplateId,
          status: "draft",
        })
        .eq("id", parsed.id)
        .select("id")
        .single()
    : await db
        .from("meeting_rules")
        .insert({
          name: parsed.name,
          question_template_id: parsed.questionTemplateId,
          status: "draft",
          created_by: user.id,
        })
        .select("id")
        .single();
  const ruleId = String(dataOne(ruleResult, "Не удалось сохранить правило").id);
  const previous = dataRows(
    await db
      .from("meeting_rule_versions")
      .select("version_no")
      .eq("rule_id", ruleId)
      .order("version_no", { ascending: false })
      .limit(1),
    "Не удалось определить версию правила",
  );
  const versionResult = await db
    .from("meeting_rule_versions")
    .insert({
      rule_id: ruleId,
      version_no: Number(previous[0]?.version_no || 0) + 1,
      trigger_type: parsed.triggerType,
      source_key: parsed.sourceKey,
      dsl,
      grouping: parsed.grouping,
      routing: parsed.routing,
      lifecycle: parsed.lifecycle,
      notifications: parsed.notifications,
      created_by: user.id,
    })
    .select("id, version_no")
    .single();
  const version = dataOne(versionResult, "Не удалось сохранить версию правила");
  await db
    .from("meeting_rules")
    .update({ current_version_id: version.id })
    .eq("id", ruleId);
  invalidateMeetings();
  return { ruleId, versionId: version.id, versionNo: version.version_no };
}

export async function publishMeetingRuleV2(
  ruleId: string,
  processCurrentMatches: boolean,
) {
  const { user } = await requirePermission("meeting_rules", "manage");
  uuidSchema.parse(ruleId);
  const db = adminDb();
  const result = await db
    .from("meeting_rules")
    .update({
      status: "published",
      published_by: user.id,
      published_at: new Date().toISOString(),
    })
    .eq("id", ruleId)
    .select(
      "id, current_version_id, current_version:meeting_rule_versions!meeting_rules_current_version_id_fkey(source_key)",
    )
    .single();
  const rule = dataOne(result, "Не удалось опубликовать правило");
  if (!rule.current_version_id)
    throw new Error("Сначала сохраните версию правила");
  const version = Array.isArray(rule.current_version)
    ? rule.current_version[0]
    : rule.current_version;
  const sourceKey = String(
    (version as Record<string, unknown>)?.source_key || "",
  );
  await requireSourceView(sourceKey);
  if (processCurrentMatches) {
    await db.from("meeting_rule_events").insert({
      source_key: sourceKey,
      operation: "reconcile",
      payload: { reason: "publish", ruleId },
    });
    await processPendingMeetingRuleEvents(100);
  }
  invalidateMeetings();
  return { ok: true };
}

export async function setMeetingRuleStatusV2(
  ruleId: string,
  status: "published" | "paused" | "archived",
) {
  await requirePermission("meeting_rules", "manage");
  uuidSchema.parse(ruleId);
  const result = await adminDb()
    .from("meeting_rules")
    .update({ status })
    .eq("id", ruleId);
  if (result.error)
    throw new Error(
      result.error.message || "Не удалось изменить состояние правила",
    );
  invalidateMeetings();
}

export async function setMeetingSystemModeV2(mode: "shadow" | "active") {
  await requirePermission("meeting_rules", "manage");
  const supabase = await createServerSupabaseClient();
  const result = await (supabase as unknown as Db).rpc(
    "set_meeting_system_v2_mode",
    { p_mode: mode },
  );
  if (result.error)
    throw new Error(
      result.error.message || "Не удалось переключить систему совещаний",
    );
  if (mode === "active") await processPendingMeetingRuleEvents(100);
  invalidateMeetings();
  return result.data;
}

export async function createManualMeetingQuestionV2(input: {
  title: string;
  description?: string | null;
  category?: string;
  priority?: string;
  meetingId?: string | null;
  responsibleUserId?: string | null;
  deadline?: string | null;
}) {
  const { user } = await requirePermission("meetings_agenda_pool", "manage");
  const parsed = z
    .object({
      title: z.string().trim().min(2).max(300),
      description: z.string().trim().max(2000).nullable().optional(),
      category: z.string().trim().min(1).max(80).default("manual"),
      priority: prioritySchema.default("normal"),
      meetingId: z.string().uuid().nullable().optional(),
      responsibleUserId: z.string().uuid().nullable().optional(),
      deadline: z.iso.date().nullable().optional(),
    })
    .parse(input);
  const result = await adminDb()
    .from("meeting_questions")
    .insert({
      assigned_meeting_id: parsed.meetingId || null,
      episode_key: `manual:${crypto.randomUUID()}`,
      source_type: "manual",
      title: parsed.title,
      description: parsed.description || null,
      category: parsed.category,
      priority: parsed.priority,
      status: parsed.meetingId ? "assigned" : "new",
      responsible_user_id: parsed.responsibleUserId || null,
      deadline: parsed.deadline || null,
      manual_assignment_locked: Boolean(parsed.meetingId),
      created_by: user.id,
    })
    .select("id")
    .single();
  invalidateMeetings();
  return { id: String(dataOne(result, "Не удалось создать вопрос").id) };
}

async function callMeetingRpc(name: string, args: Record<string, unknown>) {
  const supabase = await createServerSupabaseClient();
  const result = await (supabase as unknown as Db).rpc(name, args);
  if (result.error)
    throw new Error(result.error.message || "Операция совещания не выполнена");
  invalidateMeetings();
  return result.data;
}

export async function assignMeetingQuestionV2(
  questionId: string,
  meetingId: string,
) {
  await requirePermission("meetings_agenda_pool", "manage");
  uuidSchema.parse(questionId);
  uuidSchema.parse(meetingId);
  return callMeetingRpc("assign_meeting_question_v2", {
    p_question_id: questionId,
    p_meeting_id: meetingId,
    p_manual_lock: true,
  });
}

export async function unassignMeetingQuestionV2(questionId: string) {
  await requirePermission("meetings_agenda_pool", "manage");
  uuidSchema.parse(questionId);
  const db = adminDb();
  const result = await db
    .from("meeting_questions")
    .update({
      assigned_meeting_id: null,
      status: "new",
      manual_assignment_locked: false,
    })
    .eq("id", questionId);
  if (result.error)
    throw new Error(
      result.error.message || "Не удалось снять вопрос с совещания",
    );
  await db
    .from("meeting_question_events")
    .insert({ question_id: questionId, event_type: "unassigned" });
  invalidateMeetings();
}

export async function setMeetingQuestionPinnedV2(
  questionId: string,
  isPinned: boolean,
) {
  const { user } = await requirePermission("meetings_agenda_pool", "manage");
  uuidSchema.parse(questionId);
  const db = adminDb();
  const result = await db
    .from("meeting_questions")
    .update({ is_pinned: isPinned })
    .eq("id", questionId);
  if (result.error)
    throw new Error(
      result.error.message || "Не удалось изменить закрепление вопроса",
    );
  await db.from("meeting_question_events").insert({
    question_id: questionId,
    event_type: isPinned ? "pinned" : "unpinned",
    actor_user_id: user.id,
  });
  invalidateMeetings();
}

export async function startMeetingV2(meetingId: string) {
  await requirePermission("meetings", "manage");
  uuidSchema.parse(meetingId);
  return callMeetingRpc("start_meeting_v2", { p_meeting_id: meetingId });
}

export async function completeMeetingV2(
  meetingId: string,
  notes?: string | null,
) {
  await requirePermission("meetings", "manage");
  uuidSchema.parse(meetingId);
  return callMeetingRpc("complete_meeting_v2", {
    p_meeting_id: meetingId,
    p_notes: notes || null,
  });
}

export async function cancelMeetingV2(meetingId: string) {
  await requirePermission("meetings", "manage");
  uuidSchema.parse(meetingId);
  return callMeetingRpc("cancel_meeting_v2", { p_meeting_id: meetingId });
}

export async function rescheduleMeetingV2(input: {
  meetingId: string;
  scope: "single" | "following";
  date: string;
  time: string;
  durationMinutes: number;
  title?: string | null;
  reason?: string | null;
}) {
  await requirePermission("meetings", "manage");
  const parsed = z
    .object({
      meetingId: z.string().uuid(),
      scope: z.enum(["single", "following"]),
      date: z.iso.date(),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      durationMinutes: z.number().int().min(15).max(480),
      title: z.string().trim().max(200).nullable().optional(),
      reason: z.string().trim().max(500).nullable().optional(),
    })
    .parse(input);
  const startsAt = zonedDateTimeToUtc(
    parsed.date,
    parsed.time,
    "Europe/Uzhgorod",
  );
  const endsAt = new Date(startsAt.getTime() + parsed.durationMinutes * 60_000);
  return callMeetingRpc("reschedule_meeting_v2", {
    p_meeting_id: parsed.meetingId,
    p_scope: parsed.scope,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt.toISOString(),
    p_title: parsed.title || null,
    p_reason: parsed.reason || null,
  });
}

export async function recordMeetingQuestionOutcomeV2(input: {
  questionId: string;
  meetingId: string;
  outcomeType: "decision" | "task" | "defer" | "dismiss" | "source_update";
  decisionText?: string | null;
  responsibleUserId?: string | null;
  deadline?: string | null;
  createTask?: boolean;
}) {
  await requirePermission("meetings", "manage");
  const parsed = z
    .object({
      questionId: z.string().uuid(),
      meetingId: z.string().uuid(),
      outcomeType: z.enum([
        "decision",
        "task",
        "defer",
        "dismiss",
        "source_update",
      ]),
      decisionText: z.string().trim().max(5000).nullable().optional(),
      responsibleUserId: z.string().uuid().nullable().optional(),
      deadline: z.iso.date().nullable().optional(),
      createTask: z.boolean().default(false),
    })
    .parse(input);
  return callMeetingRpc("record_meeting_question_outcome_v2", {
    p_question_id: parsed.questionId,
    p_meeting_id: parsed.meetingId,
    p_outcome_type: parsed.outcomeType,
    p_decision_text: parsed.decisionText || null,
    p_responsible_user_id: parsed.responsibleUserId || null,
    p_deadline: parsed.deadline || null,
    p_create_task: parsed.createTask,
    p_payload: {},
  });
}
