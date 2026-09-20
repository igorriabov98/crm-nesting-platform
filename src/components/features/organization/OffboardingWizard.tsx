"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  changeOrganizationUserStatus,
  archiveOrganizationUser,
  handoffObligation,
  previewOffboarding,
} from "@/lib/actions/organization";
import type {
  Obligation,
  OffboardingPreview,
  OrganizationData,
  OrganizationUser,
} from "@/lib/organization/types";

export function OffboardingWizard({
  user,
  mode = "block",
  data,
  onClose,
}: {
  user: OrganizationUser;
  mode?: "block" | "archive";
  data: OrganizationData;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<OffboardingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<null | { authPending: boolean }>(null);
  const operations = useRef(new Map<string, string>());
  const reload = useCallback(async () => {
    const result = await previewOffboarding(user.id);
    if (result.error || !result.data)
      throw new Error(result.error || "Не удалось проверить обязанности");
    setPreview(result.data);
    return result.data;
  }, [user.id]);
  useEffect(() => {
    let cancelled = false;
    previewOffboarding(user.id).then((result) => {
      if (!cancelled) {
        setPreview(result.data);
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Проверка не выполнена",
      );
    } finally {
      setBusy(false);
    }
  }
  function successors(item: Obligation) {
    if (item.source === "head" || item.source === "supervisor") {
      const source = data.memberships.find((member) => member.id === item.id);
      return data.memberships
        .filter(
          (member) =>
            member.department_id === source?.department_id &&
            member.user_id !== user.id &&
            member.user_id !==
              (item.source === "supervisor" ? source?.user_id : null) &&
            data.users.some((u) => u.id === member.user_id && u.is_active),
        )
        .map((member) => ({
          value: member.id,
          userId: member.user_id,
          membershipId: member.id,
          label: `${data.users.find((u) => u.id === member.user_id)?.full_name} · ${data.positions.find((p) => p.id === member.position_id)?.name || "Без должности"}`,
        }));
    }
    return data.users
      .filter((u) => u.id !== user.id && u.is_active)
      .map((u) => ({
        value: u.id,
        userId: u.id,
        membershipId: null,
        label: u.full_name || u.email || "Пользователь",
      }));
  }
  async function transfer(item: Obligation) {
    const target = successors(item).find(
      (option) => option.value === choices[item.key],
    );
    if (!target) return;
    const operationKey = [item.key, item.fingerprint, target.value].join(":");
    if (!operations.current.has(operationKey))
      operations.current.set(operationKey, crypto.randomUUID());
    setBusy(true);
    setError(null);
    try {
      const result = await handoffObligation({
        operationId: operations.current.get(operationKey)!,
        userId: user.id,
        targetUserId: target.userId,
        targetMembershipId: target.membershipId,
        key: item.key,
        fingerprint: item.fingerprint,
      });
      if (!result.success)
        throw new Error(result.error || "Передача не выполнена");
      setCompleted((rows) => [
        ...rows,
        `${item.label}: ${item.title} → ${target.label}`,
      ]);
      await reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Передача не выполнена",
      );
      try {
        await reload();
      } catch {
        /* Keep the last verified list visible with the error. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function block() {
    setBusy(true);
    setError(null);
    try {
      const latest = await reload();
      if (latest.obligations.length)
        throw new Error(
          "Обнаружены действующие обязанности. Передайте их перед блокировкой.",
        );
      const result =
        mode === "archive"
          ? await archiveOrganizationUser(user.id, latest.version)
          : await changeOrganizationUserStatus(user.id, false, latest.version);
      if (!result.success)
        throw new Error(result.error || "Блокировка не выполнена");
      setBlocked({ authPending: result.authPending });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Блокировка не выполнена",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "archive" ? "Удаление пользователя" : "Передача дел"}:{" "}
            {user.full_name}
          </DialogTitle>
          <DialogDescription>
            Проверьте обязанности, назначьте преемников и повторно проверьте
            результат перед {mode === "archive" ? "удалением" : "блокировкой"}.
            {mode === "archive" &&
              " Пользователь будет перемещён в архив, вход закрыт. История, авторство и назначения сохранятся. Восстановление доступно из списка «Удалённые в архив»."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            {error}
          </p>
        )}
        {blocked ? (
          <div className="space-y-4">
            <p role="status">
              {mode === "archive"
                ? "Пользователь удалён в архив."
                : "Аккаунт заблокирован в CRM."}{" "}
              {blocked.authPending
                ? "Закрытие входа ожидает синхронизации. Доступ к данным уже закрыт."
                : "Вход в систему закрыт."}
            </p>
            <Button onClick={onClose}>Готово</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {preview
                  ? `Осталось обязанностей: ${preview.obligations.length}`
                  : "Проверяем обязанности…"}
              </p>
              <Button variant="outline" disabled={busy} onClick={refresh}>
                Повторить проверку
              </Button>
            </div>
            <div className="space-y-3">
              {preview?.obligations.map((item) => (
                <article
                  key={item.key}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {item.label}
                    </p>
                    <h3 className="font-medium">{item.title}</h3>
                  </div>
                  {item.transferable ? (
                    <div className="flex flex-wrap gap-2">
                      <select
                        aria-label={`Преемник: ${item.title}`}
                        className="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                        value={choices[item.key] || ""}
                        disabled={busy}
                        onChange={(event) =>
                          setChoices((values) => ({
                            ...values,
                            [item.key]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Выберите преемника</option>
                        {successors(item).map((target) => (
                          <option key={target.value} value={target.value}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                      {successors(item).length === 0 && (
                        <p className="w-full text-sm text-muted-foreground">
                          Нет подходящего преемника. Сначала добавьте назначение
                          другому активному пользователю в этом отделе.
                        </p>
                      )}
                      <Button
                        disabled={busy || !choices[item.key]}
                        onClick={() => transfer(item)}
                      >
                        Передать
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-800">
                      {item.reason ||
                        "Измените назначение через штатный процесс отдела."}
                    </p>
                  )}
                  <Link
                    className="inline-flex min-h-9 items-center text-sm text-primary underline"
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть связанный раздел
                  </Link>
                </article>
              ))}
            </div>
            {completed.length > 0 && (
              <div className="rounded-lg bg-muted p-4">
                <h3 className="font-medium">
                  Уже передано: {completed.length}
                </h3>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                  {completed.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Эти изменения сохранены, даже если остальные обязанности ещё
                  не переданы.
                </p>
              </div>
            )}
            {preview?.obligations.length === 0 && (
              <p className="rounded-lg border p-4 text-sm">
                Действующих обязанностей не найдено. Перед блокировкой система
                проверит их ещё раз. Аккаунт, история и назначения сохранятся.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Закрыть
              </Button>
              <Button
                disabled={
                  busy || !preview || preview.obligations.length > 0 || !!error
                }
                onClick={block}
              >
                {busy
                  ? "Выполняем…"
                  : mode === "archive"
                    ? "Проверить и удалить в архив"
                    : "Проверить и заблокировать"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
