import "server-only";

import type { MeetingSourceRecord } from "./types";

type DbError = { message?: string } | null;
type DbResult = { data: unknown; error: DbError; count?: number | null };
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: Record<string, unknown>) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  in: (column: string, values: unknown[]) => LooseQuery;
  is: (column: string, value: unknown) => LooseQuery;
  order: (column: string, options?: Record<string, unknown>) => LooseQuery;
  limit: (count: number) => LooseQuery;
};
export type MeetingRulesDb = { from: (table: string) => LooseQuery };

type SourceLoadOptions = { sourceId?: string | null; limit?: number };

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function ensureResult(result: DbResult, label: string) {
  if (result.error)
    throw new Error(`${label}: ${result.error.message || "ошибка чтения"}`);
  return Array.isArray(result.data)
    ? (result.data as Record<string, unknown>[])
    : [];
}

async function loadTasks(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("tasks")
    .select(
      `
    id, title, description, status, deadline, task_type, assigned_to, machine_id, created_at,
    assignee:users!tasks_assigned_to_fkey(id, full_name),
    machine:machines(id, name, factory_id)
  `,
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const rows = ensureResult(await query, "Не удалось загрузить задачи");
  return rows.map((row) => {
    const machine = relation(
      row.machine as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const assignee = relation(
      row.assignee as
        Record<string, unknown> | Record<string, unknown>[] | null,
    );
    return {
      key: `tasks:${row.id}`,
      id: String(row.id),
      title: String(row.title || "Задача"),
      url: "/tasks",
      values: {
        status: row.status,
        deadline: row.deadline,
        task_type: row.task_type,
        responsible_user_id: row.assigned_to,
        factory_id: machine?.factory_id || null,
        created_at: row.created_at,
        Ответственный: assignee?.full_name || "Не назначен",
        Завод: machine?.factory_id || "Не назначен",
        Тип: row.task_type || "Задача",
      },
      factoryId: String(machine?.factory_id || "") || null,
      responsibleUserId: String(row.assigned_to || "") || null,
      deadline: String(row.deadline || "") || null,
    };
  });
}

async function loadDepartmentRequests(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("department_requests")
    .select(
      "id, title, status, created_at, due_date, target_department, assigned_to, factory_id, machine_id",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const rows = ensureResult(
    await query,
    "Не удалось загрузить запросы отделам",
  );
  const departmentLabels: Record<string, string> = {
    technologist: "Технолог",
    supply: "Снабжение",
    production: "Производство",
  };
  return rows.map((row) => ({
    key: `department_requests:${row.id}`,
    id: String(row.id),
    title: String(row.title || "Запрос"),
    url: `/requests?request=${row.id}`,
    values: {
      status: row.status,
      created_at: row.created_at,
      due_date: row.due_date,
      target_department: row.target_department,
      assigned_to: row.assigned_to,
      factory_id: row.factory_id,
      Отдел:
        departmentLabels[String(row.target_department)] ||
        row.target_department ||
        "Не назначен",
      Завод: row.factory_id || "Не назначен",
    },
    factoryId: String(row.factory_id || "") || null,
    responsibleUserId: String(row.assigned_to || "") || null,
    deadline: String(row.due_date || "") || null,
  }));
}

async function loadConsumableRequests(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("consumable_requests")
    .select(
      "id, factory_id, consumable_id, status, priority, requested_quantity, received_quantity, need_by_date, created_at, consumable:consumables(name)",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const rows = ensureResult(
    await query,
    "Не удалось загрузить надобности производства",
  );
  return rows.map((row) => {
    const consumable = relation(
      row.consumable as
        Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const remaining = Math.max(
      Number(row.requested_quantity || 0) - Number(row.received_quantity || 0),
      0,
    );
    return {
      key: `consumable_requests:${row.id}`,
      id: String(row.id),
      title: String(consumable?.name || "Надобность производства"),
      url: `/supply/production-requests?request=${row.id}`,
      values: {
        status: row.status,
        need_by_date: row.need_by_date,
        remaining_quantity: remaining,
        priority: row.priority,
        factory_id: row.factory_id,
        Завод: row.factory_id || "Не назначен",
        Остаток: remaining,
      },
      factoryId: String(row.factory_id || "") || null,
      deadline: String(row.need_by_date || "") || null,
    };
  });
}

const SUPPLY_ITEM_TABLES = [
  "request_sheet_metal",
  "request_round_tube",
  "request_circle",
  "request_pipe",
  "request_knives",
  "request_components",
  "request_paint",
  "request_mesh",
  "request_chain_cord",
] as const;

async function loadSupplyMaterials(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  const requests = ensureResult(
    await db
      .from("technologist_requests")
      .select(
        "id, machine_id, status, machine:machines(id, name, factory_id, planned_material_date, is_archived)",
      )
      .in("status", ["submitted_to_supply", "completed"])
      .limit(options.limit || 10_000),
    "Не удалось загрузить заявки на материалы",
  );
  const requestMap = new Map(requests.map((row) => [String(row.id), row]));
  if (requestMap.size === 0) return [];

  const itemGroups = await Promise.all(
    SUPPLY_ITEM_TABLES.map(async (table) => {
      const result = await db
        .from(table)
        .select("id, request_id, order_status, delivered_at")
        .in("request_id", [...requestMap.keys()])
        .limit(options.limit || 10_000);
      if (result.error) return [];
      return (Array.isArray(result.data) ? result.data : []).map(
        (row) =>
          ({ table, ...(row as Record<string, unknown>) }) as Record<
            string,
            unknown
          > & { table: string },
      );
    }),
  );
  const items = itemGroups
    .flat()
    .filter(
      (item) => !options.sourceId || String(item.id) === options.sourceId,
    );
  if (items.length === 0) return [];
  const itemIds = items.map((item) => String(item.id));
  const schedulesResult = await db
    .from("supply_order_delivery_schedules")
    .select(
      "id, request_item_table, request_item_id, delivery_date, quantity, received_quantity, status, supplier_id",
    )
    .in("request_item_id", itemIds)
    .limit(Math.max(options.limit || 10_000, itemIds.length * 4));
  const schedules = schedulesResult.error
    ? []
    : Array.isArray(schedulesResult.data)
      ? (schedulesResult.data as Record<string, unknown>[])
      : [];
  const scheduleMap = new Map<string, Record<string, unknown>[]>();
  for (const schedule of schedules) {
    if (String(schedule.status || "") === "cancelled") continue;
    const key = `${schedule.request_item_table}:${schedule.request_item_id}`;
    scheduleMap.set(key, [...(scheduleMap.get(key) || []), schedule]);
  }

  return items.map((item) => {
    const request = requestMap.get(String(item.request_id));
    const machine = relation(
      request?.machine as
        Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const itemSchedules = scheduleMap.get(`${item.table}:${item.id}`) || [];
    const promised =
      itemSchedules
        .map((schedule) => String(schedule.delivery_date || ""))
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    const scheduledRemaining = itemSchedules.reduce(
      (sum, schedule) =>
        sum +
        Math.max(
          Number(schedule.quantity || 0) -
            Number(schedule.received_quantity || 0),
          0,
        ),
      0,
    );
    const remaining =
      itemSchedules.length > 0
        ? scheduledRemaining
        : String(item.order_status || "") === "delivered"
          ? 0
          : 1;
    const machineName = String(machine?.name || "Машина");
    return {
      key: `supply_materials:${item.table}:${item.id}`,
      id: `${item.table}:${item.id}`,
      title: `${machineName} · материал`,
      url: `/supply/orders?view=details&request=${item.request_id}`,
      values: {
        planned_material_date: machine?.planned_material_date || null,
        promised_delivery_date: promised,
        remaining_quantity: remaining,
        factory_id: machine?.factory_id || null,
        supplier_id: itemSchedules[0]?.supplier_id || null,
        Машина: machineName,
        Материал: "Материал",
        Завод: machine?.factory_id || "Не назначен",
        "Желаемая дата производства":
          machine?.planned_material_date || "Не назначена",
      },
      factoryId: String(machine?.factory_id || "") || null,
      deadline: String(machine?.planned_material_date || "") || null,
    };
  });
}

async function loadMachines(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("machines")
    .select(
      "id, name, status, factory_id, material_type, planned_material_date, desired_shipping_date, actual_shipping_date, production_month, production_workshop, production_queue_number, is_archived, created_at",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const rows = ensureResult(await query, "Не удалось загрузить машины");
  return rows.map((row) => ({
    key: `machines:${row.id}`,
    id: String(row.id),
    title: String(row.name || "Машина"),
    url: `/sales-plan/${row.id}`,
    values: {
      ...row,
      Машина: row.name,
      Завод: row.factory_id || "Не назначен",
    },
    factoryId: String(row.factory_id || "") || null,
    deadline: String(row.planned_material_date || "") || null,
  }));
}

async function loadProductionStages(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("production_stages")
    .select(
      "id, machine_id, stage_type, date_start, date_end, planned_date_end, is_skipped, machine:machines(id, name, factory_id)",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const result = await query;
  if (result.error) return [];
  return ((result.data as Record<string, unknown>[]) || []).map((row) => {
    const machine = relation(
      row.machine as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    return {
      key: `production_stages:${row.id}`,
      id: String(row.id),
      title: `${machine?.name || "Машина"} · ${row.stage_type || "Этап"}`,
      url: `/production/gantt?machine=${row.machine_id}`,
      values: {
        stage_type: row.stage_type,
        machine_id: row.machine_id,
        planned_date_start: row.date_start,
        planned_date_end: row.planned_date_end,
        actual_date_end: row.date_end,
        is_skipped: row.is_skipped,
        factory_id: machine?.factory_id,
        Машина: machine?.name,
        Этап: row.stage_type,
        Завод: machine?.factory_id,
      },
      factoryId: String(machine?.factory_id || "") || null,
      deadline: String(row.planned_date_end || "") || null,
    };
  });
}

async function loadInventory(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("inventory_transfers")
    .select(
      "id, machine_id, source_factory_id, destination_factory_id, status, expected_arrival_date, created_at, machine:machines(id, name), items:inventory_transfer_items(id, material_id, requested_quantity, received_quantity)",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const result = await query;
  if (result.error) return [];
  return ((result.data as Record<string, unknown>[]) || []).map((row) => {
    const machine = relation(
      row.machine as Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const items = Array.isArray(row.items)
      ? (row.items as Record<string, unknown>[])
      : [];
    const requested = items.reduce(
      (total, item) => total + Number(item.requested_quantity || 0),
      0,
    );
    const received = items.reduce(
      (total, item) => total + Number(item.received_quantity || 0),
      0,
    );
    return {
      key: `inventory:${row.id}`,
      id: String(row.id),
      title: `Перемещение для ${machine?.name || "машины"}`,
      url: "/inventory",
      values: {
        quantity: requested,
        remaining_quantity: Math.max(requested - received, 0),
        status: row.status,
        expected_arrival_date: row.expected_arrival_date,
        factory_id: row.destination_factory_id,
        Машина: machine?.name,
        Завод: row.destination_factory_id,
      },
      factoryId: String(row.destination_factory_id || "") || null,
      deadline: String(row.expected_arrival_date || "") || null,
    };
  });
}

async function loadOutsourcingTransport(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let query = db
    .from("machine_outsourcing_transport_needs")
    .select(
      "id, status, needed_date, direction, operation_id, operation:machine_outsourcing_operations(id, planned_return_date, actual_returned_at, machine:machines(id, name, factory_id))",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) query = query.eq("id", options.sourceId);
  const result = await query;
  if (result.error) return [];
  return ((result.data as Record<string, unknown>[]) || []).map((row) => {
    const operation = relation(
      row.operation as
        Record<string, unknown> | Record<string, unknown>[] | null,
    );
    const machine = relation(
      operation?.machine as
        Record<string, unknown> | Record<string, unknown>[] | null,
    );
    return {
      key: `outsourcing_transport:${row.id}`,
      id: String(row.id),
      title: `${machine?.name || "Машина"} · транспорт аутсорсинга`,
      url: "/supply/transport",
      values: {
        status: row.status,
        needed_date: row.needed_date,
        planned_return_date: operation?.planned_return_date,
        actual_returned_at: operation?.actual_returned_at,
        factory_id: machine?.factory_id,
        Машина: machine?.name,
        Завод: machine?.factory_id,
      },
      factoryId: String(machine?.factory_id || "") || null,
      deadline: String(row.needed_date || "") || null,
    };
  });
}

async function loadPeople(
  db: MeetingRulesDb,
  options: SourceLoadOptions,
): Promise<MeetingSourceRecord[]> {
  let assignmentsQuery = db
    .from("employee_assignments")
    .select(
      "id, status, work_date, cancelled_at, employee:employees(id, full_name, factory_id, default_section_id)",
    )
    .limit(options.limit || 10_000);
  let vacationsQuery = db
    .from("employee_vacations")
    .select(
      "id, start_date, end_date, cancelled_at, employee:employees(id, full_name, factory_id, default_section_id)",
    )
    .limit(options.limit || 10_000);
  if (options.sourceId) {
    assignmentsQuery = assignmentsQuery.eq("id", options.sourceId);
    vacationsQuery = vacationsQuery.eq("id", options.sourceId);
  }
  const [assignmentsResult, vacationsResult] = await Promise.all([
    assignmentsQuery,
    vacationsQuery,
  ]);
  const records: MeetingSourceRecord[] = [];
  if (!assignmentsResult.error) {
    for (const row of (assignmentsResult.data as Record<string, unknown>[]) ||
      []) {
      const employee = relation(
        row.employee as
          Record<string, unknown> | Record<string, unknown>[] | null,
      );
      records.push({
        key: `people:assignment:${row.id}`,
        id: String(row.id),
        title: `${employee?.full_name || "Сотрудник"} · назначение`,
        url: "/production/people",
        values: {
          assignment_status: row.cancelled_at ? "cancelled" : row.status,
          start_date: row.work_date,
          end_date: row.work_date,
          factory_id: employee?.factory_id,
          department_id: employee?.default_section_id,
          Сотрудник: employee?.full_name,
          Завод: employee?.factory_id,
        },
        factoryId: String(employee?.factory_id || "") || null,
        departmentId: String(employee?.default_section_id || "") || null,
        deadline: String(row.work_date || "") || null,
      });
    }
  }
  if (!vacationsResult.error) {
    for (const row of (vacationsResult.data as Record<string, unknown>[]) ||
      []) {
      const employee = relation(
        row.employee as
          Record<string, unknown> | Record<string, unknown>[] | null,
      );
      records.push({
        key: `people:vacation:${row.id}`,
        id: String(row.id),
        title: `${employee?.full_name || "Сотрудник"} · отпуск`,
        url: "/production/people",
        values: {
          assignment_status: row.cancelled_at ? "cancelled" : "vacation",
          start_date: row.start_date,
          end_date: row.end_date,
          factory_id: employee?.factory_id,
          department_id: employee?.default_section_id,
          Сотрудник: employee?.full_name,
          Завод: employee?.factory_id,
        },
        factoryId: String(employee?.factory_id || "") || null,
        departmentId: String(employee?.default_section_id || "") || null,
        deadline: String(row.start_date || "") || null,
      });
    }
  }
  return records;
}

export async function loadMeetingSourceRecords(
  db: MeetingRulesDb,
  sourceKey: string,
  options: SourceLoadOptions = {},
) {
  if (sourceKey === "tasks") return loadTasks(db, options);
  if (sourceKey === "department_requests")
    return loadDepartmentRequests(db, options);
  if (sourceKey === "consumable_requests")
    return loadConsumableRequests(db, options);
  if (sourceKey === "supply_materials") return loadSupplyMaterials(db, options);
  if (sourceKey === "machines") return loadMachines(db, options);
  if (sourceKey === "production_stages")
    return loadProductionStages(db, options);
  if (sourceKey === "inventory") return loadInventory(db, options);
  if (sourceKey === "outsourcing_transport")
    return loadOutsourcingTransport(db, options);
  if (sourceKey === "people") return loadPeople(db, options);
  throw new Error("Источник данных недоступен");
}
