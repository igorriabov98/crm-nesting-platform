import type { MeetingRecurrenceKind } from "./types";

export type ScheduleInput = {
  recurrenceKind: MeetingRecurrenceKind;
  startDate: string;
  endDate?: string | null;
  occurrenceCount?: number | null;
  weekdays?: number[];
  monthDay?: number | null;
  intervalDays?: number | null;
};

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isoWeekday(value: Date) {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

export function buildMeetingOccurrenceDates(
  input: ScheduleInput,
  horizonDays = 90,
) {
  const start = parseDate(input.startDate);
  const hardHorizon = new Date(start);
  hardHorizon.setUTCDate(hardHorizon.getUTCDate() + Math.max(1, horizonDays));
  const configuredEnd = input.endDate ? parseDate(input.endDate) : null;
  const end =
    configuredEnd && configuredEnd < hardHorizon ? configuredEnd : hardHorizon;
  const limit = Math.min(Math.max(input.occurrenceCount || 520, 1), 520);
  const result: string[] = [];

  if (input.recurrenceKind === "one_time") return [input.startDate];

  const cursor = new Date(start);
  while (cursor <= end && result.length < limit) {
    const daysFromStart = Math.floor(
      (cursor.getTime() - start.getTime()) / 86_400_000,
    );
    const matches =
      input.recurrenceKind === "weekly"
        ? (input.weekdays || [isoWeekday(start)]).includes(isoWeekday(cursor))
        : input.recurrenceKind === "monthly"
          ? cursor.getUTCDate() ===
            Math.min(
              input.monthDay || start.getUTCDate(),
              new Date(
                Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
              ).getUTCDate(),
            )
          : daysFromStart % Math.max(input.intervalDays || 1, 1) === 0;
    if (matches) result.push(formatDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function addMinutesToTime(value: string, minutes: number) {
  const [hours, minute] = value.split(":").map(Number);
  const total = hours * 60 + minute + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
