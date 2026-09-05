"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  ExternalLink,
  History,
  Play,
  Square,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelMeetingV2,
  completeMeetingV2,
  recordMeetingQuestionOutcomeV2,
  rescheduleMeetingV2,
  startMeetingV2,
} from "@/app/(protected)/meetings/v2-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMeetingDate, MeetingStatus } from "./MeetingStatus";

type DetailData = {
  meeting: Record<string, unknown>;
  questions: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  legacy: {
    agenda: Array<Record<string, unknown>>;
    decisions: Array<Record<string, unknown>>;
    actions: Array<Record<string, unknown>>;
  };
  users: Array<Record<string, unknown>>;
  today: string;
};

function relation(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Record<
    string,
    unknown
  > | null;
}

type OutcomeChoice =
  "decision" | "task" | "defer" | "dismiss" | "source_update";

export function MeetingFlowCard({
  data,
  canManage,
}: {
  data: DetailData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const meeting = data.meeting;
  const status = String(meeting.status);
  const step = status === "planned" ? 0 : status === "in_progress" ? 1 : 2;

  function run(action: () => Promise<unknown>, success: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Операция не выполнена",
        );
      }
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="space-y-4">
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => router.push("/meetings")}
        >
          <ArrowLeft /> К списку
        </Button>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <MeetingStatus value={status} />
              {Boolean(meeting.legacy_read_only) && (
                <Badge variant="outline">Неизменяемый архив</Badge>
              )}
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {String(
                meeting.title ||
                  relation(meeting.template)?.name ||
                  "Совещание",
              )}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatMeetingDate(
                meeting.starts_at ||
                  `${meeting.meeting_date}T${meeting.meeting_time}`,
                true,
              )}
            </p>
          </div>
          {canManage && !Boolean(meeting.legacy_read_only) && (
            <div className="flex flex-wrap gap-2">
              {status === "planned" && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => setRescheduleOpen(true)}
                >
                  <CalendarClock /> Изменить
                </Button>
              )}
              {status === "planned" && (
                <Button
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => startMeetingV2(String(meeting.id)),
                      "Совещание начато. Состав повестки зафиксирован.",
                    )
                  }
                >
                  <Play /> Начать
                </Button>
              )}
              {["planned", "in_progress"].includes(status) && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => completeMeetingV2(String(meeting.id)),
                      "Совещание завершено",
                    )
                  }
                >
                  <Square /> Завершить
                </Button>
              )}
              {["planned", "in_progress"].includes(status) && (
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Отменить совещание и вернуть открытые вопросы в маршрутизацию?",
                      )
                    )
                      return;
                    run(
                      () => cancelMeetingV2(String(meeting.id)),
                      "Совещание отменено, вопросы возвращены в маршрутизацию",
                    );
                  }}
                >
                  <XCircle /> Отменить
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {rescheduleOpen && (
        <RescheduleDialog
          meeting={meeting}
          pending={pending}
          close={() => setRescheduleOpen(false)}
          submit={(payload) =>
            startTransition(async () => {
              try {
                await rescheduleMeetingV2(payload);
                toast.success(
                  payload.scope === "single"
                    ? "Изменена только эта встреча"
                    : "Изменены эта и все последующие встречи",
                );
                setRescheduleOpen(false);
                router.refresh();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Не удалось изменить встречу",
                );
              }
            })
          }
        />
      )}

      <Card>
        <CardContent className="p-4 sm:p-5">
          <ol className="grid gap-3 sm:grid-cols-3" aria-label="Этап совещания">
            {[
              {
                label: "Подготовка",
                hint: "Повестка обновляется",
                icon: ClipboardCheck,
              },
              { label: "Проведение", hint: "Состав зафиксирован", icon: Play },
              {
                label: "Результаты",
                hint: "Решения и контроль",
                icon: CheckCircle2,
              },
            ].map((item, index) => (
              <li
                key={item.label}
                className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 ${index === step ? "border-primary bg-primary/5" : index < step ? "bg-emerald-50/70" : "bg-muted/30"}`}
              >
                <div
                  className={`rounded-full p-2 ${index <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  <item.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.hint}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
        <section className="space-y-3" aria-labelledby="agenda-title">
          <div className="flex items-center justify-between">
            <h2 id="agenda-title" className="text-xl font-semibold">
              Повестка · {data.questions.length || data.legacy.agenda.length}
            </h2>
            <p className="text-xs text-muted-foreground">
              Приоритет → срок → возраст
            </p>
          </div>
          {data.questions.map((question, index) => (
            <QuestionCard
              key={String(question.id)}
              question={question}
              index={index + 1}
              meetingId={String(meeting.id)}
              users={data.users}
              today={data.today}
              canManage={canManage && status === "in_progress"}
              onDone={() => router.refresh()}
            />
          ))}
          {data.questions.length === 0 &&
            data.legacy.agenda.map((item, index) => (
              <Card key={String(item.id)}>
                <CardContent className="p-5">
                  <div className="flex gap-3">
                    <Badge variant="secondary">{index + 1}</Badge>
                    <div>
                      <h3 className="font-semibold">{String(item.title)}</h3>
                      {Boolean(item.description) && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {String(item.description)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          {data.questions.length === 0 && data.legacy.agenda.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <CircleDot className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-medium">Повестка пока пуста</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Автоматические и ручные вопросы появятся до начала совещания.
                </p>
              </CardContent>
            </Card>
          )}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Контроль качества</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Info
                label="Вопросов"
                value={data.questions.length || data.legacy.agenda.length}
              />
              <Info
                label="Критичных"
                value={
                  data.questions.filter((item) => item.priority === "critical")
                    .length
                }
              />
              <Info
                label="Без результата"
                value={
                  data.questions.filter((item) =>
                    ["assigned", "in_meeting"].includes(String(item.status)),
                  ).length
                }
              />
              <Info
                label="На контроле"
                value={
                  data.questions.filter((item) => item.status === "on_control")
                    .length
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" /> История встречи
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {Boolean(meeting.agenda_snapshot_at) ? (
                <p>
                  Повестка зафиксирована{" "}
                  {formatMeetingDate(meeting.agenda_snapshot_at, true)}.
                </p>
              ) : (
                <p>До старта автоматические правила могут обновлять состав.</p>
              )}
              {Boolean(meeting.notes) && (
                <p className="rounded-lg bg-muted p-3 text-foreground">
                  {String(meeting.notes)}
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function RescheduleDialog({
  meeting,
  pending,
  close,
  submit,
}: {
  meeting: Record<string, unknown>;
  pending: boolean;
  close: () => void;
  submit: (payload: Parameters<typeof rescheduleMeetingV2>[0]) => void;
}) {
  const hasSeries = Boolean(meeting.schedule_version_id);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/30 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-title"
    >
      <Card className="w-full max-w-xl rounded-b-none sm:rounded-xl">
        <CardHeader className="flex-row items-center justify-between border-b">
          <CardTitle id="reschedule-title">Изменить встречу</CardTitle>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={close}
          >
            Закрыть
          </Button>
        </CardHeader>
        <CardContent className="p-5">
          <form
            className="space-y-4"
            action={(formData) =>
              submit({
                meetingId: String(meeting.id),
                scope: String(formData.get("scope") || "single") as
                  "single" | "following",
                date: String(formData.get("date")),
                time: String(formData.get("time")),
                durationMinutes: Number(formData.get("duration")),
                title: String(formData.get("title") || ""),
                reason: String(formData.get("reason") || ""),
              })
            }
          >
            <div>
              <Label htmlFor="reschedule-scope">Какие встречи изменить</Label>
              <select
                id="reschedule-scope"
                name="scope"
                className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="single">Только эту встречу</option>
                {hasSeries && (
                  <option value="following">Эту и все последующие</option>
                )}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reschedule-date">Дата</Label>
                <Input
                  id="reschedule-date"
                  name="date"
                  type="date"
                  required
                  defaultValue={String(meeting.meeting_date || "")}
                  className="mt-1 min-h-11"
                />
              </div>
              <div>
                <Label htmlFor="reschedule-time">Время</Label>
                <Input
                  id="reschedule-time"
                  name="time"
                  type="time"
                  required
                  defaultValue={String(meeting.meeting_time || "").slice(0, 5)}
                  className="mt-1 min-h-11"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reschedule-duration">
                  Продолжительность, минут
                </Label>
                <Input
                  id="reschedule-duration"
                  name="duration"
                  type="number"
                  min={15}
                  max={480}
                  required
                  defaultValue={Number(meeting.duration_minutes || 60)}
                  className="mt-1 min-h-11"
                />
              </div>
              <div>
                <Label htmlFor="reschedule-title-input">Название</Label>
                <Input
                  id="reschedule-title-input"
                  name="title"
                  defaultValue={String(meeting.title || "")}
                  className="mt-1 min-h-11"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="reschedule-reason">Причина изменения</Label>
              <Textarea id="reschedule-reason" name="reason" className="mt-1" />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={close}
              >
                Отмена
              </Button>
              <Button disabled={pending} className="min-h-11">
                <CalendarClock /> Сохранить
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function QuestionCard({
  question,
  index,
  meetingId,
  users,
  today,
  canManage,
  onDone,
}: {
  question: Record<string, unknown>;
  index: number;
  meetingId: string;
  users: Array<Record<string, unknown>>;
  today: string;
  canManage: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const members = Array.isArray(question.members)
    ? (question.members as Record<string, unknown>[])
    : [];
  const outcomes = Array.isArray(question.outcomes)
    ? (question.outcomes as Record<string, unknown>[])
    : [];
  const taskLinks = Array.isArray(question.task_links)
    ? (question.task_links as Record<string, unknown>[])
    : [];
  const questionTemplate = relation(question.question_template);
  const allowedOutcomes = (
    Array.isArray(questionTemplate?.allowed_outcomes)
      ? questionTemplate.allowed_outcomes
      : ["decision", "task", "defer", "dismiss"]
  ).filter((value): value is OutcomeChoice =>
    ["decision", "task", "defer", "dismiss", "source_update"].includes(
      String(value),
    ),
  );
  return (
    <Card
      className={
        question.priority === "critical" ? "border-destructive/35" : undefined
      }
    >
      <CardHeader className="p-4 sm:p-5">
        <button
          type="button"
          className="flex min-h-11 w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <Badge variant="secondary" className="mt-0.5 tabular-nums">
            {index}
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <MeetingStatus value={String(question.priority)} />
              <MeetingStatus value={String(question.status)} />
              {question.condition_active === false && (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-800"
                >
                  <AlertTriangle /> Исходные данные изменились
                </Badge>
              )}
            </div>
            <h3 className="mt-2 text-base font-semibold sm:text-lg">
              {String(question.title)}
            </h3>
            {Boolean(question.description) && (
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                {String(question.description)}
              </p>
            )}
          </div>
          <ChevronDown
            className={`mt-2 h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 border-t p-4 sm:p-5">
          {members.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Почему вопрос появился</h4>
              <div className="mt-2 divide-y rounded-lg border">
                {members.map((member) => (
                  <div
                    key={String(member.id)}
                    className="flex min-h-11 items-center justify-between gap-3 p-3 text-sm"
                  >
                    <span>{String(member.title)}</span>
                    {Boolean(member.source_url) && (
                      <a
                        href={String(member.source_url)}
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        Источник <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {outcomes.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Принятые результаты</h4>
              <div className="mt-2 space-y-2">
                {outcomes.map((outcome) => (
                  <div
                    key={String(outcome.id)}
                    className="rounded-lg bg-muted p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <MeetingStatus value={String(outcome.outcome_type)} />
                      <span className="text-xs text-muted-foreground">
                        {formatMeetingDate(outcome.created_at, true)}
                      </span>
                    </div>
                    {Boolean(outcome.decision_text) && (
                      <p className="mt-2">{String(outcome.decision_text)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {taskLinks.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Связанные задачи</h4>
              <div className="mt-2 space-y-2">
                {taskLinks.map((link) => {
                  const task = relation(link.task);
                  return task ? (
                    <div
                      key={String(link.task_id)}
                      className="flex items-center justify-between rounded-lg border p-3 text-sm"
                    >
                      <span>{String(task.title)}</span>
                      <MeetingStatus value={String(task.status)} />
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {canManage &&
            !["resolved", "dismissed", "auto_closed"].includes(
              String(question.status),
            ) && (
              <OutcomeForm
                questionId={String(question.id)}
                meetingId={meetingId}
                users={users}
                allowedOutcomes={allowedOutcomes}
                expectedOutcome={String(
                  questionTemplate?.expected_outcome || "",
                )}
                defaultResponsibleUserId={String(
                  question.responsible_user_id ||
                    questionTemplate?.default_responsible_user_id ||
                    "",
                )}
                taskSlaDays={Number(questionTemplate?.task_sla_days || 0)}
                today={today}
                pending={pending}
                submit={(payload) =>
                  startTransition(async () => {
                    try {
                      await recordMeetingQuestionOutcomeV2(payload);
                      toast.success("Результат зафиксирован");
                      onDone();
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Не удалось сохранить результат",
                      );
                    }
                  })
                }
              />
            )}
        </CardContent>
      )}
    </Card>
  );
}

function OutcomeForm({
  questionId,
  meetingId,
  users,
  allowedOutcomes,
  expectedOutcome,
  defaultResponsibleUserId,
  taskSlaDays,
  today,
  pending,
  submit,
}: {
  questionId: string;
  meetingId: string;
  users: Array<Record<string, unknown>>;
  allowedOutcomes: OutcomeChoice[];
  expectedOutcome: string;
  defaultResponsibleUserId: string;
  taskSlaDays: number;
  today: string;
  pending: boolean;
  submit: (
    payload: Parameters<typeof recordMeetingQuestionOutcomeV2>[0],
  ) => void;
}) {
  const [type, setType] = useState<OutcomeChoice>(
    allowedOutcomes[0] || "decision",
  );
  const suggestedDeadline = addDays(today, taskSlaDays);
  const labels: Record<OutcomeChoice, string> = {
    decision: "Решение без задачи",
    task: "Решение и задача",
    defer: "Отложить",
    dismiss: "Отклонить",
    source_update: "Отметить изменение источника",
  };
  return (
    <form
      className="space-y-3 rounded-xl border bg-muted/20 p-4"
      action={(formData) =>
        submit({
          questionId,
          meetingId,
          outcomeType: type,
          decisionText: String(formData.get("decision") || ""),
          responsibleUserId: String(formData.get("responsible") || "") || null,
          deadline: String(formData.get("deadline") || "") || null,
          createTask: type === "task",
        })
      }
    >
      <h4 className="text-sm font-semibold">Зафиксировать результат</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Действие</Label>
          <Select
            value={type}
            onValueChange={(value) => setType(value as typeof type)}
          >
            <SelectTrigger className="mt-1 min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowedOutcomes.map((value) => (
                <SelectItem key={value} value={value}>
                  {labels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {type === "task" && (
          <div>
            <Label>Ответственный</Label>
            <Select name="responsible" defaultValue={defaultResponsibleUserId}>
              <SelectTrigger className="mt-1 min-h-11">
                <SelectValue placeholder="Выберите" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={String(user.id)} value={String(user.id)}>
                    {String(user.full_name || "Без имени")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {expectedOutcome && (
        <p className="text-xs text-muted-foreground">
          Ожидаемый результат: {expectedOutcome}
        </p>
      )}
      <div>
        <Label htmlFor={`decision-${questionId}`}>
          {type === "defer"
            ? "Причина переноса"
            : type === "dismiss"
              ? "Причина отклонения"
              : type === "source_update"
                ? "Что изменено в исходной записи"
                : "Решение"}
        </Label>
        <Textarea
          id={`decision-${questionId}`}
          name="decision"
          required={
            type === "decision" || type === "task" || type === "source_update"
          }
          className="mt-1"
        />
      </div>
      {["task", "defer"].includes(type) && (
        <div className="max-w-xs">
          <Label>Срок</Label>
          <Input
            type="date"
            name="deadline"
            defaultValue={
              type === "task" && taskSlaDays ? suggestedDeadline : undefined
            }
            className="mt-1 min-h-11"
          />
        </div>
      )}
      <Button disabled={pending} className="min-h-11">
        <CheckCircle2 /> Сохранить результат
      </Button>
    </form>
  );
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Math.max(0, days));
  return date.toISOString().slice(0, 10);
}
