import type { UserRole } from "@/lib/types";

export type MeetingScopeType = "all" | "factory" | "department" | "custom";
export type MeetingRecurrenceKind =
  "one_time" | "weekly" | "monthly" | "interval";
export type MeetingQuestionPriority = "low" | "normal" | "high" | "critical";
export type MeetingQuestionStatus =
  | "new"
  | "assigned"
  | "in_meeting"
  | "on_control"
  | "deferred"
  | "resolved"
  | "auto_closed"
  | "dismissed";
export type MeetingRuleStatus = "draft" | "published" | "paused" | "archived";
export type MeetingRuleTriggerType =
  "record_state" | "relative_time" | "field_change" | "aggregate";
export type MeetingOutcomeType =
  "decision" | "task" | "defer" | "dismiss" | "source_update";

export type MeetingConditionOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "before_today"
  | "after_today"
  | "days_ago_gte"
  | "days_until_lte"
  | "business_days_elapsed"
  | "after_field"
  | "before_field"
  | "changed"
  | "changed_from"
  | "changed_to";

export type MeetingCondition = {
  field: string;
  operator: MeetingConditionOperator;
  value?: unknown;
};

export type MeetingConditionGroup = {
  logic: "and" | "or";
  conditions: MeetingCondition[];
};

export type MeetingRuleDsl = {
  logic: "and" | "or";
  conditions: Array<MeetingCondition | MeetingConditionGroup>;
  aggregate?: {
    operation: "count" | "sum" | "min" | "max";
    field?: string;
    operator: "gt" | "gte" | "lt" | "lte" | "eq";
    value: number;
  };
};

export type MeetingGroupingPolicy = {
  mode: "none" | "smart";
  fields: string[];
};

export type MeetingRoutingPolicy = {
  strategy: "nearest_matching" | "specific_template" | "pool_only";
  templateId?: string | null;
  requireParticipant?: "responsible" | "department" | "supply" | "none";
  fallback: "pool" | "fallback_template";
};

export type MeetingRuleLifecycle = {
  clearBehavior: "auto_close" | "keep_for_confirmation";
  taskBehavior: "wait_for_completion" | "close_after_creation";
};

export type MeetingRuleNotifications = {
  channels: Array<"crm" | "telegram">;
  criticalOnly: boolean;
};

export type MeetingTemplate = {
  id: string;
  legacy_type_key: string | null;
  name: string;
  description: string | null;
  color: string;
  scope_type: MeetingScopeType;
  scope_id: string | null;
  facilitator_user_id: string | null;
  default_duration_minutes: number;
  accepted_categories: string[];
  reminder_offsets_minutes: number[];
  notification_channels: string[];
  fallback_template_id: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  participants?: MeetingTemplateParticipant[];
  schedule_versions?: MeetingScheduleVersion[];
};

export type MeetingTemplateParticipant = {
  id: string;
  template_id: string;
  participant_type: "user" | "role" | "department" | "external";
  user_id: string | null;
  role: UserRole | null;
  department_id: string | null;
  external_name: string | null;
  external_role: string | null;
  external_email: string | null;
  external_phone: string | null;
  is_required: boolean;
};

export type MeetingScheduleVersion = {
  id: string;
  template_id: string;
  version_no: number;
  recurrence_kind: MeetingRecurrenceKind;
  start_date: string;
  start_time: string;
  timezone: string;
  duration_minutes: number;
  weekdays: number[];
  month_day: number | null;
  interval_days: number | null;
  end_date: string | null;
  occurrence_count: number | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
};

export type MeetingQuestionTemplate = {
  id: string;
  name: string;
  title_template: string;
  description_template: string | null;
  category: string;
  priority: MeetingQuestionPriority;
  expected_outcome: string | null;
  allowed_outcomes: MeetingOutcomeType[];
  default_responsible_user_id: string | null;
  task_sla_days: number | null;
  source_url_template: string | null;
  fixed_for_every_occurrence: boolean;
  is_system: boolean;
  is_active: boolean;
};

export type MeetingRuleVersion = {
  id: string;
  rule_id: string;
  version_no: number;
  trigger_type: MeetingRuleTriggerType;
  source_key: string;
  dsl: MeetingRuleDsl;
  grouping: MeetingGroupingPolicy;
  routing: MeetingRoutingPolicy;
  lifecycle: MeetingRuleLifecycle;
  notifications: MeetingRuleNotifications;
  created_at: string;
};

export type MeetingRule = {
  id: string;
  name: string;
  question_template_id: string;
  status: MeetingRuleStatus;
  current_version_id: string | null;
  is_system: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  question_template?: MeetingQuestionTemplate | null;
  current_version?: MeetingRuleVersion | null;
};

export type MeetingQuestionMember = {
  id: string;
  question_id: string;
  source_key: string;
  source_type: string;
  source_id: string | null;
  title: string;
  source_url: string | null;
  condition_active: boolean;
  snapshot: Record<string, unknown>;
  opened_at: string;
  cleared_at: string | null;
};

export type MeetingQuestion = {
  id: string;
  question_template_id: string | null;
  rule_id: string | null;
  assigned_meeting_id: string | null;
  episode_key: string;
  group_key: string | null;
  source_type: string;
  source_id: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: MeetingQuestionPriority;
  status: MeetingQuestionStatus;
  factory_id: string | null;
  department_id: string | null;
  responsible_user_id: string | null;
  deadline: string | null;
  source_url: string | null;
  condition_active: boolean;
  condition_snapshot: Record<string, unknown>;
  manual_assignment_locked: boolean;
  carry_count: number;
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
  members?: MeetingQuestionMember[];
  meeting?: {
    id: string;
    title: string | null;
    meeting_date: string;
    meeting_time: string;
    status: string;
    template?: { id: string; name: string } | null;
  } | null;
  responsible?: { id: string; full_name: string | null } | null;
  factory?: { id: string; name: string } | null;
  rule?: { id: string; name: string } | null;
};

export type MeetingSourceRecord = {
  key: string;
  id: string;
  title: string;
  url: string | null;
  values: Record<string, unknown>;
  previousValues?: Record<string, unknown>;
  factoryId?: string | null;
  departmentId?: string | null;
  responsibleUserId?: string | null;
  deadline?: string | null;
};

export type MeetingRuleDraft = {
  id?: string;
  name: string;
  questionTemplateId: string;
  triggerType: MeetingRuleTriggerType;
  sourceKey: string;
  dsl: MeetingRuleDsl;
  grouping: MeetingGroupingPolicy;
  routing: MeetingRoutingPolicy;
  lifecycle: MeetingRuleLifecycle;
  notifications: MeetingRuleNotifications;
};

export type MeetingRulePreview = {
  matchCount: number;
  groupCount: number;
  samples: Array<{
    sourceId: string;
    title: string;
    generatedTitle: string;
    groupKey: string;
    routeLabel: string;
  }>;
  conflicts: number;
};

export type MeetingDashboardData = {
  upcoming: Array<Record<string, unknown>>;
  metrics: {
    meetingsThisMonth: number;
    openQuestions: number;
    unassignedQuestions: number;
    controlledQuestions: number;
  };
  list: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  templates: MeetingTemplate[];
};
