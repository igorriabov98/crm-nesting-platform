import { z } from "zod";
import { MEETING_SOURCE_BY_KEY } from "./catalog";
import type {
  MeetingCondition,
  MeetingConditionGroup,
  MeetingRuleDsl,
  MeetingSourceRecord,
} from "./types";

const operatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "before_today",
  "after_today",
  "days_ago_gte",
  "days_until_lte",
  "business_days_elapsed",
  "after_field",
  "before_field",
  "changed",
  "changed_from",
  "changed_to",
]);

export const meetingConditionSchema = z.object({
  field: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  operator: operatorSchema,
  value: z.unknown().optional(),
});

export const meetingConditionGroupSchema = z.object({
  logic: z.enum(["and", "or"]),
  conditions: z.array(meetingConditionSchema).min(1).max(20),
});

export const meetingRuleDslSchema = z.object({
  logic: z.enum(["and", "or"]),
  conditions: z
    .array(z.union([meetingConditionSchema, meetingConditionGroupSchema]))
    .min(1)
    .max(20),
  aggregate: z
    .object({
      operation: z.enum(["count", "sum", "min", "max"]),
      field: z.string().max(80).optional(),
      operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
      value: z.number().finite(),
    })
    .optional(),
});

export function validateMeetingRuleDsl(
  sourceKey: string,
  input: unknown,
): MeetingRuleDsl {
  const source = MEETING_SOURCE_BY_KEY[sourceKey];
  if (!source) throw new Error("Выберите доступный источник данных");
  const dsl = meetingRuleDslSchema.parse(input);
  const fields = new Map(source.fields.map((field) => [field.key, field]));
  const conditions = dsl.conditions.flatMap((item) =>
    "field" in item ? [item] : item.conditions,
  );
  for (const condition of conditions) {
    const field = fields.get(condition.field);
    if (!field)
      throw new Error(
        `Поле «${condition.field}» недоступно для этого источника`,
      );
    if (!field.operators.includes(condition.operator)) {
      throw new Error(
        `Оператор «${condition.operator}» недоступен для поля «${field.label}»`,
      );
    }
    if (
      (condition.operator === "after_field" ||
        condition.operator === "before_field") &&
      typeof condition.value === "string" &&
      !fields.has(condition.value)
    ) {
      throw new Error("Поле для сравнения недоступно в выбранном источнике");
    }
  }
  if (dsl.aggregate?.field && !fields.has(dsl.aggregate.field)) {
    throw new Error("Поле агрегата недоступно в выбранном источнике");
  }
  return dsl as MeetingRuleDsl;
}

const MEETING_TIMEZONE = "Europe/Uzhgorod";

function dateOnly(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function zonedParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MEETING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(value)
    .reduce<Record<string, number>>((result, part) => {
      if (part.type !== "literal") result[part.type] = Number(part.value);
      return result;
    }, {});
  return parts;
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const represented = zonedParts(new Date(guess));
  const representedUtc = Date.UTC(
    represented.year,
    represented.month - 1,
    represented.day,
    represented.hour,
    represented.minute,
    represented.second,
  );
  return new Date(guess - (representedUtc - guess));
}

function todayInMeetingTimezone(now: Date) {
  const parts = zonedParts(now);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0);
}

export function businessDaysElapsed(
  value: unknown,
  days: number,
  now = new Date(),
) {
  const start = dateOnly(value);
  if (!start || days < 0) return false;
  const localStart = zonedParts(start);
  const cursor = new Date(
    Date.UTC(localStart.year, localStart.month - 1, localStart.day),
  );
  let remaining = days;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  const threshold = zonedDateTimeToUtc(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth() + 1,
    cursor.getUTCDate(),
    localStart.hour,
    localStart.minute,
    localStart.second,
  );
  return now.getTime() >= threshold.getTime();
}

function compareNumber(
  left: unknown,
  right: unknown,
  operator: "gt" | "gte" | "lt" | "lte" | "eq",
) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (operator === "gt") return a > b;
  if (operator === "gte") return a >= b;
  if (operator === "lt") return a < b;
  if (operator === "lte") return a <= b;
  return a === b;
}

export function evaluateMeetingCondition(
  condition: MeetingCondition,
  record: MeetingSourceRecord,
  now = new Date(),
) {
  const current = record.values[condition.field];
  const previous = record.previousValues?.[condition.field];
  const value = condition.value;
  switch (condition.operator) {
    case "eq":
      return current === value || String(current ?? "") === String(value ?? "");
    case "neq":
      return !(
        current === value || String(current ?? "") === String(value ?? "")
      );
    case "in":
      return (
        Array.isArray(value) &&
        value.some((item) => String(item) === String(current))
      );
    case "not_in":
      return (
        Array.isArray(value) &&
        !value.some((item) => String(item) === String(current))
      );
    case "is_empty":
      return current === null || current === undefined || current === "";
    case "is_not_empty":
      return current !== null && current !== undefined && current !== "";
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return compareNumber(current, value, condition.operator);
    case "contains":
      return String(current ?? "")
        .toLocaleLowerCase("ru")
        .includes(String(value ?? "").toLocaleLowerCase("ru"));
    case "before_today": {
      const date = dateOnly(current);
      return Boolean(date && date < todayInMeetingTimezone(now));
    }
    case "after_today": {
      const date = dateOnly(current);
      return Boolean(date && date > todayInMeetingTimezone(now));
    }
    case "days_ago_gte": {
      const date = dateOnly(current);
      return Boolean(
        date && now.getTime() - date.getTime() >= Number(value) * 86_400_000,
      );
    }
    case "days_until_lte": {
      const date = dateOnly(current);
      return Boolean(
        date && date.getTime() - now.getTime() <= Number(value) * 86_400_000,
      );
    }
    case "business_days_elapsed":
      return businessDaysElapsed(current, Number(value), now);
    case "after_field": {
      const left = dateOnly(current);
      const right = dateOnly(record.values[String(value)]);
      return Boolean(left && right && left > right);
    }
    case "before_field": {
      const left = dateOnly(current);
      const right = dateOnly(record.values[String(value)]);
      return Boolean(left && right && left < right);
    }
    case "changed":
      return previous !== undefined && current !== previous;
    case "changed_from":
      return (
        previous !== undefined &&
        String(previous) === String(value) &&
        current !== previous
      );
    case "changed_to":
      return (
        previous !== undefined &&
        String(current) === String(value) &&
        current !== previous
      );
  }
}

function isGroup(
  value: MeetingCondition | MeetingConditionGroup,
): value is MeetingConditionGroup {
  return "logic" in value;
}

export function evaluateMeetingRuleDsl(
  dsl: MeetingRuleDsl,
  record: MeetingSourceRecord,
  now = new Date(),
) {
  const results = dsl.conditions.map((item) => {
    if (!isGroup(item)) return evaluateMeetingCondition(item, record, now);
    const values = item.conditions.map((condition) =>
      evaluateMeetingCondition(condition, record, now),
    );
    return item.logic === "and" ? values.every(Boolean) : values.some(Boolean);
  });
  return dsl.logic === "and" ? results.every(Boolean) : results.some(Boolean);
}

export function applyAggregateRule(
  dsl: MeetingRuleDsl,
  records: MeetingSourceRecord[],
) {
  if (!dsl.aggregate) return records.length > 0;
  const values =
    dsl.aggregate.operation === "count"
      ? [records.length]
      : records
          .map((record) => Number(record.values[dsl.aggregate?.field || ""]))
          .filter(Number.isFinite);
  const result =
    dsl.aggregate.operation === "count"
      ? records.length
      : dsl.aggregate.operation === "sum"
        ? values.reduce((sum, value) => sum + value, 0)
        : dsl.aggregate.operation === "min"
          ? Math.min(...values)
          : Math.max(...values);
  return compareNumber(result, dsl.aggregate.value, dsl.aggregate.operator);
}

export function renderMeetingTemplate(
  template: string,
  values: Record<string, unknown>,
) {
  return template.replace(/\{([^{}]+)\}/g, (_, token: string) => {
    const value = values[token];
    if (value === null || value === undefined || value === "")
      return "Не назначен";
    return String(value);
  });
}

export function buildMeetingGroupKey(
  fields: string[],
  record: MeetingSourceRecord,
) {
  if (fields.length === 0) return record.key;
  return fields
    .map((field) => `${field}:${String(record.values[field] ?? "none")}`)
    .join("|");
}
