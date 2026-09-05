"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarClock,
  CirclePause,
  FileQuestion,
  GitBranch,
  History,
  Layers3,
  Plus,
  Rocket,
  Save,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  previewMeetingRuleV2,
  publishMeetingRuleV2,
  saveMeetingQuestionTemplateV2,
  saveMeetingRuleDraftV2,
  saveMeetingScheduleV2,
  saveMeetingTemplateV2,
  setMeetingRuleStatusV2,
  setMeetingSystemModeV2,
} from "@/app/(protected)/meetings/v2-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  MeetingConditionOperator,
  MeetingRuleDraft,
  MeetingRulePreview,
} from "@/lib/meetings-v2/types";
import type { MeetingSourceDefinition } from "@/lib/meetings-v2/catalog";
import { OPERATOR_LABELS } from "@/lib/meetings-v2/catalog";
import { ROLES } from "@/lib/constants/roles";
import { MeetingStatus } from "./MeetingStatus";

type SettingsData = {
  templates: Array<Record<string, unknown>>;
  questionTemplates: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  departments: Array<Record<string, unknown>>;
  factories: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  rolloutMode: "shadow" | "active";
  rolloutComparison: {
    legacyPoolOpen: number;
    openQuestions: number;
    pendingEvents: number;
    missingFutureTemplates: number;
  };
  rolloutEvents: Array<Record<string, unknown>>;
  sources: MeetingSourceDefinition[];
};

type Section = "meetings" | "questions" | "rules";
type ConditionRow = {
  id: string;
  group: 0 | 1;
  field: string;
  operator: MeetingConditionOperator;
  value: string;
};

type ParticipantDraft = {
  id: string;
  participantType: "user" | "role" | "department" | "external";
  userId?: string | null;
  role?: string | null;
  departmentId?: string | null;
  externalName?: string | null;
  externalRole?: string | null;
  externalEmail?: string | null;
  externalPhone?: string | null;
  isRequired: boolean;
};

const MEETING_CATEGORIES = [
  ["general", "Общие вопросы"],
  ["tasks", "Задачи"],
  ["requests", "Запросы отделам"],
  ["materials", "Материалы"],
  ["consumables", "Надобности производства"],
  ["production", "Производство"],
  ["shipping", "Отгрузка"],
  ["people", "Сотрудники"],
  ["inventory", "Склад"],
  ["transport", "Транспорт"],
] as const;

function categoryLabel(value: string) {
  return MEETING_CATEGORIES.find(([key]) => key === value)?.[1] || value;
}

function relation(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Record<
    string,
    unknown
  > | null;
}
function valueArray(value: unknown) {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export function MeetingSettingsWorkspace({
  data,
  canManageTemplates,
  canManageQuestions,
  canManageRules,
}: {
  data: SettingsData;
  canManageTemplates: boolean;
  canManageQuestions: boolean;
  canManageRules: boolean;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("meetings");
  const [switchingMode, startModeTransition] = useTransition();
  const rolloutActive = data.rolloutMode === "active";
  const canActivate = data.rolloutComparison.missingFutureTemplates === 0;
  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Settings2 className="h-4 w-4" /> Настройки → Совещания
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Конструктор совещаний и повесток
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Создавайте типы встреч и правила по бизнес-полям. SQL, таблицы и
          внутренний код в интерфейсе не используются.
        </p>
      </header>
      <Card
        className={
          rolloutActive ? "border-emerald-500/40" : "border-amber-500/40"
        }
      >
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Режим запуска</h2>
                <Badge variant={rolloutActive ? "default" : "secondary"}>
                  {rolloutActive ? "Новая система активна" : "Теневой режим"}
                </Badge>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {rolloutActive
                  ? "Вопросы формируются опубликованными правилами, старая автоматическая генерация отключена."
                  : "Старая генерация продолжает работать. Можно сверить перенесённые данные и правила перед переключением."}
              </p>
            </div>
            {canManageRules && (
              <Button
                className="min-h-11"
                variant={rolloutActive ? "outline" : "default"}
                disabled={switchingMode || (!rolloutActive && !canActivate)}
                onClick={() => {
                  const nextMode = rolloutActive ? "shadow" : "active";
                  const accepted = window.confirm(
                    rolloutActive
                      ? "Вернуть теневой режим и снова включить старую генерацию?"
                      : "Активировать новую систему и отключить старую генерацию повесток? Системные правила будут опубликованы.",
                  );
                  if (!accepted) return;
                  startModeTransition(async () => {
                    try {
                      await setMeetingSystemModeV2(nextMode);
                      toast.success(
                        nextMode === "active"
                          ? "Новая система совещаний активирована"
                          : "Включён теневой режим",
                      );
                      router.refresh();
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Не удалось переключить режим",
                      );
                    }
                  });
                }}
              >
                {rolloutActive ? <CirclePause /> : <Rocket />}
                {switchingMode
                  ? "Переключение…"
                  : rolloutActive
                    ? "Вернуть теневой режим"
                    : "Активировать новую систему"}
              </Button>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Открыто в старом пуле", data.rolloutComparison.legacyPoolOpen],
              ["Открыто в новом пуле", data.rolloutComparison.openQuestions],
              [
                "Событий ожидают проверки",
                data.rolloutComparison.pendingEvents,
              ],
              [
                "Будущих встреч без шаблона",
                data.rolloutComparison.missingFutureTemplates,
              ],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border bg-background p-3"
              >
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
          {!canActivate && !rolloutActive && (
            <div className="mt-3 flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Сначала привяжите все будущие встречи к шаблонам. До этого
              активация заблокирована.
            </div>
          )}
        </CardContent>
      </Card>
      <div
        className="grid gap-2 rounded-xl border bg-muted/30 p-2 sm:grid-cols-3"
        role="tablist"
      >
        {[
          {
            id: "meetings" as const,
            label: "Шаблоны совещаний",
            icon: CalendarClock,
            count: data.templates.length,
          },
          {
            id: "questions" as const,
            label: "Шаблоны вопросов",
            icon: FileQuestion,
            count: data.questionTemplates.length,
          },
          {
            id: "rules" as const,
            label: "Правила и триггеры",
            icon: GitBranch,
            count: data.rules.length,
          },
        ].map((item) => (
          <Button
            key={item.id}
            role="tab"
            aria-selected={section === item.id}
            variant={section === item.id ? "default" : "ghost"}
            className="min-h-12 justify-start"
            onClick={() => setSection(item.id)}
          >
            <item.icon /> {item.label}
            <Badge variant="secondary" className="ml-auto">
              {item.count}
            </Badge>
          </Button>
        ))}
      </div>
      {section === "meetings" && (
        <MeetingTemplatesCatalog data={data} canManage={canManageTemplates} />
      )}
      {section === "questions" && (
        <QuestionTemplatesCatalog data={data} canManage={canManageQuestions} />
      )}
      {section === "rules" && (
        <RulesCatalog data={data} canManage={canManageRules} />
      )}
    </div>
  );
}

function MeetingTemplatesCatalog({
  data,
  canManage,
}: {
  data: SettingsData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-3">
        {data.templates.map((template) => {
          const participants = valueArray(template.participants);
          const schedules = valueArray(template.schedule_versions).sort(
            (a, b) => Number(b.version_no) - Number(a.version_no),
          );
          const current = schedules[0];
          return (
            <Card key={String(template.id)}>
              <CardContent className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {String(template.name)}
                      </h2>
                      {Boolean(template.is_system) && (
                        <Badge variant="secondary">Системный</Badge>
                      )}
                      {template.is_active === false && (
                        <Badge variant="outline">Отключён</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {String(template.description || "Описание не задано")}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setEditing(template)}
                      >
                        Изменить
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setScheduleFor(template)}
                      >
                        <CalendarClock /> Расписание
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <Meta
                    label="Ведущий"
                    value={
                      data.users.find(
                        (user) => user.id === template.facilitator_user_id,
                      )?.full_name || "Не назначен"
                    }
                  />
                  <Meta label="Участники" value={participants.length} />
                  <Meta
                    label="Текущее расписание"
                    value={current ? scheduleLabel(current) : "Не задано"}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(Array.isArray(template.accepted_categories)
                    ? template.accepted_categories
                    : []
                  ).map((category) => (
                    <Badge variant="outline" key={String(category)}>
                      {categoryLabel(String(category))}
                    </Badge>
                  ))}
                  {Array.isArray(template.accepted_categories) &&
                    template.accepted_categories.length === 0 && (
                      <Badge variant="outline">Все категории</Badge>
                    )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {data.templates.length === 0 && (
          <EmptyState
            icon={CalendarClock}
            title="Нет шаблонов совещаний"
            text="Создайте первый тип встречи и назначьте ему расписание."
          />
        )}
      </div>
      <Card className="h-fit xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle className="text-base">Как работает шаблон</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Шаблон определяет ведущего, участников, область действия, категории
            вопросов и напоминания.
          </p>
          <p>
            Бессрочная серия создаётся окном на 90 дней; фоновая задача
            продлевает горизонт.
          </p>
          {canManage && (
            <Button className="min-h-11 w-full" onClick={() => setEditing({})}>
              <Plus /> Новый шаблон
            </Button>
          )}
        </CardContent>
      </Card>
      {editing && (
        <Overlay
          title={
            editing.id ? "Изменить шаблон совещания" : "Новый шаблон совещания"
          }
          close={() => setEditing(null)}
        >
          <MeetingTemplateForm
            item={editing}
            data={data}
            pending={pending}
            submit={(payload) =>
              startTransition(async () => {
                try {
                  await saveMeetingTemplateV2(payload);
                  toast.success("Шаблон сохранён");
                  setEditing(null);
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Не удалось сохранить шаблон",
                  );
                }
              })
            }
          />
        </Overlay>
      )}
      {scheduleFor && (
        <Overlay
          title={`Расписание · ${scheduleFor.name}`}
          close={() => setScheduleFor(null)}
        >
          <ScheduleForm
            templateId={String(scheduleFor.id)}
            pending={pending}
            submit={(payload) =>
              startTransition(async () => {
                try {
                  const result = await saveMeetingScheduleV2(payload);
                  toast.success(`Создано встреч: ${result.occurrences}`);
                  setScheduleFor(null);
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Не удалось сохранить расписание",
                  );
                }
              })
            }
          />
        </Overlay>
      )}
    </div>
  );
}

function MeetingTemplateForm({
  item,
  data,
  pending,
  submit,
}: {
  item: Record<string, unknown>;
  data: SettingsData;
  pending: boolean;
  submit: (payload: Parameters<typeof saveMeetingTemplateV2>[0]) => void;
}) {
  const initialParticipants = valueArray(item.participants).map(
    (participant): ParticipantDraft => ({
      id: String(participant.id || crypto.randomUUID()),
      participantType: String(
        participant.participant_type || "user",
      ) as ParticipantDraft["participantType"],
      userId: String(participant.user_id || "") || null,
      role: String(participant.role || "") || null,
      departmentId: String(participant.department_id || "") || null,
      externalName: String(participant.external_name || "") || null,
      externalRole: String(participant.external_role || "") || null,
      externalEmail: String(participant.external_email || "") || null,
      externalPhone: String(participant.external_phone || "") || null,
      isRequired: participant.is_required !== false,
    }),
  );
  const initialFixedIds = new Set(
    valueArray(item.fixed_questions).map((link) =>
      String(link.question_template_id),
    ),
  );
  const [participants, setParticipants] =
    useState<ParticipantDraft[]>(initialParticipants);
  const [categories, setCategories] = useState<string[]>(
    Array.isArray(item.accepted_categories)
      ? item.accepted_categories.map(String)
      : [],
  );
  const [fixedQuestionIds, setFixedQuestionIds] = useState<string[]>([
    ...initialFixedIds,
  ]);
  const [crmChannel, setCrmChannel] = useState(
    !Array.isArray(item.notification_channels) ||
      item.notification_channels.includes("crm"),
  );
  const [telegramChannel, setTelegramChannel] = useState(
    !Array.isArray(item.notification_channels) ||
      item.notification_channels.includes("telegram"),
  );

  function updateParticipant(id: string, patch: Partial<ParticipantDraft>) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant,
      ),
    );
  }

  return (
    <form
      className="space-y-4"
      action={(formData) =>
        submit({
          id: item.id ? String(item.id) : undefined,
          name: String(formData.get("name")),
          description: String(formData.get("description") || ""),
          scopeType: String(formData.get("scopeType") || "all") as "all",
          scopeId: String(formData.get("scopeId") || "") || null,
          facilitatorUserId: String(formData.get("facilitator") || "") || null,
          defaultDurationMinutes: Number(formData.get("duration")),
          acceptedCategories: categories,
          reminderOffsetsMinutes: String(formData.get("reminders") || "")
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value > 0),
          notificationChannels: [
            ...(crmChannel ? (["crm"] as const) : []),
            ...(telegramChannel ? (["telegram"] as const) : []),
          ],
          fallbackTemplateId:
            String(formData.get("fallbackTemplate") || "") || null,
          participants: participants.map((participant) =>
            participant.participantType === "user"
              ? {
                  ...participant,
                  role: null,
                  departmentId: null,
                  externalName: null,
                  externalRole: null,
                  externalEmail: null,
                  externalPhone: null,
                }
              : participant.participantType === "role"
                ? {
                    ...participant,
                    userId: null,
                    departmentId: null,
                    externalName: null,
                    externalRole: null,
                    externalEmail: null,
                    externalPhone: null,
                  }
                : participant.participantType === "department"
                  ? {
                      ...participant,
                      userId: null,
                      role: null,
                      externalName: null,
                      externalRole: null,
                      externalEmail: null,
                      externalPhone: null,
                    }
                  : {
                      ...participant,
                      userId: null,
                      role: null,
                      departmentId: null,
                    },
          ),
          fixedQuestionTemplateIds: fixedQuestionIds,
        })
      }
    >
      <Field label="Название" name="name" defaultValue={item.name} required />
      <div>
        <Label htmlFor="template-description">Описание</Label>
        <Textarea
          id="template-description"
          name="description"
          defaultValue={String(item.description || "")}
          className="mt-1"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NativeSelect
          label="Область действия"
          name="scopeType"
          defaultValue={String(item.scope_type || "all")}
          options={[
            ["all", "Вся компания"],
            ["factory", "Конкретный завод"],
            ["department", "Конкретный отдел"],
            ["custom", "Настраиваемая область"],
          ]}
        />
        <div>
          <Label>Завод или отдел</Label>
          <select
            name="scopeId"
            defaultValue={String(item.scope_id || "")}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Не ограничивать</option>
            <optgroup label="Заводы">
              {data.factories.map((value) => (
                <option key={String(value.id)} value={String(value.id)}>
                  {String(value.name)}
                </option>
              ))}
            </optgroup>
            <optgroup label="Отделы">
              {data.departments.map((value) => (
                <option key={String(value.id)} value={String(value.id)}>
                  {String(value.name)}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <UserSelect
          label="Ведущий"
          name="facilitator"
          users={data.users}
          defaultValue={String(item.facilitator_user_id || "")}
        />
        <Field
          label="Продолжительность, минут"
          name="duration"
          type="number"
          defaultValue={item.default_duration_minutes || 60}
          min={15}
          max={480}
          required
        />
      </div>
      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Участники</h3>
            <p className="text-xs text-muted-foreground">
              Добавьте сотрудника, должность, отдел или внешнего участника.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              setParticipants((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  participantType: "user",
                  userId: null,
                  isRequired: true,
                },
              ])
            }
          >
            <Plus /> Добавить
          </Button>
        </div>
        {participants.map((participant) => (
          <div
            key={participant.id}
            className="grid gap-2 rounded-lg bg-muted/50 p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
          >
            <NativeSelectControlled
              label="Тип"
              value={participant.participantType}
              setValue={(value) =>
                updateParticipant(participant.id, {
                  participantType: value as ParticipantDraft["participantType"],
                })
              }
              options={[
                ["user", "Сотрудник"],
                ["role", "Должность"],
                ["department", "Отдел"],
                ["external", "Внешний"],
              ]}
            />
            {participant.participantType === "user" && (
              <NativeSelectControlled
                label="Сотрудник"
                value={participant.userId || ""}
                setValue={(value) =>
                  updateParticipant(participant.id, { userId: value || null })
                }
                options={[
                  ["", "Выберите сотрудника"],
                  ...data.users.map((user) => [
                    String(user.id),
                    String(user.full_name || "Без имени"),
                  ]),
                ]}
              />
            )}
            {participant.participantType === "role" && (
              <NativeSelectControlled
                label="Должность"
                value={participant.role || ""}
                setValue={(value) =>
                  updateParticipant(participant.id, { role: value || null })
                }
                options={[
                  ["", "Выберите должность"],
                  ...Object.entries(ROLES).map(([value, role]) => [
                    value,
                    role.label,
                  ]),
                ]}
              />
            )}
            {participant.participantType === "department" && (
              <NativeSelectControlled
                label="Отдел"
                value={participant.departmentId || ""}
                setValue={(value) =>
                  updateParticipant(participant.id, {
                    departmentId: value || null,
                  })
                }
                options={[
                  ["", "Выберите отдел"],
                  ...data.departments.map((department) => [
                    String(department.id),
                    String(department.name),
                  ]),
                ]}
              />
            )}
            {participant.participantType === "external" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="Имя внешнего участника"
                  placeholder="Имя"
                  value={participant.externalName || ""}
                  onChange={(event) =>
                    updateParticipant(participant.id, {
                      externalName: event.target.value,
                    })
                  }
                  className="min-h-11"
                />
                <Input
                  aria-label="Роль внешнего участника"
                  placeholder="Роль или компания"
                  value={participant.externalRole || ""}
                  onChange={(event) =>
                    updateParticipant(participant.id, {
                      externalRole: event.target.value,
                    })
                  }
                  className="min-h-11"
                />
                <Input
                  aria-label="Email внешнего участника"
                  type="email"
                  placeholder="Email"
                  value={participant.externalEmail || ""}
                  onChange={(event) =>
                    updateParticipant(participant.id, {
                      externalEmail: event.target.value,
                    })
                  }
                  className="min-h-11"
                />
                <Input
                  aria-label="Телефон внешнего участника"
                  placeholder="Телефон"
                  value={participant.externalPhone || ""}
                  onChange={(event) =>
                    updateParticipant(participant.id, {
                      externalPhone: event.target.value,
                    })
                  }
                  className="min-h-11"
                />
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              onClick={() =>
                setParticipants((current) =>
                  current.filter((item) => item.id !== participant.id),
                )
              }
              aria-label="Удалить участника"
            >
              <Trash2 />
            </Button>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-3">
              <Checkbox
                checked={participant.isRequired}
                onCheckedChange={(checked) =>
                  updateParticipant(participant.id, {
                    isRequired: checked === true,
                  })
                }
              />
              Обязательное участие
            </label>
          </div>
        ))}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">
          Какие вопросы принимает встреча
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {MEETING_CATEGORIES.map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <Checkbox
                checked={categories.includes(value)}
                onCheckedChange={(checked) =>
                  setCategories((current) =>
                    checked
                      ? [...new Set([...current, value])]
                      : current.filter((item) => item !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Если ничего не выбрано, встреча принимает все категории.
        </p>
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">Постоянные вопросы</h3>
        {data.questionTemplates.map((question) => (
          <label
            key={String(question.id)}
            className="flex min-h-11 items-center gap-2 text-sm"
          >
            <Checkbox
              checked={fixedQuestionIds.includes(String(question.id))}
              onCheckedChange={(checked) =>
                setFixedQuestionIds((current) =>
                  checked
                    ? [...new Set([...current, String(question.id)])]
                    : current.filter((id) => id !== String(question.id)),
                )
              }
            />
            {String(question.name)}
          </label>
        ))}
        {data.questionTemplates.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Сначала создайте хотя бы один шаблон вопроса.
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Напоминания и уведомления</h3>
        </div>
        <Field
          label="Напоминать заранее, минут (через запятую)"
          name="reminders"
          defaultValue={
            Array.isArray(item.reminder_offsets_minutes)
              ? item.reminder_offsets_minutes.join(", ")
              : "1440, 30"
          }
          placeholder="1440, 30"
          required
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox
              checked={crmChannel}
              onCheckedChange={(value) => setCrmChannel(value === true)}
            />
            Уведомление в CRM
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox
              checked={telegramChannel}
              onCheckedChange={(value) => setTelegramChannel(value === true)}
            />
            Уведомление в Telegram
          </label>
        </div>
        <div>
          <Label htmlFor="fallbackTemplate">Резервное совещание</Label>
          <select
            id="fallbackTemplate"
            name="fallbackTemplate"
            defaultValue={String(item.fallback_template_id || "")}
            className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Оставлять без подходящего совещания</option>
            {data.templates
              .filter((template) => template.id !== item.id)
              .map((template) => (
                <option key={String(template.id)} value={String(template.id)}>
                  {String(template.name)}
                </option>
              ))}
          </select>
        </div>
      </section>
      <div className="flex justify-end">
        <Button disabled={pending} className="min-h-11">
          <Save /> Сохранить шаблон
        </Button>
      </div>
    </form>
  );
}

function ScheduleForm({
  templateId,
  pending,
  submit,
}: {
  templateId: string;
  pending: boolean;
  submit: (payload: Parameters<typeof saveMeetingScheduleV2>[0]) => void;
}) {
  const [kind, setKind] = useState<
    "one_time" | "weekly" | "monthly" | "interval"
  >("weekly");
  const [endMode, setEndMode] = useState<"none" | "date" | "count">("none");
  return (
    <form
      className="space-y-4"
      action={(formData) =>
        submit({
          templateId,
          recurrenceKind: kind,
          startDate: String(formData.get("startDate")),
          startTime: String(formData.get("startTime")),
          timezone: "Europe/Uzhgorod",
          durationMinutes: Number(formData.get("duration")),
          weekdays: formData.getAll("weekdays").map(Number),
          monthDay: Number(formData.get("monthDay") || 0) || null,
          intervalDays: Number(formData.get("intervalDays") || 0) || null,
          endDate:
            endMode === "date"
              ? String(formData.get("endDate") || "") || null
              : null,
          occurrenceCount:
            endMode === "count"
              ? Number(formData.get("occurrenceCount") || 0) || null
              : null,
        })
      }
    >
      <div>
        <Label>Повторение</Label>
        <Select
          value={kind}
          onValueChange={(value) => setKind(value as typeof kind)}
        >
          <SelectTrigger className="mt-1 min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one_time">Один раз</SelectItem>
            <SelectItem value="weekly">Еженедельно</SelectItem>
            <SelectItem value="monthly">Ежемесячно</SelectItem>
            <SelectItem value="interval">Через интервал дней</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Дата начала" name="startDate" type="date" required />
        <Field
          label="Время"
          name="startTime"
          type="time"
          defaultValue="10:00"
          required
        />
        <Field
          label="Длительность"
          name="duration"
          type="number"
          defaultValue={60}
          min={15}
          max={480}
          required
        />
      </div>
      {kind === "weekly" && (
        <div>
          <Label>Дни недели</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, index) => (
              <label
                key={day}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3"
              >
                <Checkbox
                  name="weekdays"
                  value={String(index + 1)}
                  defaultChecked={index === 0}
                />
                {day}
              </label>
            ))}
          </div>
        </div>
      )}
      {kind === "monthly" && (
        <Field
          label="День месяца"
          name="monthDay"
          type="number"
          defaultValue={1}
          min={1}
          max={31}
          required
        />
      )}
      {kind === "interval" && (
        <Field
          label="Интервал, дней"
          name="intervalDays"
          type="number"
          defaultValue={7}
          min={1}
          max={365}
          required
        />
      )}
      {kind !== "one_time" && (
        <div className="space-y-3 rounded-xl border p-4">
          <NativeSelectControlled
            label="Когда закончить серию"
            value={endMode}
            setValue={(value) => setEndMode(value as typeof endMode)}
            options={[
              ["none", "Без окончания"],
              ["date", "В выбранную дату"],
              ["count", "После заданного числа встреч"],
            ]}
          />
          {endMode === "date" && (
            <Field label="Дата окончания" name="endDate" type="date" required />
          )}
          {endMode === "count" && (
            <Field
              label="Количество встреч"
              name="occurrenceCount"
              type="number"
              min={1}
              max={520}
              required
            />
          )}
          {endMode === "none" && (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              Система создаёт встречи на 90 дней вперёд и автоматически
              продлевает горизонт.
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button disabled={pending} className="min-h-11">
          <CalendarClock /> Создать расписание
        </Button>
      </div>
    </form>
  );
}

function QuestionTemplatesCatalog({
  data,
  canManage,
}: {
  data: SettingsData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canManage && (
          <Button className="min-h-11" onClick={() => setEditing({})}>
            <Plus /> Новый шаблон вопроса
          </Button>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.questionTemplates.map((item) => (
          <Card key={String(item.id)}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{String(item.name)}</h2>
                    {Boolean(item.is_system) && (
                      <Badge variant="secondary">Системный</Badge>
                    )}
                    <MeetingStatus value={String(item.priority)} />
                  </div>
                  <p className="mt-3 rounded-lg bg-muted p-3 text-sm font-medium">
                    {String(item.title_template)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ожидаемый результат:{" "}
                    {String(item.expected_outcome || "не задан")}
                  </p>
                </div>
                {canManage && (
                  <Button variant="outline" onClick={() => setEditing(item)}>
                    Изменить
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(Array.isArray(item.allowed_outcomes)
                  ? item.allowed_outcomes
                  : []
                ).map((value) => (
                  <Badge variant="outline" key={String(value)}>
                    {outcomeLabel(String(value))}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && (
        <Overlay
          title={
            editing.id ? "Изменить шаблон вопроса" : "Новый шаблон вопроса"
          }
          close={() => setEditing(null)}
        >
          <QuestionTemplateForm
            item={editing}
            users={data.users}
            pending={pending}
            submit={(payload) =>
              startTransition(async () => {
                try {
                  await saveMeetingQuestionTemplateV2(payload);
                  toast.success("Шаблон вопроса сохранён");
                  setEditing(null);
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Не удалось сохранить",
                  );
                }
              })
            }
          />
        </Overlay>
      )}
    </div>
  );
}

function QuestionTemplateForm({
  item,
  users,
  pending,
  submit,
}: {
  item: Record<string, unknown>;
  users: Array<Record<string, unknown>>;
  pending: boolean;
  submit: (
    payload: Parameters<typeof saveMeetingQuestionTemplateV2>[0],
  ) => void;
}) {
  return (
    <form
      className="space-y-4"
      action={(formData) =>
        submit({
          id: item.id ? String(item.id) : undefined,
          name: String(formData.get("name")),
          titleTemplate: String(formData.get("titleTemplate")),
          descriptionTemplate: String(formData.get("description") || ""),
          category: String(formData.get("category")),
          priority: String(formData.get("priority")) as "normal",
          expectedOutcome: String(formData.get("expectedOutcome") || ""),
          allowedOutcomes: formData.getAll("outcomes") as Array<
            "decision" | "task" | "defer" | "dismiss" | "source_update"
          >,
          defaultResponsibleUserId:
            String(formData.get("responsible") || "") || null,
          taskSlaDays: Number(formData.get("sla") || 0) || null,
          sourceUrlTemplate: null,
          fixedForEveryOccurrence: Boolean(formData.get("fixed")),
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название" name="name" defaultValue={item.name} required />
        <NativeSelect
          label="Категория"
          name="category"
          defaultValue={String(item.category || "general")}
          options={MEETING_CATEGORIES.map(([value, label]) => [value, label])}
        />
      </div>
      <Field
        label="Формулировка с подстановками"
        name="titleTemplate"
        defaultValue={item.title_template}
        placeholder="Риск по машине {Машина}: {Количество}"
        required
      />
      <div>
        <Label>Описание</Label>
        <Textarea
          name="description"
          defaultValue={String(item.description_template || "")}
          className="mt-1"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NativeSelect
          label="Приоритет"
          name="priority"
          defaultValue={String(item.priority || "normal")}
          options={[
            ["low", "Низкий"],
            ["normal", "Обычный"],
            ["high", "Высокий"],
            ["critical", "Критичный"],
          ]}
        />
        <Field
          label="Ожидаемый результат"
          name="expectedOutcome"
          defaultValue={item.expected_outcome}
        />
      </div>
      <div>
        <Label>Разрешённые действия</Label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            ["decision", "Решение"],
            ["task", "Создать задачу"],
            ["defer", "Отложить"],
            ["dismiss", "Отклонить"],
            ["source_update", "Изменить исходную запись"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-2 rounded-lg border px-3"
            >
              <Checkbox
                name="outcomes"
                value={value}
                defaultChecked={
                  !item.id ||
                  (Array.isArray(item.allowed_outcomes) &&
                    item.allowed_outcomes.includes(value))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <UserSelect
          label="Ответственный по умолчанию"
          name="responsible"
          users={users}
          defaultValue={String(item.default_responsible_user_id || "")}
        />
        <Field
          label="SLA задачи, дней"
          name="sla"
          type="number"
          min={0}
          max={365}
          defaultValue={item.task_sla_days}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3">
        <Checkbox
          name="fixed"
          defaultChecked={Boolean(item.fixed_for_every_occurrence)}
        />{" "}
        Постоянный вопрос каждой встречи
      </label>
      <div className="flex justify-end">
        <Button disabled={pending} className="min-h-11">
          <Save /> Сохранить
        </Button>
      </div>
    </form>
  );
}

function RulesCatalog({
  data,
  canManage,
}: {
  data: SettingsData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [builderRule, setBuilderRule] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [pending, startTransition] = useTransition();
  if (builderRule)
    return (
      <RuleBuilder
        data={data}
        initial={builderRule}
        close={() => setBuilderRule(null)}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Опубликованные правила и черновики
          </h2>
          <p className="text-sm text-muted-foreground">
            Системные правила доступны для версионного редактирования, паузы и
            архива.
          </p>
        </div>
        {canManage && (
          <Button className="min-h-11" onClick={() => setBuilderRule({})}>
            <Plus /> Создать правило
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {data.rules.map((rule) => {
          const version = relation(rule.current_version);
          const question = relation(rule.question_template);
          return (
            <Card key={String(rule.id)}>
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{String(rule.name)}</h3>
                    <MeetingStatus value={String(rule.status)} />
                    {Boolean(rule.is_system) && (
                      <Badge variant="secondary">Системное</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {String(question?.name || "Шаблон не выбран")} ·{" "}
                    {sourceLabel(
                      data.sources,
                      String(version?.source_key || ""),
                    )}{" "}
                    · версия {String(version?.version_no || "—")}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setBuilderRule(rule)}
                    >
                      Редактировать
                    </Button>
                    {rule.status === "published" ? (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await setMeetingRuleStatusV2(
                              String(rule.id),
                              "paused",
                            );
                            toast.success("Правило приостановлено");
                            router.refresh();
                          })
                        }
                      >
                        <CirclePause /> Пауза
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await setMeetingRuleStatusV2(
                              String(rule.id),
                              "published",
                            );
                            toast.success("Правило опубликовано");
                            router.refresh();
                          })
                        }
                      >
                        <Rocket /> Опубликовать
                      </Button>
                    )}
                    {rule.status !== "archived" && (
                      <Button
                        variant="ghost"
                        className="min-h-11 text-muted-foreground"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await setMeetingRuleStatusV2(
                              String(rule.id),
                              "archived",
                            );
                            toast.success("Правило перенесено в архив");
                            router.refresh();
                          })
                        }
                      >
                        В архив
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Последние запуски
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {data.runs.slice(0, 10).map((run) => (
              <div
                key={String(run.id)}
                className="grid min-h-11 items-center gap-2 py-2 text-sm sm:grid-cols-5"
              >
                <MeetingStatus value={String(run.status)} />
                <span>{runTypeLabel(String(run.run_type))}</span>
                <span>Совпадений: {String(run.matched_count)}</span>
                <span>Создано: {String(run.created_count)}</span>
                <span>Закрыто: {String(run.closed_count)}</span>
              </div>
            ))}
            {data.runs.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Правила ещё не запускались.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RuleBuilder({
  data,
  initial,
  close,
}: {
  data: SettingsData;
  initial: Record<string, unknown>;
  close: () => void;
}) {
  const router = useRouter();
  const version = relation(initial.current_version);
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<MeetingRulePreview | null>(null);
  const [name, setName] = useState(String(initial.name || ""));
  const [triggerType, setTriggerType] = useState(
    String(version?.trigger_type || "record_state"),
  );
  const [sourceKey, setSourceKey] = useState(
    String(version?.source_key || "tasks"),
  );
  const source =
    data.sources.find((item) => item.key === sourceKey) || data.sources[0];
  const initialDsl = relationObject(version?.dsl);
  const initialAggregate = relationObject(initialDsl.aggregate);
  const initialConditions = Array.isArray(initialDsl.conditions)
    ? (initialDsl.conditions as Array<Record<string, unknown>>)
    : [];
  const [advanced, setAdvanced] = useState(
    initialConditions.some((item) => "logic" in item),
  );
  const [conditions, setConditions] = useState<ConditionRow[]>(() =>
    flattenConditions(initialConditions, source?.fields[0]?.key || "status"),
  );
  const [questionTemplateId, setQuestionTemplateId] = useState(
    String(initial.question_template_id || data.questionTemplates[0]?.id || ""),
  );
  const grouping = relationObject(version?.grouping);
  const [groupFields, setGroupFields] = useState<string[]>(
    Array.isArray(grouping.fields) ? grouping.fields.map(String) : [],
  );
  const routing = relationObject(version?.routing);
  const [strategy, setStrategy] = useState(
    String(routing.strategy || "nearest_matching"),
  );
  const [specificTemplate, setSpecificTemplate] = useState(
    String(routing.templateId || ""),
  );
  const [requireParticipant, setRequireParticipant] = useState(
    String(routing.requireParticipant || "none"),
  );
  const [fallback, setFallback] = useState(String(routing.fallback || "pool"));
  const lifecycle = relationObject(version?.lifecycle);
  const [clearBehavior, setClearBehavior] = useState(
    String(lifecycle.clearBehavior || "auto_close"),
  );
  const [taskBehavior, setTaskBehavior] = useState(
    String(lifecycle.taskBehavior || "wait_for_completion"),
  );
  const [aggregateOperation, setAggregateOperation] = useState(
    String(initialAggregate.operation || "count"),
  );
  const [aggregateField, setAggregateField] = useState(
    String(initialAggregate.field || ""),
  );
  const [aggregateOperator, setAggregateOperator] = useState(
    String(initialAggregate.operator || "gte"),
  );
  const [aggregateValue, setAggregateValue] = useState(
    String(initialAggregate.value ?? "1"),
  );
  const notifications = relationObject(version?.notifications);
  const [crm, setCrm] = useState(
    Array.isArray(notifications.channels)
      ? notifications.channels.includes("crm")
      : true,
  );
  const [telegram, setTelegram] = useState(
    Array.isArray(notifications.channels)
      ? notifications.channels.includes("telegram")
      : true,
  );
  const [criticalOnly, setCriticalOnly] = useState(
    notifications.criticalOnly !== false,
  );
  const draft = useMemo(
    () =>
      makeRuleDraft({
        id: initial.id ? String(initial.id) : undefined,
        name,
        triggerType,
        sourceKey,
        conditions,
        advanced,
        questionTemplateId,
        groupFields,
        strategy,
        specificTemplate,
        requireParticipant,
        fallback,
        clearBehavior,
        taskBehavior,
        aggregateOperation,
        aggregateField,
        aggregateOperator,
        aggregateValue,
        crm,
        telegram,
        criticalOnly,
      }),
    [
      advanced,
      conditions,
      aggregateField,
      aggregateOperation,
      aggregateOperator,
      aggregateValue,
      clearBehavior,
      crm,
      criticalOnly,
      fallback,
      groupFields,
      initial.id,
      name,
      questionTemplateId,
      requireParticipant,
      sourceKey,
      specificTemplate,
      strategy,
      taskBehavior,
      telegram,
      triggerType,
    ],
  );
  function execute(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Операция не выполнена",
        );
      }
    });
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" className="min-h-11" onClick={close}>
          <ArrowLeft /> К правилам
        </Button>
        <Badge variant="outline">Шаг {step} из 6</Badge>
      </div>
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="mb-6">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Конструктор правила</span>
              <span>{Math.round((step / 6) * 100)}%</span>
            </div>
            <Progress className="mt-2" value={(step / 6) * 100} />
          </div>
          {step === 1 && (
            <WizardStep
              icon={Sparkles}
              title="Что запускает правило?"
              text="Выберите тип события, по которому система проверит условия."
            >
              <div className="mb-5">
                <Label htmlFor="rule-name">Название правила</Label>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Например: Просроченные задачи"
                  className="mt-1 min-h-11"
                  maxLength={160}
                  required
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  [
                    "record_state",
                    "Текущее состояние записи",
                    "Например, материал ещё не получен",
                  ],
                  [
                    "relative_time",
                    "Наступление относительной даты",
                    "Срок прошёл или скоро наступит",
                  ],
                  [
                    "field_change",
                    "Изменение поля",
                    "Поле изменилось с одного значения на другое",
                  ],
                  [
                    "aggregate",
                    "Агрегатный порог",
                    "Количество, сумма, минимум или максимум",
                  ],
                ].map(([value, title, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTriggerType(value)}
                    className={`min-h-24 rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${triggerType === value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  >
                    <span className="font-semibold">{title}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {text}
                    </span>
                  </button>
                ))}
              </div>
            </WizardStep>
          )}
          {step === 2 && (
            <WizardStep
              icon={Layers3}
              title="Из каких данных брать вопросы?"
              text="Показываются только безопасные бизнес-источники, к которым у вас есть доступ."
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.sources
                  .filter((item) =>
                    item.triggers.includes(triggerType as never),
                  )
                  .map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setSourceKey(item.key);
                        setConditions([
                          {
                            id: crypto.randomUUID(),
                            group: 0,
                            field: item.fields[0]?.key || "",
                            operator: item.fields[0]?.operators[0] || "eq",
                            value: "",
                          },
                        ]);
                      }}
                      className={`min-h-28 rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sourceKey === item.key ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <span className="font-semibold">{item.label}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {item.description}
                      </span>
                    </button>
                  ))}
              </div>
            </WizardStep>
          )}
          {step === 3 && (
            <WizardStep
              icon={GitBranch}
              title="При каких условиях появляется вопрос?"
              text="Обычный режим использует AND/OR. Расширенный режим создаёт (A AND B) OR (C AND D)."
            >
              <div className="mb-4 flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Расширенные группы</p>
                  <p className="text-xs text-muted-foreground">
                    Две группы условий без произвольной вложенности
                  </p>
                </div>
                <Switch checked={advanced} onCheckedChange={setAdvanced} />
              </div>
              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <ConditionEditor
                    key={condition.id}
                    condition={condition}
                    source={source}
                    advanced={advanced}
                    change={(next) =>
                      setConditions((items) =>
                        items.map((item) =>
                          item.id === condition.id ? next : item,
                        ),
                      )
                    }
                    remove={() =>
                      setConditions((items) =>
                        items.filter((item) => item.id !== condition.id),
                      )
                    }
                    index={index}
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() =>
                    setConditions((items) => [
                      ...items,
                      {
                        id: crypto.randomUUID(),
                        group: advanced ? 1 : 0,
                        field: source.fields[0]?.key || "",
                        operator: source.fields[0]?.operators[0] || "eq",
                        value: "",
                      },
                    ])
                  }
                >
                  <Plus /> Добавить условие
                </Button>
              </div>
              {triggerType === "aggregate" && (
                <div className="mt-5 grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <NativeSelectControlled
                    label="Расчёт"
                    value={aggregateOperation}
                    setValue={setAggregateOperation}
                    options={[
                      ["count", "Количество записей"],
                      ["sum", "Сумма значений"],
                      ["min", "Минимум"],
                      ["max", "Максимум"],
                    ]}
                  />
                  {aggregateOperation !== "count" && (
                    <NativeSelectControlled
                      label="Поле расчёта"
                      value={aggregateField}
                      setValue={setAggregateField}
                      options={source.fields
                        .filter((field) => field.type === "number")
                        .map((field) => [field.key, field.label])}
                    />
                  )}
                  <NativeSelectControlled
                    label="Сравнение"
                    value={aggregateOperator}
                    setValue={setAggregateOperator}
                    options={[
                      ["gt", "Больше"],
                      ["gte", "Больше или равно"],
                      ["lt", "Меньше"],
                      ["lte", "Меньше или равно"],
                      ["eq", "Равно"],
                    ]}
                  />
                  <div>
                    <Label>Порог</Label>
                    <Input
                      type="number"
                      className="mt-1 min-h-11"
                      value={aggregateValue}
                      onChange={(event) =>
                        setAggregateValue(event.target.value)
                      }
                    />
                  </div>
                </div>
              )}
            </WizardStep>
          )}
          {step === 4 && (
            <WizardStep
              icon={FileQuestion}
              title="Как сформулировать и сгруппировать?"
              text="Выберите шаблон вопроса и поля умной группировки."
            >
              <div>
                <Label>Шаблон вопроса</Label>
                <Select
                  value={questionTemplateId}
                  onValueChange={(value) => setQuestionTemplateId(value || "")}
                >
                  <SelectTrigger className="mt-1 min-h-11">
                    <SelectValue placeholder="Выберите шаблон" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.questionTemplates.map((item) => (
                      <SelectItem key={String(item.id)} value={String(item.id)}>
                        {String(item.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-5">
                <Label>Группировать по</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {source.fields.map((field) => (
                    <label
                      key={field.key}
                      className="flex min-h-11 items-center gap-2 rounded-lg border px-3"
                    >
                      <Checkbox
                        checked={groupFields.includes(field.key)}
                        onCheckedChange={(checked) =>
                          setGroupFields((items) =>
                            checked
                              ? [...items, field.key]
                              : items.filter((value) => value !== field.key),
                          )
                        }
                      />
                      {field.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-muted p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Доступные подстановки
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {source.tokens.map((token) => (
                    <Badge
                      variant="outline"
                      key={token.key}
                    >{`{${token.key}}`}</Badge>
                  ))}
                </div>
              </div>
            </WizardStep>
          )}
          {step === 5 && (
            <WizardStep
              icon={Bell}
              title="Куда направить и кого уведомить?"
              text="Маршрутизация ищет ближайшее подходящее совещание до его начала."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <NativeSelectControlled
                  label="Стратегия"
                  value={strategy}
                  setValue={setStrategy}
                  options={[
                    ["nearest_matching", "Ближайшее подходящее"],
                    ["specific_template", "Конкретный шаблон"],
                    ["pool_only", "Только пул повесток"],
                  ]}
                />
                {strategy === "specific_template" && (
                  <NativeSelectControlled
                    label="Шаблон совещания"
                    value={specificTemplate}
                    setValue={setSpecificTemplate}
                    options={data.templates.map((item) => [
                      String(item.id),
                      String(item.name),
                    ])}
                  />
                )}
                <NativeSelectControlled
                  label="Обязательный участник"
                  value={requireParticipant}
                  setValue={setRequireParticipant}
                  options={[
                    ["none", "Не проверять"],
                    ["responsible", "Ответственный"],
                    ["department", "Целевой отдел"],
                    ["supply", "Снабжение"],
                  ]}
                />
                <NativeSelectControlled
                  label="Если встреча не найдена"
                  value={fallback}
                  setValue={setFallback}
                  options={[
                    ["pool", "Оставить без маршрута"],
                    ["fallback_template", "Использовать резервную встречу"],
                  ]}
                />
                <NativeSelectControlled
                  label="Когда условие исчезло"
                  value={clearBehavior}
                  setValue={setClearBehavior}
                  options={[
                    ["auto_close", "Закрыть автоматически"],
                    ["keep_for_confirmation", "Оставить для подтверждения"],
                  ]}
                />
                <NativeSelectControlled
                  label="После создания задачи"
                  value={taskBehavior}
                  setValue={setTaskBehavior}
                  options={[
                    ["wait_for_completion", "Контролировать до выполнения"],
                    ["close_after_creation", "Закрыть после создания"],
                  ]}
                />
              </div>
              <div className="mt-5 grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch checked={crm} onCheckedChange={setCrm} />
                  Уведомлять в CRM
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch checked={telegram} onCheckedChange={setTelegram} />
                  Уведомлять в Telegram
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch
                    checked={criticalOnly}
                    onCheckedChange={setCriticalOnly}
                  />
                  Только критичные вопросы
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  Повторные изменения одной открытой группы объединяются в одно
                  уведомление.
                </p>
              </div>
            </WizardStep>
          )}
          {step === 6 && (
            <WizardStep
              icon={Rocket}
              title="Предпросмотр и публикация"
              text="Предпросмотр читает данные, но не создаёт вопросы и не изменяет записи."
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    execute(async () => {
                      const result = await previewMeetingRuleV2(draft);
                      setPreview(result);
                      toast.success("Предпросмотр готов");
                    })
                  }
                >
                  <Sparkles /> Выполнить предпросмотр
                </Button>
                <Button
                  className="min-h-11"
                  disabled={pending || !preview}
                  onClick={() =>
                    execute(async () => {
                      const saved = await saveMeetingRuleDraftV2(draft);
                      await publishMeetingRuleV2(saved.ruleId, true);
                      toast.success(
                        "Правило опубликовано и текущие совпадения обработаны",
                      );
                      router.refresh();
                      close();
                    })
                  }
                >
                  <Rocket /> Опубликовать и обработать текущие
                </Button>
                <Button
                  variant="secondary"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    execute(async () => {
                      const saved = await saveMeetingRuleDraftV2(draft);
                      await publishMeetingRuleV2(saved.ruleId, false);
                      toast.success(
                        "Правило будет реагировать только на новые события",
                      );
                      router.refresh();
                      close();
                    })
                  }
                >
                  Только новые события
                </Button>
              </div>
              {preview && <PreviewPanel preview={preview} />}
            </WizardStep>
          )}
          <div className="mt-7 flex items-center justify-between border-t pt-4">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={step === 1}
              onClick={() => setStep((value) => Math.max(1, value - 1))}
            >
              <ArrowLeft /> Назад
            </Button>
            {step < 6 && (
              <Button
                className="min-h-11"
                disabled={
                  (step === 3 && conditions.length === 0) ||
                  (step === 4 && !questionTemplateId)
                }
                onClick={() => setStep((value) => Math.min(6, value + 1))}
              >
                Продолжить <ArrowRight />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConditionEditor({
  condition,
  source,
  advanced,
  change,
  remove,
  index,
}: {
  condition: ConditionRow;
  source: MeetingSourceDefinition;
  advanced: boolean;
  change: (condition: ConditionRow) => void;
  remove: () => void;
  index: number;
}) {
  const field =
    source.fields.find((item) => item.key === condition.field) ||
    source.fields[0];
  const noValue = [
    "is_empty",
    "is_not_empty",
    "before_today",
    "after_today",
    "changed",
  ].includes(condition.operator);
  const comparesField = ["after_field", "before_field"].includes(
    condition.operator,
  );
  return (
    <div className="grid gap-2 rounded-xl border p-3 lg:grid-cols-[6rem_1fr_1fr_1fr_auto] lg:items-end">
      <div>
        <Label>Связка</Label>
        <div className="mt-1 flex min-h-11 items-center text-sm font-semibold text-primary">
          {advanced
            ? `Группа ${condition.group + 1}`
            : index === 0
              ? "ЕСЛИ"
              : "И"}
        </div>
      </div>
      {advanced && (
        <div className="lg:hidden">
          <NativeSelectControlled
            label="Группа"
            value={String(condition.group)}
            setValue={(value) =>
              change({ ...condition, group: Number(value) as 0 | 1 })
            }
            options={[
              ["0", "Группа 1"],
              ["1", "Группа 2"],
            ]}
          />
        </div>
      )}
      <NativeSelectControlled
        label="Поле"
        value={condition.field}
        setValue={(value) => {
          const nextField =
            source.fields.find((item) => item.key === value) ||
            source.fields[0];
          change({
            ...condition,
            field: value,
            operator: nextField.operators[0],
            value: "",
          });
        }}
        options={source.fields.map((item) => [item.key, item.label])}
      />
      <NativeSelectControlled
        label="Оператор"
        value={condition.operator}
        setValue={(value) => {
          const operator = value as MeetingConditionOperator;
          const comparisonField = source.fields.find(
            (candidate) =>
              candidate.key !== field.key &&
              ["date", "datetime"].includes(candidate.type),
          );
          change({
            ...condition,
            operator,
            value: ["after_field", "before_field"].includes(operator)
              ? comparisonField?.key || ""
              : condition.value,
          });
        }}
        options={field.operators.map((value) => [
          value,
          OPERATOR_LABELS[value],
        ])}
      />
      {noValue ? (
        <div className="min-h-11" />
      ) : comparesField ? (
        <NativeSelectControlled
          label="Сравнить с полем"
          value={condition.value}
          setValue={(value) => change({ ...condition, value })}
          options={source.fields
            .filter(
              (candidate) =>
                candidate.key !== field.key &&
                ["date", "datetime"].includes(candidate.type),
            )
            .map((candidate) => [candidate.key, candidate.label])}
        />
      ) : field.options ? (
        <NativeSelectControlled
          label="Значение"
          value={condition.value}
          setValue={(value) => change({ ...condition, value })}
          options={field.options.map((item) => [item.value, item.label])}
        />
      ) : (
        <div>
          <Label>Значение</Label>
          <Input
            className="mt-1 min-h-11"
            value={condition.value}
            onChange={(event) =>
              change({ ...condition, value: event.target.value })
            }
            type={
              field.type === "number"
                ? "number"
                : field.type === "date" || field.type === "datetime"
                  ? "date"
                  : "text"
            }
          />
        </div>
      )}
      <Button
        variant="ghost"
        className="min-h-11"
        onClick={remove}
        aria-label="Удалить условие"
      >
        ×
      </Button>
    </div>
  );
}

function makeRuleDraft(input: {
  id?: string;
  name: string;
  triggerType: string;
  sourceKey: string;
  conditions: ConditionRow[];
  advanced: boolean;
  questionTemplateId: string;
  groupFields: string[];
  strategy: string;
  specificTemplate: string;
  requireParticipant: string;
  fallback: string;
  clearBehavior: string;
  taskBehavior: string;
  aggregateOperation: string;
  aggregateField: string;
  aggregateOperator: string;
  aggregateValue: string;
  crm: boolean;
  telegram: boolean;
  criticalOnly: boolean;
}): MeetingRuleDraft {
  const normalize = (condition: ConditionRow) => ({
    field: condition.field,
    operator: condition.operator,
    value: ["in", "not_in"].includes(condition.operator)
      ? condition.value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [
            "gt",
            "gte",
            "lt",
            "lte",
            "days_ago_gte",
            "days_until_lte",
            "business_days_elapsed",
          ].includes(condition.operator)
        ? Number(condition.value)
        : condition.value || undefined,
  });
  const baseDsl = input.advanced
    ? {
        logic: "or" as const,
        conditions: [0, 1]
          .map((group) => ({
            logic: "and" as const,
            conditions: input.conditions
              .filter((item) => item.group === group)
              .map(normalize),
          }))
          .filter((group) => group.conditions.length > 0),
      }
    : { logic: "and" as const, conditions: input.conditions.map(normalize) };
  const dsl = {
    ...baseDsl,
    ...(input.triggerType === "aggregate"
      ? {
          aggregate: {
            operation: input.aggregateOperation as
              "count" | "sum" | "min" | "max",
            ...(input.aggregateOperation === "count"
              ? {}
              : { field: input.aggregateField }),
            operator: input.aggregateOperator as
              "gt" | "gte" | "lt" | "lte" | "eq",
            value: Number(input.aggregateValue),
          },
        }
      : {}),
  };
  return {
    id: input.id,
    name: input.name || "Новое правило",
    questionTemplateId: input.questionTemplateId,
    triggerType: input.triggerType as MeetingRuleDraft["triggerType"],
    sourceKey: input.sourceKey,
    dsl,
    grouping: {
      mode: input.groupFields.length ? "smart" : "none",
      fields: input.groupFields,
    },
    routing: {
      strategy: input.strategy as MeetingRuleDraft["routing"]["strategy"],
      templateId: input.specificTemplate || null,
      requireParticipant:
        input.requireParticipant as MeetingRuleDraft["routing"]["requireParticipant"],
      fallback: input.fallback as MeetingRuleDraft["routing"]["fallback"],
    },
    lifecycle: {
      clearBehavior:
        input.clearBehavior as MeetingRuleDraft["lifecycle"]["clearBehavior"],
      taskBehavior:
        input.taskBehavior as MeetingRuleDraft["lifecycle"]["taskBehavior"],
    },
    notifications: {
      channels:
        input.crm || input.telegram
          ? [
              ...(input.crm ? (["crm"] as const) : []),
              ...(input.telegram ? (["telegram"] as const) : []),
            ]
          : ["crm"],
      criticalOnly: input.criticalOnly,
    },
  };
}

function flattenConditions(
  conditions: Array<Record<string, unknown>>,
  fallbackField: string,
): ConditionRow[] {
  const result: ConditionRow[] = [];
  conditions.forEach((item, groupIndex) => {
    const nested = Array.isArray(item.conditions)
      ? (item.conditions as Record<string, unknown>[])
      : [item];
    nested.forEach((condition) =>
      result.push({
        id: crypto.randomUUID(),
        group: Math.min(groupIndex, 1) as 0 | 1,
        field: String(condition.field || fallbackField),
        operator: String(
          condition.operator || "eq",
        ) as MeetingConditionOperator,
        value: Array.isArray(condition.value)
          ? condition.value.join(", ")
          : String(condition.value ?? ""),
      }),
    );
  });
  return result.length
    ? result
    : [
        {
          id: crypto.randomUUID(),
          group: 0,
          field: fallbackField,
          operator: "eq",
          value: "",
        },
      ];
}

function PreviewPanel({ preview }: { preview: MeetingRulePreview }) {
  return (
    <div className="mt-5 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Meta label="Совпадений" value={preview.matchCount} />
        <Meta label="Будущих групп" value={preview.groupCount} />
        <Meta label="Конфликтов дедупликации" value={preview.conflicts} />
      </div>
      <div className="divide-y rounded-xl border">
        {preview.samples.map((sample) => (
          <div
            key={`${sample.groupKey}:${sample.sourceId}`}
            className="p-3 text-sm"
          >
            <p className="font-medium">{sample.generatedTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {sample.routeLabel} · {sample.title}
            </p>
          </div>
        ))}
        {preview.samples.length === 0 && (
          <p className="p-5 text-center text-sm text-muted-foreground">
            Текущих совпадений нет. Правило всё равно можно опубликовать для
            новых событий.
          </p>
        )}
      </div>
    </div>
  );
}
function WizardStep({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-5 flex gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
function Overlay({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-b-none sm:rounded-xl">
        <CardHeader className="sticky top-0 z-10 flex-row items-center justify-between border-b bg-background">
          <CardTitle>{title}</CardTitle>
          <Button variant="ghost" className="min-h-11" onClick={close}>
            Закрыть
          </Button>
        </CardHeader>
        <CardContent className="p-5">{children}</CardContent>
      </Card>
    </div>
  );
}
function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ElementType;
  title: string;
  text: string;
}) {
  return (
    <Card>
      <CardContent className="p-12 text-center">
        <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
function Meta({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block text-sm font-medium">{String(value)}</span>
    </div>
  );
}
function Field({
  label,
  name,
  defaultValue,
  ...props
}: { label: string; name: string; defaultValue?: unknown } & Omit<
  React.ComponentProps<typeof Input>,
  "defaultValue" | "name"
>) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue == null ? "" : String(defaultValue)}
        className="mt-1 min-h-11"
        {...props}
      />
    </div>
  );
}
function NativeSelect({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: string[][];
  defaultValue?: string;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
function NativeSelectControlled({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  options: string[][];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
      >
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
function UserSelect({
  label,
  name,
  users,
  defaultValue = "",
}: {
  label: string;
  name: string;
  users: Array<Record<string, unknown>>;
  defaultValue?: string;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
      >
        <option value="">Не назначен</option>
        {users.map((user) => (
          <option key={String(user.id)} value={String(user.id)}>
            {String(user.full_name || "Без имени")}
          </option>
        ))}
      </select>
    </div>
  );
}
function relationObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function scheduleLabel(schedule: Record<string, unknown>) {
  const kinds: Record<string, string> = {
    one_time: "Один раз",
    weekly: "Еженедельно",
    monthly: "Ежемесячно",
    interval: "По интервалу",
  };
  return `${kinds[String(schedule.recurrence_kind)] || schedule.recurrence_kind}, ${String(schedule.start_time || "").slice(0, 5)}`;
}
function sourceLabel(sources: MeetingSourceDefinition[], key: string) {
  return (
    sources.find((item) => item.key === key)?.label || "Источник не выбран"
  );
}
function runTypeLabel(value: string) {
  return (
    (
      {
        preview: "Предпросмотр",
        event: "Изменение данных",
        reconcile: "Плановая сверка",
        backfill: "Обработка текущих данных",
      } as Record<string, string>
    )[value] || "Выполнение правила"
  );
}
function outcomeLabel(value: string) {
  return (
    (
      {
        decision: "Решение",
        task: "Задача",
        defer: "Перенос",
        dismiss: "Отклонение",
        source_update: "Изменение источника",
      } as Record<string, string>
    )[value] || value
  );
}
