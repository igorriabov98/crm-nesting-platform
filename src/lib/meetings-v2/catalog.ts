import type { MeetingConditionOperator, MeetingRuleTriggerType } from "./types";

export type MeetingSourceField = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "datetime" | "boolean" | "enum" | "uuid";
  operators: MeetingConditionOperator[];
  options?: Array<{ value: string; label: string }>;
};

export type MeetingSourceDefinition = {
  key: string;
  label: string;
  description: string;
  resourceKey: string;
  triggers: MeetingRuleTriggerType[];
  fields: MeetingSourceField[];
  tokens: Array<{ key: string; label: string }>;
};

const COMMON_TEXT: MeetingConditionOperator[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "is_empty",
  "is_not_empty",
  "changed",
  "changed_from",
  "changed_to",
];
const COMMON_DATE: MeetingConditionOperator[] = [
  "eq",
  "neq",
  "is_empty",
  "is_not_empty",
  "before_today",
  "after_today",
  "days_ago_gte",
  "days_until_lte",
  "business_days_elapsed",
  "after_field",
  "before_field",
  "changed",
];
const COMMON_NUMBER: MeetingConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "changed",
];

export const MEETING_SOURCE_CATALOG: MeetingSourceDefinition[] = [
  {
    key: "tasks",
    label: "Задачи",
    description: "Открытые задачи, сроки, типы и ответственные.",
    resourceKey: "tasks",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "status",
        label: "Статус",
        type: "enum",
        operators: COMMON_TEXT,
        options: [
          { value: "pending", label: "Ожидает" },
          { value: "in_progress", label: "В работе" },
          { value: "completed", label: "Выполнена" },
          { value: "cancelled", label: "Отменена" },
        ],
      },
      { key: "deadline", label: "Срок", type: "date", operators: COMMON_DATE },
      {
        key: "task_type",
        label: "Тип задачи",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "responsible_user_id",
        label: "Ответственный",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty", "changed"],
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
      {
        key: "created_at",
        label: "Дата создания",
        type: "datetime",
        operators: COMMON_DATE,
      },
    ],
    tokens: [
      { key: "Ответственный", label: "Ответственный" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
      { key: "Тип", label: "Тип задачи" },
    ],
  },
  {
    key: "department_requests",
    label: "Запросы отделам",
    description: "Запросы технологу, снабжению и производству.",
    resourceKey: "department_requests",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "status",
        label: "Статус",
        type: "enum",
        operators: COMMON_TEXT,
        options: [
          { value: "new", label: "Новый" },
          { value: "in_progress", label: "В работе" },
          { value: "done", label: "Решён" },
          { value: "rejected", label: "Отклонён" },
          { value: "cancelled", label: "Отменён" },
        ],
      },
      {
        key: "created_at",
        label: "Создан",
        type: "datetime",
        operators: COMMON_DATE,
      },
      {
        key: "due_date",
        label: "Желаемый срок",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "target_department",
        label: "Целевой отдел",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "assigned_to",
        label: "Исполнитель",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty", "changed"],
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Отдел", label: "Целевой отдел" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
    ],
  },
  {
    key: "consumable_requests",
    label: "Надобности производства",
    description: "Заявки производства на расходники и их получение.",
    resourceKey: "supply_consumable_requests",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      { key: "status", label: "Статус", type: "enum", operators: COMMON_TEXT },
      {
        key: "need_by_date",
        label: "Нужно до",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "remaining_quantity",
        label: "Осталось получить",
        type: "number",
        operators: COMMON_NUMBER,
      },
      {
        key: "priority",
        label: "Приоритет",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество заявок" },
      { key: "Остаток", label: "Остаток" },
    ],
  },
  {
    key: "supply_materials",
    label: "Материалы и графики поставки",
    description: "Плановые даты, графики, остатки и фактическое получение.",
    resourceKey: "supply_orders",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "planned_material_date",
        label: "Желаемая дата производства (Мат.план)",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "promised_delivery_date",
        label: "Обещанная дата поставки",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "remaining_quantity",
        label: "Осталось получить",
        type: "number",
        operators: COMMON_NUMBER,
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
      {
        key: "supplier_id",
        label: "Поставщик",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Машина", label: "Машина" },
      { key: "Материал", label: "Материал" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество позиций" },
      { key: "Желаемая дата производства", label: "Мат.план" },
    ],
  },
  {
    key: "machines",
    label: "Машины и заказы",
    description: "Карточки машин, заводы, материалы и ключевые даты.",
    resourceKey: "sales_plan",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "status",
        label: "Статус машины",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty", "changed"],
      },
      {
        key: "material_type",
        label: "Тип материала",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "planned_material_date",
        label: "Мат.план",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "desired_shipping_date",
        label: "Желаемая отгрузка",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "actual_shipping_date",
        label: "Фактическая отгрузка",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "production_month",
        label: "Месяц производства",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "production_workshop",
        label: "Цех производства",
        type: "number",
        operators: COMMON_NUMBER,
      },
      {
        key: "production_queue_number",
        label: "Очередь производства",
        type: "number",
        operators: COMMON_NUMBER,
      },
      {
        key: "is_archived",
        label: "В архиве",
        type: "boolean",
        operators: ["eq", "neq", "changed"],
      },
    ],
    tokens: [
      { key: "Машина", label: "Машина" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
    ],
  },
  {
    key: "production_stages",
    label: "Производственный план и факт",
    description: "Этапы, интервалы, сроки и факт производства.",
    resourceKey: "production",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "machine_id",
        label: "Машина",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
      {
        key: "stage_type",
        label: "Этап",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "planned_date_start",
        label: "Плановое начало",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "planned_date_end",
        label: "Плановое завершение",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "actual_date_end",
        label: "Фактическое завершение",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "is_skipped",
        label: "Этап пропущен",
        type: "boolean",
        operators: ["eq", "neq", "changed"],
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Машина", label: "Машина" },
      { key: "Этап", label: "Этап" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
    ],
  },
  {
    key: "inventory",
    label: "Склад и перемещения",
    description: "Остатки, резервы, получения и межзаводские перемещения.",
    resourceKey: "inventory",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "quantity",
        label: "Количество",
        type: "number",
        operators: COMMON_NUMBER,
      },
      {
        key: "remaining_quantity",
        label: "Осталось получить",
        type: "number",
        operators: COMMON_NUMBER,
      },
      { key: "status", label: "Статус", type: "enum", operators: COMMON_TEXT },
      {
        key: "expected_arrival_date",
        label: "Ожидаемое прибытие",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Машина", label: "Машина" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
    ],
  },
  {
    key: "outsourcing_transport",
    label: "Аутсорсинг и транспорт",
    description: "Операции аутсорсинга, возвраты и транспортные надобности.",
    resourceKey: "supply_transport",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      { key: "status", label: "Статус", type: "enum", operators: COMMON_TEXT },
      {
        key: "needed_date",
        label: "Требуемая дата",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "planned_return_date",
        label: "Плановый возврат",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "actual_returned_at",
        label: "Фактический возврат",
        type: "datetime",
        operators: COMMON_DATE,
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Машина", label: "Машина" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
    ],
  },
  {
    key: "people",
    label: "Сотрудники и назначения",
    description:
      "Назначения, ставки и отпуска без персональных и зарплатных данных.",
    resourceKey: "production",
    triggers: ["record_state", "relative_time", "field_change", "aggregate"],
    fields: [
      {
        key: "assignment_status",
        label: "Статус назначения",
        type: "enum",
        operators: COMMON_TEXT,
      },
      {
        key: "start_date",
        label: "Дата начала",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "end_date",
        label: "Дата окончания",
        type: "date",
        operators: COMMON_DATE,
      },
      {
        key: "factory_id",
        label: "Завод",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
      {
        key: "department_id",
        label: "Отдел",
        type: "uuid",
        operators: ["eq", "neq", "in", "is_empty", "is_not_empty"],
      },
    ],
    tokens: [
      { key: "Сотрудник", label: "Сотрудник" },
      { key: "Завод", label: "Завод" },
      { key: "Количество", label: "Количество" },
    ],
  },
];

export const MEETING_SOURCE_BY_KEY = Object.fromEntries(
  MEETING_SOURCE_CATALOG.map((source) => [source.key, source]),
);

export const OPERATOR_LABELS: Record<MeetingConditionOperator, string> = {
  eq: "равно",
  neq: "не равно",
  in: "входит в список",
  not_in: "не входит в список",
  is_empty: "не заполнено",
  is_not_empty: "заполнено",
  gt: "больше",
  gte: "больше или равно",
  lt: "меньше",
  lte: "меньше или равно",
  contains: "содержит",
  before_today: "раньше сегодня",
  after_today: "позже сегодня",
  days_ago_gte: "прошло не менее дней",
  days_until_lte: "осталось не более дней",
  business_days_elapsed: "прошло рабочих дней",
  after_field: "позже другого поля",
  before_field: "раньше другого поля",
  changed: "изменилось",
  changed_from: "изменилось с",
  changed_to: "изменилось на",
};
