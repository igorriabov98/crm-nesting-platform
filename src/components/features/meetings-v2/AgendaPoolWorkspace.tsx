"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  ListChecks,
  Plus,
  Pin,
  PinOff,
  Save,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  assignMeetingQuestionV2,
  createManualMeetingQuestionV2,
  setMeetingQuestionPinnedV2,
} from "@/app/(protected)/meetings/v2-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  formatMeetingDate,
  MeetingStatus,
  PRIORITY_LABELS,
} from "./MeetingStatus";

type PoolData = {
  questions: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  meetings: Array<Record<string, unknown>>;
  factories: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
};

type PoolFilters = {
  priority?: string;
  factoryId?: string;
  responsibleUserId?: string;
  ruleId?: string;
  query?: string;
};

type SavedView = { name: string; query: string };

const tabs = [
  { value: "", label: "Все открытые" },
  { value: "new", label: "Новые" },
  { value: "assigned", label: "Назначены" },
  { value: "on_control", label: "На контроле" },
  { value: "deferred", label: "Отложены" },
  { value: "closed", label: "Закрытые" },
];

function relation(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as Record<
    string,
    unknown
  > | null;
}

export function AgendaPoolWorkspace({
  data,
  currentStatus = "",
  currentFilters = {},
  canManage,
}: {
  data: PoolData;
  currentStatus?: string;
  currentFilters?: PoolFilters;
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [meetingId, setMeetingId] = useState("");
  const [pending, startTransition] = useTransition();
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setSavedViews(
          JSON.parse(
            localStorage.getItem("meeting-pool-views") || "[]",
          ) as SavedView[],
        );
      } catch {
        setSavedViews([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function navigate(status: string) {
    const params = new URLSearchParams(window.location.search);
    if (status) params.set("status", status);
    else params.delete("status");
    params.delete("page");
    router.push(`/meetings/agenda-pool?${params}`);
  }

  function assignSelected() {
    if (!meetingId || selected.length === 0) return;
    startTransition(async () => {
      try {
        for (const id of selected) await assignMeetingQuestionV2(id, meetingId);
        toast.success(`Назначено вопросов: ${selected.length}`);
        setSelected([]);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось назначить вопросы",
        );
      }
    });
  }

  function saveView() {
    const name = window.prompt("Название представления")?.trim();
    if (!name) return;
    const views = savedViews;
    const nextViews = [
      ...views.filter((item) => item.name !== name),
      { name, query: window.location.search },
    ];
    localStorage.setItem("meeting-pool-views", JSON.stringify(nextViews));
    setSavedViews(nextViews);
    toast.success("Представление сохранено в этом браузере");
  }

  function setPage(page: number) {
    const params = new URLSearchParams(window.location.search);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    router.push(`/meetings/agenda-pool?${params}`);
  }

  function togglePinned(questionId: string, isPinned: boolean) {
    startTransition(async () => {
      try {
        await setMeetingQuestionPinnedV2(questionId, !isPinned);
        toast.success(isPinned ? "Закрепление снято" : "Вопрос закреплён");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Не удалось изменить закрепление",
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <ListChecks className="h-4 w-4" /> Единый реестр
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Пул повесток
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Вопрос существует в одном экземпляре и перемещается между пулом,
            совещанием и контролем.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedViews.length > 0 && (
            <Select
              onValueChange={(value) =>
                router.push(`/meetings/agenda-pool${value || ""}`)
              }
            >
              <SelectTrigger className="min-h-11 w-52">
                <SelectValue placeholder="Сохранённые виды" />
              </SelectTrigger>
              <SelectContent>
                {savedViews.map((view) => (
                  <SelectItem key={view.name} value={view.query || "?"}>
                    {view.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" className="min-h-11" onClick={saveView}>
            <Save /> Сохранить вид
          </Button>
          {canManage && (
            <ManualQuestionButton onCreated={() => router.refresh()} />
          )}
        </div>
      </header>

      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Состояния вопросов"
      >
        {tabs.map((tab) => (
          <Button
            key={tab.value}
            variant={currentStatus === tab.value ? "default" : "outline"}
            className="min-h-11 shrink-0"
            onClick={() => navigate(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            {currentStatus && (
              <input type="hidden" name="status" value={currentStatus} />
            )}
            <div className="xl:col-span-2">
              <Label htmlFor="pool-search">Поиск</Label>
              <Input
                id="pool-search"
                name="query"
                className="mt-1 min-h-11"
                placeholder="Вопрос, машина, материал…"
                defaultValue={currentFilters.query || ""}
              />
            </div>
            <FilterSelect
              name="priority"
              label="Приоритет"
              options={[
                { id: "critical", name: "Критичный" },
                { id: "high", name: "Высокий" },
                { id: "normal", name: "Обычный" },
                { id: "low", name: "Низкий" },
              ]}
              currentValue={currentFilters.priority}
            />
            <FilterSelect
              name="factoryId"
              label="Завод"
              options={data.factories}
              currentValue={currentFilters.factoryId}
            />
            <FilterSelect
              name="responsibleUserId"
              label="Ответственный"
              options={data.users}
              currentValue={currentFilters.responsibleUserId}
            />
            <FilterSelect
              name="ruleId"
              label="Правило"
              options={data.rules}
              currentValue={currentFilters.ruleId}
            />
            <div className="flex items-end">
              <Button
                type="submit"
                variant="secondary"
                className="min-h-11 w-full"
              >
                <Filter /> Применить
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {canManage && selected.length > 0 && (
        <Card className="sticky top-3 z-20 border-primary/30 shadow-lg">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <Badge>{selected.length} выбрано</Badge>
            <Select
              value={meetingId}
              onValueChange={(value) => setMeetingId(value || "")}
            >
              <SelectTrigger className="min-h-11 flex-1">
                <SelectValue placeholder="Выберите совещание" />
              </SelectTrigger>
              <SelectContent>
                {data.meetings.map((meeting) => (
                  <SelectItem
                    key={String(meeting.id)}
                    value={String(meeting.id)}
                  >
                    {String(
                      meeting.title ||
                        relation(meeting.template)?.name ||
                        "Совещание",
                    )}{" "}
                    · {formatMeetingDate(meeting.starts_at, true)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="min-h-11"
              disabled={!meetingId || pending}
              onClick={assignSelected}
            >
              <CalendarPlus /> Назначить
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {data.questions.map((question) => {
          const members = Array.isArray(question.members)
            ? (question.members as Record<string, unknown>[])
            : [];
          const meeting = relation(question.meeting);
          return (
            <Card
              key={String(question.id)}
              className={
                question.priority === "critical"
                  ? "border-destructive/35"
                  : undefined
              }
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex gap-3">
                  {canManage &&
                    ![
                      "resolved",
                      "auto_closed",
                      "dismissed",
                      "in_meeting",
                    ].includes(String(question.status)) && (
                      <Checkbox
                        aria-label={`Выбрать ${question.title}`}
                        checked={selectedSet.has(String(question.id))}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? [...current, String(question.id)]
                              : current.filter((id) => id !== question.id),
                          )
                        }
                        className="mt-1"
                      />
                    )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          {Boolean(question.is_pinned) && (
                            <Badge variant="secondary">
                              <Pin className="h-3.5 w-3.5" /> Закреплён
                            </Badge>
                          )}
                          <MeetingStatus value={String(question.priority)} />
                          <MeetingStatus value={String(question.status)} />
                          {!question.assigned_meeting_id &&
                            ["new", "deferred"].includes(
                              String(question.status),
                            ) && (
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-amber-800"
                              >
                                <AlertTriangle /> Без подходящего совещания
                              </Badge>
                            )}
                        </div>
                        <h2 className="mt-3 text-base font-semibold sm:text-lg">
                          {String(question.title)}
                        </h2>
                        {Boolean(question.description) && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {String(question.description)}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          {String(
                            relation(question.rule)?.name || "Ручной вопрос",
                          )}
                          {canManage && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="min-h-11 min-w-11"
                              disabled={pending}
                              onClick={() =>
                                togglePinned(
                                  String(question.id),
                                  Boolean(question.is_pinned),
                                )
                              }
                              aria-label={
                                question.is_pinned
                                  ? "Снять закрепление"
                                  : "Закрепить вопрос"
                              }
                            >
                              {question.is_pinned ? <PinOff /> : <Pin />}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-muted/60 p-3">
                        <span className="block text-xs text-muted-foreground">
                          Завод
                        </span>
                        {String(
                          relation(question.factory)?.name || "Не назначен",
                        )}
                      </div>
                      <div className="rounded-lg bg-muted/60 p-3">
                        <span className="block text-xs text-muted-foreground">
                          Ответственный
                        </span>
                        {String(
                          relation(question.responsible)?.full_name ||
                            "Не назначен",
                        )}
                      </div>
                      <div className="rounded-lg bg-muted/60 p-3">
                        <span className="block text-xs text-muted-foreground">
                          Совещание
                        </span>
                        {meeting
                          ? String(
                              meeting.title ||
                                relation(meeting.template)?.name ||
                                "Совещание",
                            )
                          : "Ожидает маршрутизации"}
                      </div>
                    </div>
                    {members.length > 0 && (
                      <details className="mt-3 rounded-lg border">
                        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium">
                          <ChevronDown className="h-4 w-4" /> Исходные записи:{" "}
                          {members.length}
                        </summary>
                        <div className="divide-y border-t">
                          {members.map((member) => (
                            <div
                              key={String(member.id)}
                              className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm"
                            >
                              <span>{String(member.title)}</span>
                              {Boolean(member.source_url) && (
                                <a
                                  href={String(member.source_url)}
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  Открыть{" "}
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {data.questions.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-medium">
                В этом представлении вопросов нет
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Измените фильтры или создайте вопрос вручную.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
        <p>
          Показано {data.questions.length} из {data.total}. Данные загружаются
          серверными страницами.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
          >
            <ChevronLeft /> Назад
          </Button>
          <span className="px-2 tabular-nums">
            {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
          </span>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={data.page * data.pageSize >= data.total}
            onClick={() => setPage(data.page + 1)}
          >
            Далее <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  options,
  currentValue,
}: {
  name: string;
  label: string;
  options: Array<Record<string, unknown>>;
  currentValue?: string;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Select name={name} defaultValue={currentValue || undefined}>
        <SelectTrigger id={name} className="mt-1 min-h-11">
          <SelectValue placeholder="Все" />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={String(item.id)} value={String(item.id)}>
              {String(item.name || item.full_name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ManualQuestionButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <div className="relative">
      <Button className="min-h-11" onClick={() => setOpen((value) => !value)}>
        <Plus /> Добавить вопрос
      </Button>
      {open && (
        <Card className="absolute right-0 top-12 z-30 w-[min(92vw,30rem)] shadow-xl">
          <CardContent className="p-4">
            <form
              className="space-y-3"
              action={(formData) =>
                startTransition(async () => {
                  try {
                    await createManualMeetingQuestionV2({
                      title: String(formData.get("title")),
                      description: String(formData.get("description") || ""),
                      priority: String(formData.get("priority") || "normal"),
                    });
                    toast.success("Вопрос добавлен");
                    setOpen(false);
                    onCreated();
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Не удалось создать вопрос",
                    );
                  }
                })
              }
            >
              <div>
                <Label htmlFor="manual-title">Вопрос</Label>
                <Input
                  id="manual-title"
                  name="title"
                  required
                  minLength={2}
                  className="mt-1 min-h-11"
                />
              </div>
              <div>
                <Label htmlFor="manual-description">Контекст</Label>
                <Textarea
                  id="manual-description"
                  name="description"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="manual-priority">Приоритет</Label>
                <select
                  id="manual-priority"
                  name="priority"
                  className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                >
                  Отмена
                </Button>
                <Button disabled={pending}>Создать</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
