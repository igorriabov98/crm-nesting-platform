import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  planned: "Запланировано",
  in_progress: "Идёт сейчас",
  completed: "Завершено",
  cancelled: "Отменено",
  new: "Новый",
  assigned: "Назначен",
  in_meeting: "На совещании",
  on_control: "На контроле",
  deferred: "Отложен",
  resolved: "Решён",
  auto_closed: "Закрыт автоматически",
  dismissed: "Отклонён",
  draft: "Черновик",
  published: "Опубликовано",
  paused: "Приостановлено",
  archived: "Архивировано",
  pending: "Ожидает выполнения",
  decision: "Решение",
  task: "Задача",
  defer: "Перенос",
  dismiss: "Отклонение",
  source_update: "Изменение источника",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  critical: "Критичный",
};

export function MeetingStatus({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const tone =
    value === "critical" || value === "cancelled"
      ? "border-destructive/25 bg-destructive/10 text-destructive"
      : value === "high" || value === "deferred"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : value === "completed" ||
            value === "resolved" ||
            value === "auto_closed"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : value === "in_progress" || value === "in_meeting"
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("font-medium", tone, className)}>
      {STATUS_LABELS[value] || PRIORITY_LABELS[value] || value}
    </Badge>
  );
}

export function formatMeetingDate(value: unknown, withTime = false) {
  if (!value) return "Дата не назначена";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(
    "ru-RU",
    withTime
      ? { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Uzhgorod" }
      : { dateStyle: "long", timeZone: "Europe/Uzhgorod" },
  ).format(date);
}
