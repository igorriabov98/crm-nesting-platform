import assert from "node:assert/strict";
import test from "node:test";
import { buildMeetingOccurrenceDates } from "./schedule";

test("weekly schedule supports several weekdays", () => {
  assert.deepEqual(
    buildMeetingOccurrenceDates(
      {
        recurrenceKind: "weekly",
        startDate: "2026-09-07",
        endDate: "2026-09-18",
        weekdays: [1, 3, 5],
      },
      90,
    ),
    [
      "2026-09-07",
      "2026-09-09",
      "2026-09-11",
      "2026-09-14",
      "2026-09-16",
      "2026-09-18",
    ],
  );
});

test("monthly day 31 uses the last day of shorter months", () => {
  assert.deepEqual(
    buildMeetingOccurrenceDates(
      {
        recurrenceKind: "monthly",
        startDate: "2026-01-31",
        endDate: "2026-04-30",
        monthDay: 31,
      },
      120,
    ),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
  );
});

test("an endless schedule is bounded to the rolling horizon", () => {
  const dates = buildMeetingOccurrenceDates(
    { recurrenceKind: "interval", startDate: "2026-09-01", intervalDays: 1 },
    90,
  );
  assert.equal(dates[0], "2026-09-01");
  assert.equal(dates.at(-1), "2026-11-30");
  assert.equal(dates.length, 91);
});
