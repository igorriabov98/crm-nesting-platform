import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CircleGauge,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Plus,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ROUTES } from "@/lib/constants/routes";
import { cn } from "@/lib/utils";
import { formatMeetingDate, MeetingStatus } from "./MeetingStatus";

type DashboardProps = {
  data: {
    upcoming: Array<Record<string, unknown>>;
    list: Array<Record<string, unknown>>;
    total: number;
    page: number;
    pageSize: number;
    metrics: {
      meetingsThisMonth: number;
      openQuestions: number;
      unassignedQuestions: number;
      controlledQuestions: number;
    };
  };
  canManage: boolean;
  canOpenSettings: boolean;
};

function nested<T>(value: unknown): T | null {
  return (Array.isArray(value) ? value[0] : value) as T | null;
}

function questionCounts(value: unknown) {
  const questions = Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : [];
  return {
    total: questions.length,
    critical: questions.filter((item) => item.priority === "critical").length,
    control: questions.filter((item) => item.status === "on_control").length,
  };
}

export function MeetingsOperationsDashboard({
  data,
  canManage,
  canOpenSettings,
}: DashboardProps) {
  const next = data.upcoming[0];
  const nextTemplate = next
    ? nested<Record<string, unknown>>(next.template)
    : null;
  const nextCounts = next
    ? questionCounts(next.questions)
    : { total: 0, critical: 0, control: 0 };
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CircleGauge className="h-4 w-4" /> Операционный штаб
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Совещания
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Встречи, вопросы и контроль решений в одном рабочем потоке.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
            href={ROUTES.MEETINGS_AGENDA_POOL}
          >
            <ListChecks /> Пул повесток
          </Link>
          {canOpenSettings && (
            <Link
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
              href={ROUTES.ADMIN_MEETINGS_SETTINGS}
            >
              <Settings2 /> Конструктор
            </Link>
          )}
          {canManage && (
            <Link
              className={cn(buttonVariants(), "min-h-11")}
              href={ROUTES.MEETINGS_NEW}
            >
              <Plus /> Запланировать
            </Link>
          )}
        </div>
      </header>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Сводка"
      >
        {[
          {
            label: "Совещаний в месяце",
            value: data.metrics.meetingsThisMonth,
            icon: CalendarDays,
          },
          {
            label: "Открытых вопросов",
            value: data.metrics.openQuestions,
            icon: ListChecks,
          },
          {
            label: "Без маршрута",
            value: data.metrics.unassignedQuestions,
            icon: AlertCircle,
          },
          {
            label: "На контроле",
            value: data.metrics.controlledQuestions,
            icon: ShieldAlert,
          },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">
                  {metric.value}
                </p>
              </div>
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <metric.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <Card className="overflow-hidden border-primary/20">
          <CardHeader className="border-b bg-primary/5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Ближайшая встреча
                </p>
                <CardTitle className="mt-2 text-2xl">
                  {next
                    ? String(next.title || nextTemplate?.name || "Совещание")
                    : "Нет запланированных встреч"}
                </CardTitle>
              </div>
              {next && <MeetingStatus value={String(next.status)} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {next ? (
              <>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-primary" />
                    {formatMeetingDate(
                      next.starts_at ||
                        `${next.meeting_date}T${next.meeting_time}`,
                      true,
                    )}
                  </span>
                  <Badge variant="secondary">{nextCounts.total} вопросов</Badge>
                  {nextCounts.critical > 0 && (
                    <Badge variant="destructive">
                      {nextCounts.critical} критичных
                    </Badge>
                  )}
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                    <span>Подготовка повестки</span>
                    <span>
                      {nextCounts.total
                        ? "Повестка сформирована"
                        : "Ожидает вопросов"}
                    </span>
                  </div>
                  <Progress value={nextCounts.total ? 100 : 12} />
                </div>
                <Link
                  className={buttonVariants()}
                  href={`/meetings/${next.id}`}
                >
                  Открыть карточку <ArrowRight />
                </Link>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Создайте шаблон и расписание — ближайшие встречи появятся здесь
                автоматически.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Нагрузка ближайших повесток
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.upcoming.slice(0, 5).map((meeting) => {
              const counts = questionCounts(meeting.questions);
              return (
                <Link
                  key={String(meeting.id)}
                  href={`/meetings/${meeting.id}`}
                  className="block rounded-xl border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {String(meeting.title || "Совещание")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatMeetingDate(meeting.starts_at, true)}
                      </p>
                    </div>
                    <Badge
                      variant={counts.critical ? "destructive" : "secondary"}
                    >
                      {counts.total}
                    </Badge>
                  </div>
                </Link>
              );
            })}
            {data.upcoming.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                На горизонте нет встреч.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Календарь и история</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Серверный список, {data.total} записей — архив загружается
              постранично.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Дата</th>
                  <th className="px-5 py-3 font-medium">Совещание</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 text-right font-medium">Повестка</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((meeting) => {
                  const counts = questionCounts(meeting.questions);
                  return (
                    <tr
                      key={String(meeting.id)}
                      className="border-b last:border-0"
                    >
                      <td className="whitespace-nowrap px-5 py-4">
                        {formatMeetingDate(
                          meeting.starts_at ||
                            `${meeting.meeting_date}T${meeting.meeting_time}`,
                          true,
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`/meetings/${meeting.id}`}
                        >
                          {String(
                            meeting.title ||
                              nested<Record<string, unknown>>(meeting.template)
                                ?.name ||
                              "Совещание",
                          )}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <MeetingStatus value={String(meeting.status)} />
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums">
                        {counts.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="divide-y md:hidden">
            {data.list.map((meeting) => (
              <Link
                href={`/meetings/${meeting.id}`}
                key={String(meeting.id)}
                className="flex min-h-20 items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-medium">
                    {String(meeting.title || "Совещание")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMeetingDate(meeting.starts_at, true)}
                  </p>
                </div>
                <MeetingStatus value={String(meeting.status)} />
              </Link>
            ))}
          </div>
          {data.list.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              Совещания не найдены.
            </p>
          )}
          {data.total > 0 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground sm:flex-row">
              <span>
                Страница {data.page} из{" "}
                {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <div className="flex gap-2">
                <Link
                  aria-disabled={data.page <= 1}
                  tabIndex={data.page <= 1 ? -1 : undefined}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "min-h-11",
                    data.page <= 1 && "pointer-events-none opacity-50",
                  )}
                  href={
                    data.page <= 2
                      ? ROUTES.MEETINGS
                      : `${ROUTES.MEETINGS}?page=${data.page - 1}`
                  }
                >
                  <ChevronLeft /> Назад
                </Link>
                <Link
                  aria-disabled={data.page * data.pageSize >= data.total}
                  tabIndex={
                    data.page * data.pageSize >= data.total ? -1 : undefined
                  }
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "min-h-11",
                    data.page * data.pageSize >= data.total &&
                      "pointer-events-none opacity-50",
                  )}
                  href={`${ROUTES.MEETINGS}?page=${data.page + 1}`}
                >
                  Далее <ChevronRight />
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
