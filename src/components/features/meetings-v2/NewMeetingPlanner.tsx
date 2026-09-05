"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { saveMeetingScheduleV2 } from "@/app/(protected)/meetings/v2-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function NewMeetingPlanner({
  templates,
}: {
  templates: Array<Record<string, unknown>>;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(String(templates[0]?.id || ""));
  const [kind, setKind] = useState<
    "one_time" | "weekly" | "monthly" | "interval"
  >("one_time");
  const [endMode, setEndMode] = useState<"never" | "date" | "count">("never");
  const [pending, startTransition] = useTransition();
  const template = templates.find((item) => item.id === templateId);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Button
        variant="ghost"
        className="min-h-11"
        onClick={() => router.push("/meetings")}
      >
        <ArrowLeft /> К совещаниям
      </Button>
      <header>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <CalendarClock className="h-4 w-4" /> Планирование
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Запланировать совещание
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Одна встреча и повторяющаяся серия используют один и тот же шаблон.
        </p>
      </header>
      {templates.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Параметры встречи</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              action={(formData) =>
                startTransition(async () => {
                  try {
                    const result = await saveMeetingScheduleV2({
                      templateId,
                      recurrenceKind: kind,
                      startDate: String(formData.get("startDate")),
                      startTime: String(formData.get("startTime")),
                      timezone: "Europe/Uzhgorod",
                      durationMinutes: Number(formData.get("duration")),
                      weekdays: formData.getAll("weekdays").map(Number),
                      monthDay: Number(formData.get("monthDay") || 0) || null,
                      intervalDays:
                        Number(formData.get("intervalDays") || 0) || null,
                      endDate:
                        endMode === "date"
                          ? String(formData.get("endDate") || "") || null
                          : null,
                      occurrenceCount:
                        endMode === "count"
                          ? Number(formData.get("occurrenceCount") || 0) || null
                          : null,
                    });
                    toast.success(`Создано встреч: ${result.occurrences}`);
                    router.push("/meetings");
                    router.refresh();
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Не удалось создать встречу",
                    );
                  }
                })
              }
            >
              <div>
                <Label>Шаблон совещания</Label>
                <Select
                  value={templateId}
                  onValueChange={(value) => setTemplateId(value || "")}
                >
                  <SelectTrigger className="mt-1 min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((item) => (
                      <SelectItem key={String(item.id)} value={String(item.id)}>
                        {String(item.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {Boolean(template?.description) && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {String(template?.description)}
                  </p>
                )}
              </div>
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
                    <SelectItem value="interval">
                      Через интервал дней
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <DateField
                  label="Дата начала"
                  name="startDate"
                  type="date"
                  required
                />
                <DateField
                  label="Время"
                  name="startTime"
                  type="time"
                  defaultValue="10:00"
                  required
                />
                <DateField
                  label="Длительность, минут"
                  name="duration"
                  type="number"
                  defaultValue={Number(
                    template?.default_duration_minutes || 60,
                  )}
                  min={15}
                  max={480}
                  required
                />
              </div>
              {kind === "weekly" && (
                <div>
                  <Label>Дни недели</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(
                      (day, index) => (
                        <label
                          key={day}
                          className="flex min-h-11 items-center gap-2 rounded-lg border px-3"
                        >
                          <Checkbox
                            name="weekdays"
                            value={String(index + 1)}
                            defaultChecked={index === 0}
                          />
                          {day}
                        </label>
                      ),
                    )}
                  </div>
                </div>
              )}
              {kind === "monthly" && (
                <DateField
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
                <DateField
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
                <div className="space-y-3">
                  <div>
                    <Label>Окончание серии</Label>
                    <Select
                      value={endMode}
                      onValueChange={(value) =>
                        setEndMode(value as typeof endMode)
                      }
                    >
                      <SelectTrigger className="mt-1 min-h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Без окончания</SelectItem>
                        <SelectItem value="date">В выбранную дату</SelectItem>
                        <SelectItem value="count">
                          После количества встреч
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {endMode === "date" && (
                    <DateField
                      label="Дата окончания"
                      name="endDate"
                      type="date"
                      required
                    />
                  )}
                  {endMode === "count" && (
                    <DateField
                      label="Количество встреч"
                      name="occurrenceCount"
                      type="number"
                      min={1}
                      max={520}
                      required
                    />
                  )}
                </div>
              )}
              <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                Повестка будет обновляться автоматически до нажатия «Начать».
                Для бессрочной серии создаётся окно на 90 дней.
              </div>
              <Button disabled={pending || !templateId} className="min-h-11">
                <CheckCircle2 />{" "}
                {kind === "one_time" ? "Создать встречу" : "Создать серию"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="font-medium">Нет доступных шаблонов совещаний</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Сначала создайте шаблон в настройках модуля.
            </p>
            <Button
              className="mt-4 min-h-11"
              onClick={() => router.push("/admin/settings/meetings")}
            >
              Открыть конструктор
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DateField({
  label,
  name,
  ...props
}: { label: string; name: string } & React.ComponentProps<typeof Input>) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className="mt-1 min-h-11" {...props} />
    </div>
  );
}
