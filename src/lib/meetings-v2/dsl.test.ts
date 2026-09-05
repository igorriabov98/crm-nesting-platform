import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAggregateRule,
  buildMeetingGroupKey,
  businessDaysElapsed,
  evaluateMeetingRuleDsl,
  renderMeetingTemplate,
  validateMeetingRuleDsl,
} from "./dsl";
import type { MeetingSourceRecord } from "./types";

const record: MeetingSourceRecord = {
  key: "tasks:1",
  id: "1",
  title: "Проверить поставку",
  url: "/tasks",
  values: {
    status: "pending",
    deadline: "2026-09-04",
    responsible_user_id: "user-1",
    factory_id: "factory-1",
    Ответственный: "Иван Петров",
  },
};

test("DSL accepts only whitelisted business fields and operators", () => {
  assert.doesNotThrow(() =>
    validateMeetingRuleDsl("tasks", {
      logic: "and",
      conditions: [{ field: "status", operator: "eq", value: "pending" }],
    }),
  );
  assert.throws(
    () =>
      validateMeetingRuleDsl("tasks", {
        logic: "and",
        conditions: [{ field: "salary", operator: "gt", value: 1 }],
      }),
    /недоступно/,
  );
  assert.throws(
    () =>
      validateMeetingRuleDsl("tasks", {
        logic: "and",
        conditions: [
          { field: "deadline", operator: "contains", value: "2026" },
        ],
      }),
    /недоступен/,
  );
});

test("advanced condition groups evaluate as (A AND B) OR (C AND D)", () => {
  const dsl = validateMeetingRuleDsl("tasks", {
    logic: "or",
    conditions: [
      {
        logic: "and",
        conditions: [
          { field: "status", operator: "eq", value: "pending" },
          { field: "deadline", operator: "before_today" },
        ],
      },
      {
        logic: "and",
        conditions: [
          { field: "status", operator: "eq", value: "in_progress" },
          { field: "deadline", operator: "is_empty" },
        ],
      },
    ],
  });
  assert.equal(
    evaluateMeetingRuleDsl(dsl, record, new Date("2026-09-05T10:00:00+03:00")),
    true,
  );
});

test("one business day from Friday 14:00 expires Monday 14:00 in Europe/Uzhgorod", () => {
  const friday = "2026-09-04T14:00:00+03:00";
  assert.equal(
    businessDaysElapsed(friday, 1, new Date("2026-09-07T13:59:59+03:00")),
    false,
  );
  assert.equal(
    businessDaysElapsed(friday, 1, new Date("2026-09-07T14:00:00+03:00")),
    true,
  );
});

test("templates and group keys are deterministic", () => {
  assert.equal(
    renderMeetingTemplate("Просрочка: {Ответственный} — {Количество}", {
      Ответственный: "Иван Петров",
      Количество: 3,
    }),
    "Просрочка: Иван Петров — 3",
  );
  assert.equal(
    buildMeetingGroupKey(["factory_id", "responsible_user_id"], record),
    "factory_id:factory-1|responsible_user_id:user-1",
  );
});

test("field-change operators use the previous persisted value", () => {
  const changedRecord: MeetingSourceRecord = {
    ...record,
    values: { ...record.values, status: "in_progress" },
    previousValues: { status: "pending" },
  };

  assert.equal(
    evaluateMeetingRuleDsl(
      {
        logic: "and",
        conditions: [
          { field: "status", operator: "changed_from", value: "pending" },
          {
            field: "status",
            operator: "changed_to",
            value: "in_progress",
          },
        ],
      },
      changedRecord,
    ),
    true,
  );
});

test("aggregate thresholds are evaluated against each prepared group", () => {
  const dsl = {
    logic: "and" as const,
    conditions: [
      { field: "status", operator: "eq" as const, value: "pending" },
    ],
    aggregate: {
      operation: "sum" as const,
      field: "amount",
      operator: "gte" as const,
      value: 10,
    },
  };
  const group = [
    { ...record, id: "1", values: { ...record.values, amount: 4 } },
    { ...record, id: "2", values: { ...record.values, amount: 6 } },
  ];

  assert.equal(applyAggregateRule(dsl, group), true);
  assert.equal(applyAggregateRule(dsl, group.slice(0, 1)), false);
});
