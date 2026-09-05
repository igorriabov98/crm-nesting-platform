import "server-only";

import { getAppUrl } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, sendTelegramMessage } from "@/lib/services/telegram";
import {
  applyAggregateRule,
  buildMeetingGroupKey,
  evaluateMeetingRuleDsl,
  renderMeetingTemplate,
  validateMeetingRuleDsl,
} from "./dsl";
import { loadMeetingSourceRecords } from "./sources";
import type {
  MeetingQuestionPriority,
  MeetingQuestionTemplate,
  MeetingRoutingPolicy,
  MeetingRuleDraft,
  MeetingRuleLifecycle,
  MeetingRuleNotifications,
  MeetingRulePreview,
  MeetingRuleVersion,
  MeetingSourceRecord,
} from "./types";

type DbError = { code?: string; message?: string } | null;
type DbResult = { data: unknown; error: DbError; count?: number | null };
type EngineQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: Record<string, unknown>) => EngineQuery;
  insert: (
    values: Record<string, unknown> | Record<string, unknown>[],
  ) => EngineQuery;
  update: (values: Record<string, unknown>) => EngineQuery;
  upsert: (
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: Record<string, unknown>,
  ) => EngineQuery;
  eq: (column: string, value: unknown) => EngineQuery;
  in: (column: string, values: unknown[]) => EngineQuery;
  is: (column: string, value: unknown) => EngineQuery;
  gte: (column: string, value: unknown) => EngineQuery;
  order: (column: string, options?: Record<string, unknown>) => EngineQuery;
  limit: (count: number) => EngineQuery;
  maybeSingle: () => Promise<DbResult>;
  single: () => Promise<DbResult>;
};
type EngineDb = {
  from: (table: string) => EngineQuery;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<DbResult>;
};

type RuntimeRule = {
  id: string;
  name: string;
  current_version_id: string;
  question_template_id: string;
  version: MeetingRuleVersion;
  template: MeetingQuestionTemplate;
};

type ActiveQuestion = {
  id: string;
  episode_key: string;
  assigned_meeting_id: string | null;
  status: string;
  manual_assignment_locked: boolean;
  condition_active: boolean;
};

type EventRow = {
  id: number;
  source_key: string;
  source_id: string | null;
  operation: string;
  changed_fields: string[];
  payload: Record<string, unknown>;
};

function dbClient() {
  return createAdminClient() as unknown as EngineDb;
}

function rows(result: DbResult, label: string) {
  if (result.error)
    throw new Error(
      `${label}: ${result.error.message || "ошибка базы данных"}`,
    );
  return Array.isArray(result.data)
    ? (result.data as Record<string, unknown>[])
    : [];
}

function one<T>(result: DbResult, label: string) {
  if (result.error || !result.data)
    throw new Error(
      `${label}: ${result.error?.message || "запись не найдена"}`,
    );
  return result.data as T;
}

async function meetingSystemMode(db: EngineDb): Promise<"shadow" | "active"> {
  const result = await db
    .from("app_settings")
    .select("value")
    .eq("key", "meeting_system_v2_mode")
    .maybeSingle();
  if (result.error)
    throw new Error(
      result.error.message || "Не удалось определить режим системы совещаний",
    );
  const value = String(
    (result.data as Record<string, unknown> | null)?.value || "shadow",
  );
  return value === "active" ? "active" : "shadow";
}

async function hydrateBusinessTokens(
  db: EngineDb,
  sourceRecords: MeetingSourceRecord[],
) {
  const factoryIds = [
    ...new Set(sourceRecords.map((record) => record.factoryId).filter(Boolean)),
  ] as string[];
  const userIds = [
    ...new Set(
      sourceRecords.map((record) => record.responsibleUserId).filter(Boolean),
    ),
  ] as string[];
  const [factoriesResult, usersResult] = await Promise.all([
    factoryIds.length
      ? db.from("factories").select("id, name").in("id", factoryIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? db.from("users").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const factoryNames = new Map(
    rows(factoriesResult, "Не удалось загрузить заводы").map((item) => [
      String(item.id),
      String(item.name),
    ]),
  );
  const userNames = new Map(
    rows(usersResult, "Не удалось загрузить ответственных").map((item) => [
      String(item.id),
      String(item.full_name || "Не назначен"),
    ]),
  );
  return sourceRecords.map((record) => ({
    ...record,
    values: {
      ...record.values,
      Завод: record.factoryId
        ? factoryNames.get(record.factoryId) || "Не назначен"
        : record.values.Завод || "Не назначен",
      Ответственный: record.responsibleUserId
        ? userNames.get(record.responsibleUserId) || "Не назначен"
        : record.values.Ответственный || "Не назначен",
    },
  }));
}

function groupMatches(records: MeetingSourceRecord[], fields: string[]) {
  const groups = new Map<string, MeetingSourceRecord[]>();
  for (const record of records) {
    const key = buildMeetingGroupKey(fields, record);
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return groups;
}

function titleValues(group: MeetingSourceRecord[]) {
  const first = group[0];
  return { ...first.values, Количество: group.length };
}

async function loadRuntimeRule(
  db: EngineDb,
  ruleId: string,
): Promise<RuntimeRule> {
  const result = await db
    .from("meeting_rules")
    .select(
      `
    id, name, question_template_id, current_version_id,
    question_template:meeting_question_templates(*),
    current_version:meeting_rule_versions(*)
  `,
    )
    .eq("id", ruleId)
    .eq("status", "published")
    .maybeSingle();
  const data = one<Record<string, unknown>>(
    result,
    "Опубликованное правило не найдено",
  );
  const version = (
    Array.isArray(data.current_version)
      ? data.current_version[0]
      : data.current_version
  ) as MeetingRuleVersion | null;
  const template = (
    Array.isArray(data.question_template)
      ? data.question_template[0]
      : data.question_template
  ) as MeetingQuestionTemplate | null;
  if (!version || !template)
    throw new Error("У правила нет опубликованной версии или шаблона вопроса");
  return {
    id: String(data.id),
    name: String(data.name),
    current_version_id: String(data.current_version_id),
    question_template_id: String(data.question_template_id),
    version,
    template,
  };
}

async function chooseMeeting(
  db: EngineDb,
  routing: MeetingRoutingPolicy,
  category: string,
  record: MeetingSourceRecord,
) {
  if (routing.strategy === "pool_only") return null;
  const now = new Date().toISOString();
  const query = db
    .from("meetings")
    .select(
      `
    id, template_id, starts_at, meeting_date, meeting_time,
    template:meeting_templates(id, name, scope_type, scope_id, accepted_categories, fallback_template_id),
    attendees:meeting_attendees(user_id, user:users(role))
  `,
    )
    .eq("status", "planned")
    .is("started_at", null)
    .gte("starts_at", now)
    .order("starts_at", { ascending: true })
    .limit(200);
  const candidates = rows(await query, "Не удалось подобрать совещание");
  const templateIds = [
    ...new Set(
      candidates
        .map((candidate) => String(candidate.template_id || ""))
        .filter(Boolean),
    ),
  ];
  const participantResult = templateIds.length
    ? await db
        .from("meeting_template_participants")
        .select("template_id, participant_type, user_id, department_id, role")
        .in("template_id", templateIds)
    : { data: [], error: null };
  const participants = rows(
    participantResult,
    "Не удалось проверить участников",
  );

  const matchesCandidate = (candidate: Record<string, unknown>) => {
    const template = (
      Array.isArray(candidate.template)
        ? candidate.template[0]
        : candidate.template
    ) as Record<string, unknown> | null;
    if (!template) return false;
    const accepted = Array.isArray(template.accepted_categories)
      ? template.accepted_categories.map(String)
      : [];
    if (accepted.length > 0 && !accepted.includes(category)) return false;
    const scopeType = String(template.scope_type || "all");
    if (
      scopeType === "factory" &&
      String(template.scope_id || "") !== String(record.factoryId || "")
    )
      return false;
    if (
      scopeType === "department" &&
      String(template.scope_id || "") !== String(record.departmentId || "")
    )
      return false;
    const templateParticipants = participants.filter(
      (item) => String(item.template_id) === String(candidate.template_id),
    );
    const attendeeIds = (
      Array.isArray(candidate.attendees) ? candidate.attendees : []
    ).map((item) => String((item as Record<string, unknown>).user_id || ""));
    if (
      routing.requireParticipant === "responsible" &&
      record.responsibleUserId
    ) {
      const included =
        attendeeIds.includes(record.responsibleUserId) ||
        templateParticipants.some(
          (item) =>
            item.participant_type === "user" &&
            String(item.user_id) === record.responsibleUserId,
        );
      if (!included) return false;
    }
    if (routing.requireParticipant === "department" && record.departmentId) {
      if (
        !templateParticipants.some(
          (item) =>
            item.participant_type === "department" &&
            String(item.department_id) === record.departmentId,
        )
      )
        return false;
    }
    if (routing.requireParticipant === "supply") {
      const hasSupplyParticipant =
        templateParticipants.some(
          (item) =>
            item.participant_type === "role" && item.role === "supply_manager",
        ) ||
        (Array.isArray(candidate.attendees) ? candidate.attendees : []).some(
          (attendee) => {
            const user = (attendee as Record<string, unknown>).user;
            const relatedUser = Array.isArray(user) ? user[0] : user;
            return (
              (relatedUser as Record<string, unknown> | null)?.role ===
              "supply_manager"
            );
          },
        );
      if (!hasSupplyParticipant) return false;
    }
    return true;
  };
  const primaryCandidates =
    routing.strategy === "specific_template" && routing.templateId
      ? candidates.filter(
          (candidate) =>
            String(candidate.template_id || "") === routing.templateId,
        )
      : candidates;
  for (const candidate of primaryCandidates) {
    if (matchesCandidate(candidate)) return String(candidate.id);
  }
  if (routing.fallback === "fallback_template") {
    const fallbackIds = new Set(
      primaryCandidates
        .map((candidate) => {
          const template = Array.isArray(candidate.template)
            ? candidate.template[0]
            : candidate.template;
          return String(
            (template as Record<string, unknown> | null)
              ?.fallback_template_id || "",
          );
        })
        .filter(Boolean),
    );
    if (
      fallbackIds.size === 0 &&
      routing.strategy === "specific_template" &&
      routing.templateId
    ) {
      const templateResult = await db
        .from("meeting_templates")
        .select("fallback_template_id")
        .eq("id", routing.templateId)
        .maybeSingle();
      if (templateResult.error)
        throw new Error(
          templateResult.error.message ||
            "Не удалось загрузить резервный маршрут",
        );
      if (templateResult.data) {
        const fallbackTemplateId = String(
          (templateResult.data as Record<string, unknown>)
            .fallback_template_id || "",
        );
        if (fallbackTemplateId) fallbackIds.add(fallbackTemplateId);
      }
    }
    const fallback = candidates.find(
      (candidate) =>
        fallbackIds.has(String(candidate.template_id || "")) &&
        matchesCandidate(candidate),
    );
    if (fallback) return String(fallback.id);
  }
  return null;
}

async function notifyQuestion(
  db: EngineDb,
  questionId: string,
  title: string,
  userIds: string[],
  notifications: MeetingRuleNotifications,
  isCritical: boolean,
) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  const message = `${isCritical ? "Критичный вопрос" : "Новый вопрос"} в пуле повесток: ${title}`;
  const notificationType = isCritical
    ? "meeting_question_critical"
    : "meeting_question_new";
  if (notifications.channels.includes("crm")) {
    for (const userId of recipients) {
      const existing = await db
        .from("notifications")
        .select("id, message")
        .eq("user_id", userId)
        .eq("type", notificationType)
        .eq("is_read", false)
        .limit(1);
      const existingRow = rows(existing, "Не удалось проверить уведомления")[0];
      if (existingRow) {
        await db
          .from("notifications")
          .update({ title: "Вопросы совещаний", message })
          .eq("id", existingRow.id);
      } else {
        await db.from("notifications").insert({
          user_id: userId,
          type: notificationType,
          title: isCritical
            ? "Критичный вопрос совещания"
            : "Новый вопрос совещания",
          message,
        });
      }
    }
  }
  if (notifications.channels.includes("telegram")) {
    const usersResult = recipients.length
      ? await db
          .from("users")
          .select("id, telegram_chat_id")
          .in("id", recipients)
      : { data: [], error: null };
    const url = `${getAppUrl()}/meetings/agenda-pool`;
    for (const user of rows(
      usersResult,
      "Не удалось загрузить Telegram-получателей",
    )) {
      const chatId = String(user.telegram_chat_id || "").trim();
      if (!chatId) continue;
      await sendTelegramMessage(
        chatId,
        `<b>${isCritical ? "Критичный вопрос" : "Новый вопрос"} совещания</b>\n\n${escapeHtml(title)}`,
        {
          parseMode: "HTML",
          replyMarkup: {
            inline_keyboard: [[{ text: "Открыть пул повесток", url }]],
          },
        },
      );
    }
  }
  await db.from("meeting_question_events").insert({
    question_id: questionId,
    event_type: "critical_notification_queued",
    details: { channels: notifications.channels },
  });
}

function eventSourceId(sourceKey: string, event: EventRow) {
  const current =
    event.payload?.current && typeof event.payload.current === "object"
      ? (event.payload.current as Record<string, unknown>)
      : {};
  const previous =
    event.payload?.previous && typeof event.payload.previous === "object"
      ? (event.payload.previous as Record<string, unknown>)
      : {};
  const values = Object.keys(current).length ? current : previous;
  const table = String(event.payload?.table || "");
  if (sourceKey === "supply_materials") {
    if (table.startsWith("request_")) return `${table}:${values.id}`;
    if (table === "supply_order_delivery_schedules")
      return `${values.request_item_table}:${values.request_item_id}`;
  }
  if (sourceKey === "inventory" && table === "inventory_transfer_items")
    return String(values.transfer_id || values.inventory_transfer_id || "");
  if (
    sourceKey === "production_stages" &&
    table === "production_stage_intervals"
  )
    return String(values.production_stage_id || values.stage_id || "");
  return event.source_id || "";
}

function withEventPreviousValues(
  records: MeetingSourceRecord[],
  sourceKey: string,
  event: EventRow,
) {
  const targetId = eventSourceId(sourceKey, event);
  const previous =
    event.payload?.previous && typeof event.payload.previous === "object"
      ? (event.payload.previous as Record<string, unknown>)
      : {};
  return records
    .filter((record) => !targetId || record.id === targetId)
    .map((record) => ({ ...record, previousValues: previous }));
}

async function upsertQuestionGroup(
  db: EngineDb,
  rule: RuntimeRule,
  groupKey: string,
  group: MeetingSourceRecord[],
  active: ActiveQuestion | undefined,
) {
  const first = group[0];
  const generatedTitle = renderMeetingTemplate(
    rule.template.title_template,
    titleValues(group),
  );
  const generatedDescription = rule.template.description_template
    ? renderMeetingTemplate(
        rule.template.description_template,
        titleValues(group),
      )
    : null;
  if (active?.status === "in_meeting") {
    await db
      .from("meeting_questions")
      .update({ condition_active: true })
      .eq("id", active.id);
    await db.from("meeting_question_events").insert({
      question_id: active.id,
      event_type: "source_changed_during_meeting",
      meeting_id: active.assigned_meeting_id,
      details: { conditionActive: true, currentMemberCount: group.length },
    });
    return {
      created: false,
      questionId: active.id,
      meetingId: active.assigned_meeting_id,
    };
  }
  const meetingId = active?.manual_assignment_locked
    ? active.assigned_meeting_id
    : await chooseMeeting(
        db,
        rule.version.routing,
        rule.template.category,
        first,
      );
  let questionId = active?.id || null;
  let created = false;
  const values = {
    question_template_id: rule.question_template_id,
    rule_id: rule.id,
    rule_version_id: rule.current_version_id,
    assigned_meeting_id: meetingId,
    episode_key: groupKey,
    group_key: groupKey,
    source_type: rule.version.source_key,
    source_id: group.length === 1 ? first.id : null,
    title: generatedTitle,
    description: generatedDescription,
    category: rule.template.category,
    priority: rule.template.priority,
    status:
      active?.status === "on_control"
        ? "on_control"
        : meetingId
          ? "assigned"
          : "new",
    factory_id: first.factoryId || null,
    department_id: first.departmentId || null,
    responsible_user_id:
      first.responsibleUserId ||
      rule.template.default_responsible_user_id ||
      null,
    deadline:
      group
        .map((item) => item.deadline)
        .filter(Boolean)
        .sort()[0] || null,
    source_url: first.url || rule.template.source_url_template,
    condition_active: true,
    condition_snapshot: {
      count: group.length,
      values: titleValues(group),
      checkedAt: new Date().toISOString(),
    },
    closed_at: null,
  };
  if (questionId) {
    const result = await db
      .from("meeting_questions")
      .update(values)
      .eq("id", questionId)
      .select("id")
      .single();
    questionId = String(
      one<Record<string, unknown>>(result, "Не удалось обновить вопрос").id,
    );
  } else {
    const result = await db
      .from("meeting_questions")
      .insert(values)
      .select("id")
      .single();
    if (result.error?.code === "23505") {
      const collision = await db
        .from("meeting_questions")
        .select("id")
        .eq("rule_id", rule.id)
        .eq("episode_key", groupKey)
        .in("status", [
          "new",
          "assigned",
          "in_meeting",
          "on_control",
          "deferred",
        ])
        .maybeSingle();
      questionId = String(
        one<Record<string, unknown>>(
          collision,
          "Не удалось разрешить параллельное создание вопроса",
        ).id,
      );
    } else {
      questionId = String(
        one<Record<string, unknown>>(result, "Не удалось создать вопрос").id,
      );
      created = true;
    }
  }

  await db
    .from("meeting_question_members")
    .update({ condition_active: false, cleared_at: new Date().toISOString() })
    .eq("question_id", questionId);
  const members = group.map((record) => ({
    question_id: questionId,
    source_key: record.key,
    source_type: rule.version.source_key,
    source_id: record.id,
    title: record.title,
    source_url: record.url,
    condition_active: true,
    snapshot: record.values,
    cleared_at: null,
  }));
  await db
    .from("meeting_question_members")
    .upsert(members, { onConflict: "question_id,source_key" });
  await db.from("meeting_question_events").insert({
    question_id: questionId,
    event_type: created ? "rule_opened" : "rule_refreshed",
    meeting_id: meetingId,
    details: {
      ruleVersionId: rule.current_version_id,
      memberCount: group.length,
      routed: Boolean(meetingId),
    },
  });
  if (
    created &&
    (rule.template.priority === "critical" ||
      !rule.version.notifications.criticalOnly)
  ) {
    const userIds = [
      first.responsibleUserId ||
        rule.template.default_responsible_user_id ||
        "",
    ];
    if (meetingId) {
      const meetingResult = await db
        .from("meetings")
        .select("facilitator_user_id")
        .eq("id", meetingId)
        .maybeSingle();
      const facilitator =
        meetingResult.data && typeof meetingResult.data === "object"
          ? String(
              (meetingResult.data as Record<string, unknown>)
                .facilitator_user_id || "",
            )
          : "";
      userIds.push(facilitator);
    }
    await notifyQuestion(
      db,
      questionId,
      generatedTitle,
      userIds,
      rule.version.notifications,
      rule.template.priority === "critical",
    );
  }
  return { created, questionId, meetingId };
}

async function clearMissingQuestions(
  db: EngineDb,
  rule: RuntimeRule,
  activeQuestions: ActiveQuestion[],
  latestQuestions: ActiveQuestion[],
  seenEpisodeKeys: Set<string>,
) {
  let closed = 0;
  for (const question of latestQuestions) {
    if (seenEpisodeKeys.has(question.episode_key) || !question.condition_active)
      continue;
    await db
      .from("meeting_questions")
      .update({ condition_active: false })
      .eq("id", question.id);
  }
  for (const question of activeQuestions) {
    if (seenEpisodeKeys.has(question.episode_key)) continue;
    if (!question.condition_active) continue;
    if (question.status === "in_meeting") {
      await db
        .from("meeting_questions")
        .update({ condition_active: false })
        .eq("id", question.id);
      await db.from("meeting_question_events").insert({
        question_id: question.id,
        event_type: "source_changed_during_meeting",
        details: { conditionActive: false },
      });
      continue;
    }
    if (question.status === "on_control") {
      const linksResult = await db
        .from("meeting_question_task_links")
        .select("is_required, task:tasks(status)")
        .eq("question_id", question.id);
      const links = rows(linksResult, "Не удалось проверить связанные задачи");
      const hasIncompleteRequiredTask = links.some((link) => {
        if (!link.is_required) return false;
        const task = Array.isArray(link.task) ? link.task[0] : link.task;
        return (
          String((task as Record<string, unknown> | null)?.status || "") !==
          "completed"
        );
      });
      await db
        .from("meeting_questions")
        .update(
          hasIncompleteRequiredTask
            ? { condition_active: false }
            : {
                condition_active: false,
                status: "resolved",
                assigned_meeting_id: null,
                closed_at: new Date().toISOString(),
              },
        )
        .eq("id", question.id);
      if (!hasIncompleteRequiredTask) closed += 1;
      continue;
    }
    if (
      (rule.version.lifecycle as MeetingRuleLifecycle).clearBehavior ===
      "keep_for_confirmation"
    ) {
      await db
        .from("meeting_questions")
        .update({ condition_active: false })
        .eq("id", question.id);
      await db.from("meeting_question_events").insert({
        question_id: question.id,
        event_type: "condition_cleared_waiting_confirmation",
      });
      continue;
    }
    await db
      .from("meeting_questions")
      .update({
        condition_active: false,
        assigned_meeting_id: null,
        status: "auto_closed",
        closed_at: new Date().toISOString(),
      })
      .eq("id", question.id);
    await db.from("meeting_question_events").insert({
      question_id: question.id,
      event_type: "condition_cleared",
      details: { status: "auto_closed" },
    });
    closed += 1;
  }
  return closed;
}

export async function previewMeetingRule(
  draft: MeetingRuleDraft,
): Promise<MeetingRulePreview> {
  const db = dbClient();
  const dsl = validateMeetingRuleDsl(draft.sourceKey, draft.dsl);
  const templateResult = await db
    .from("meeting_question_templates")
    .select("*")
    .eq("id", draft.questionTemplateId)
    .maybeSingle();
  const template = one<MeetingQuestionTemplate>(
    templateResult,
    "Шаблон вопроса не найден",
  );
  const records = await hydrateBusinessTokens(
    db,
    await loadMeetingSourceRecords(db, draft.sourceKey, { limit: 10_000 }),
  );
  const matches = records.filter((record) =>
    evaluateMeetingRuleDsl(dsl, record),
  );
  const groups = groupMatches(matches, draft.grouping.fields);
  for (const [groupKey, group] of groups)
    if (!applyAggregateRule(dsl, group)) groups.delete(groupKey);
  const conflictsResult = await db
    .from("meeting_questions")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", draft.id || "")
    .in("status", ["new", "assigned", "in_meeting", "on_control", "deferred"]);
  const samples: MeetingRulePreview["samples"] = [];
  for (const [groupKey, group] of [...groups.entries()].slice(0, 10)) {
    const route = await chooseMeeting(
      db,
      draft.routing,
      template.category,
      group[0],
    );
    samples.push({
      sourceId: group[0].id,
      title: group[0].title,
      generatedTitle: renderMeetingTemplate(
        template.title_template,
        titleValues(group),
      ),
      groupKey,
      routeLabel: route
        ? "Ближайшее подходящее совещание"
        : "Без подходящего совещания",
    });
  }
  return {
    matchCount: [...groups.values()].reduce(
      (count, group) => count + group.length,
      0,
    ),
    groupCount: groups.size,
    samples,
    conflicts: conflictsResult.count || 0,
  };
}

export async function evaluatePublishedMeetingRule(
  ruleId: string,
  sourceEvent?: EventRow | null,
  runType: "event" | "reconcile" | "backfill" = "event",
) {
  const db = dbClient();
  const executionMode = await meetingSystemMode(db);
  const rule = await loadRuntimeRule(db, ruleId);
  const runResult = await db
    .from("meeting_rule_runs")
    .insert({
      rule_id: rule.id,
      rule_version_id: rule.current_version_id,
      run_type: runType,
      execution_mode: executionMode,
      status: "running",
    })
    .select("id")
    .single();
  const runId = String(
    one<Record<string, unknown>>(
      runResult,
      "Не удалось создать журнал выполнения",
    ).id,
  );
  try {
    const dsl = validateMeetingRuleDsl(
      rule.version.source_key,
      rule.version.dsl,
    );
    // A source is reconciled as one bounded set. This preserves grouped questions when
    // a record moves between groups and makes disappearing conditions close safely.
    const loaded = await loadMeetingSourceRecords(db, rule.version.source_key, {
      limit: 10_000,
    });
    const sourceRecords = await hydrateBusinessTokens(
      db,
      rule.version.trigger_type === "field_change" && sourceEvent
        ? withEventPreviousValues(loaded, rule.version.source_key, sourceEvent)
        : loaded,
    );
    const matches = sourceRecords.filter((record) =>
      evaluateMeetingRuleDsl(dsl, record),
    );
    const groups = groupMatches(matches, rule.version.grouping.fields);
    for (const [groupKey, group] of groups)
      if (!applyAggregateRule(dsl, group)) groups.delete(groupKey);
    if (rule.version.trigger_type === "field_change" && sourceEvent) {
      for (const [groupKey, group] of [...groups]) {
        groups.delete(groupKey);
        groups.set(`${groupKey}:event:${sourceEvent.id}`, group);
      }
    }
    const allQuestionsResult = await db
      .from("meeting_questions")
      .select(
        "id, episode_key, assigned_meeting_id, status, manual_assignment_locked, condition_active",
      )
      .eq("rule_id", rule.id)
      .order("opened_at", { ascending: false });
    const allQuestions = rows(
      allQuestionsResult,
      "Не удалось загрузить эпизоды правила",
    ) as unknown as ActiveQuestion[];
    const activeQuestions = allQuestions.filter((question) =>
      ["new", "assigned", "in_meeting", "on_control", "deferred"].includes(
        question.status,
      ),
    );
    const activeByKey = new Map(
      activeQuestions.map((question) => [question.episode_key, question]),
    );
    const latestByKey = new Map<string, ActiveQuestion>();
    for (const question of allQuestions) {
      if (!latestByKey.has(question.episode_key))
        latestByKey.set(question.episode_key, question);
    }
    if (executionMode === "shadow") {
      await db
        .from("meeting_rule_runs")
        .update({
          status: "completed",
          matched_count: matches.length,
          group_count: groups.size,
          created_count: 0,
          closed_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      return {
        ruleId,
        mode: executionMode,
        matched: matches.length,
        groups: groups.size,
        created: 0,
        closed: 0,
      };
    }
    let created = 0;
    const seen = new Set<string>();
    for (const [groupKey, group] of groups) {
      seen.add(groupKey);
      const activeQuestion = activeByKey.get(groupKey);
      const previousEpisode = latestByKey.get(groupKey);
      if (!activeQuestion && previousEpisode?.condition_active) continue;
      const result = await upsertQuestionGroup(
        db,
        rule,
        groupKey,
        group,
        activeQuestion,
      );
      if (result.created) created += 1;
    }
    const closed =
      rule.version.trigger_type === "field_change"
        ? 0
        : await clearMissingQuestions(
            db,
            rule,
            activeQuestions,
            [...latestByKey.values()],
            seen,
          );
    await db
      .from("meeting_rule_runs")
      .update({
        status: "completed",
        matched_count: matches.length,
        group_count: groups.size,
        created_count: created,
        closed_count: closed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return {
      ruleId,
      mode: executionMode,
      matched: matches.length,
      groups: groups.size,
      created,
      closed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .from("meeting_rule_runs")
      .update({
        status: "failed",
        error_text: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw error;
  }
}

export async function processPendingMeetingRuleEvents(limit = 100) {
  const db = dbClient();
  const claim = await db.rpc("claim_meeting_rule_events_v2", {
    p_limit: limit,
  });
  const events = rows(
    claim,
    "Не удалось забрать события правил",
  ) as unknown as EventRow[];
  const summaries: Array<Record<string, unknown>> = [];
  const batches = new Map<string, EventRow[]>();
  for (const event of events)
    batches.set(event.source_key, [
      ...(batches.get(event.source_key) || []),
      event,
    ]);
  for (const [sourceKey, batch] of batches) {
    try {
      const rulesResult = await db
        .from("meeting_rules")
        .select(
          "id, current_version:meeting_rule_versions!meeting_rules_current_version_id_fkey(source_key, trigger_type)",
        )
        .eq("status", "published");
      const rules = rows(rulesResult, "Не удалось загрузить правила").filter(
        (rule) => {
          const version = Array.isArray(rule.current_version)
            ? rule.current_version[0]
            : rule.current_version;
          return (
            version &&
            String((version as Record<string, unknown>).source_key) ===
              sourceKey
          );
        },
      );
      for (const rule of rules) {
        const version = Array.isArray(rule.current_version)
          ? rule.current_version[0]
          : rule.current_version;
        const isFieldChange =
          String(
            (version as Record<string, unknown> | null)?.trigger_type || "",
          ) === "field_change";
        const isReconcile = batch.some(
          (event) => event.operation === "reconcile",
        );
        if (isFieldChange) {
          for (const event of batch.filter(
            (item) => item.operation !== "reconcile",
          ))
            summaries.push(
              await evaluatePublishedMeetingRule(
                String(rule.id),
                event,
                "event",
              ),
            );
        } else {
          summaries.push(
            await evaluatePublishedMeetingRule(
              String(rule.id),
              null,
              isReconcile ? "reconcile" : "event",
            ),
          );
        }
      }
      await db
        .from("meeting_rule_events")
        .update({
          processed_at: new Date().toISOString(),
          locked_at: null,
          last_error: null,
        })
        .in(
          "id",
          batch.map((event) => event.id),
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .from("meeting_rule_events")
        .update({
          locked_at: null,
          last_error: message,
          available_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .in(
          "id",
          batch.map((event) => event.id),
        );
    }
  }
  return { claimed: events.length, runs: summaries };
}

export function meetingPriorityRank(priority: MeetingQuestionPriority) {
  return priority === "critical"
    ? 0
    : priority === "high"
      ? 1
      : priority === "normal"
        ? 2
        : 3;
}
