"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Users,
  Network,
  Settings,
  Trash2,
  Briefcase,
  Plus,
  ShieldCheck,
  Crown,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAccessPreview } from "@/components/features/settings/UserAccessPreview";
import { ACCESS_REFRESH_EVENT } from "@/components/providers/PermissionProvider";
import { hasPermission } from "@/lib/permissions/resources";
import {
  applyOrganizationChange,
  changeOrganizationUserStatus,
  createOrganizationUser,
  getOrganizationHistory,
  retryOrganizationAuthSync,
  sendOrganizationPasswordReset,
  setOrganizationAdministrator,
} from "@/lib/actions/organization";
import type {
  OrganizationAudit,
  OrganizationChange,
  OrganizationData,
  OrganizationMembership,
  OrganizationUser,
} from "@/lib/organization/types";
import { DepartmentTree } from "./DepartmentTree";
import { OffboardingWizard } from "./OffboardingWizard";

type Editor = {
  kind: "user" | "profile" | "assignment" | "department" | "position";
  id: string | null;
  userId?: string;
  values: Record<string, string | number | boolean | null | undefined>;
};
const selectClass =
  "min-h-11 w-full rounded-md border bg-background px-3 text-sm";
const criticalDepartments = new Set([
  "Финансовый отдел",
  "Отдел планирования",
  "Технический отдел",
  "Брокерский",
  "Снабжение",
]);
const tabs = [
  ["users", "Пользователи", Users],
  ["departments", "Отделы и структура", Network],
  ["positions", "Должности", Briefcase],
] as const;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
const auditFields: Record<string, string> = {
  full_name: "Имя",
  email: "Email",
  is_active: "Активен",
  name: "Название",
  department_id: "Отдел",
  position_id: "Должность",
  factory_id: "Завод",
  parent_id: "Родительский отдел",
  is_primary: "Основное назначение",
  is_department_head: "Руководитель отдела",
  reports_to_membership_id: "Непосредственный руководитель",
  head_user_id: "Руководитель отдела",
  enabled: "Статус администратора",
  role: "Системные полномочия",
  targetUserId: "Преемник",
  title: "Обязанность",
};
function auditValue(
  key: string,
  value: unknown,
  data: OrganizationData,
): string {
  if (value === null || value === undefined) return "Не задано";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (key === "department_id" || key === "parent_id")
    return (
      data.departments.find((row) => row.id === value)?.name || "Архивный отдел"
    );
  if (key === "position_id")
    return (
      data.positions.find((row) => row.id === value)?.name ||
      "Архивная должность"
    );
  if (key === "factory_id")
    return (
      data.factories.find((row) => row.id === value)?.name || "Архивный завод"
    );
  if (key === "reports_to_membership_id")
    return (
      data.users.find(
        (row) =>
          row.id ===
          data.memberships.find((member) => member.id === value)?.user_id,
      )?.full_name || "Архивное назначение"
    );
  if (key === "head_user_id" || key === "targetUserId")
    return (
      data.users.find((row) => row.id === value)?.full_name ||
      "Архивный пользователь"
    );
  if (key === "role")
    return value === "crm_admin" ? "Администратор CRM" : "Обычный аккаунт";
  return String(value);
}
function History({ userId, data }: { userId: string; data: OrganizationData }) {
  const [rows, setRows] = useState<OrganizationAudit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getOrganizationHistory(userId).then((result) => {
      if (active) {
        setRows(result.data);
        setError(result.error);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);
  if (error) return <p role="alert">{error}</p>;
  if (!rows) return <p role="status">Загружаем историю…</p>;
  const labels: Record<string, string> = {
    INSERT: "Добавление",
    UPDATE: "Изменение",
    DELETE: "Удаление назначения",
    administrator: "Статус администратора",
    handoff: "Передача обязанности",
  };
  return (
    <div className="max-h-80 space-y-2 overflow-auto">
      {rows.length ? (
        rows.map((row) => (
          <details key={row.id} className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer">
              {labels[row.action] || row.action} ·{" "}
              {new Date(row.created_at).toLocaleString("ru-RU", {
                timeZone: "Europe/Uzhgorod",
              })}
            </summary>
            <p className="mt-2 text-muted-foreground">
              Изменение сохранено в журнале организации.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Кто изменил:{" "}
              {data.users.find((user) => user.id === row.actor_id)?.full_name ||
                "Системный процесс"}
            </p>
            <dl className="mt-2 space-y-1">
              {Object.entries(auditFields)
                .filter(
                  ([key]) =>
                    JSON.stringify(row.before_data?.[key]) !==
                    JSON.stringify(row.after_data?.[key]),
                )
                .map(([key, label]) => (
                  <div key={key}>
                    <dt className="inline text-muted-foreground">{label}: </dt>
                    <dd className="inline">
                      {auditValue(key, row.before_data?.[key], data)} →{" "}
                      {auditValue(key, row.after_data?.[key], data)}
                    </dd>
                  </div>
                ))}
            </dl>
          </details>
        ))
      ) : (
        <p className="text-muted-foreground">Изменений пока нет.</p>
      )}
    </div>
  );
}
export function OrganizationWorkspace({ data }: { data: OrganizationData }) {
  const router = useRouter(),
    query = useSearchParams();
  const canUsers = hasPermission(data.permissions, "admin_users", "view"),
    canDepartments = hasPermission(data.permissions, "departments", "view");
  const manageUsers = hasPermission(data.permissions, "admin_users", "manage"),
    manageDepartments = hasPermission(
      data.permissions,
      "departments",
      "manage",
    );
  const canMatrix = hasPermission(data.permissions, "access_settings", "view");
  const visibleTabs = tabs.filter(([key]) =>
    key === "users" ? canUsers : canDepartments,
  );
  const requestedTab =
    query.get("tab") === "structure"
      ? "departments"
      : query.get("tab") || "users";
  const tab = visibleTabs.some(([key]) => key === requestedTab)
    ? requestedTab
    : visibleTabs[0]?.[0] || "users";
  const [search, setSearch] = useState(""),
    [userFilter, setUserFilter] = useState("active");
  const selectedId = query.get("user") || "";
  const [editor, setEditor] = useState<Editor | null>(() =>
      query.get("create") === "user" && manageUsers
        ? { kind: "user", id: null, values: {} }
        : null,
    ),
    [busy, setBusy] = useState(false);
  const [offboardingMode, setOffboardingMode] = useState<"block" | "archive">(
    "block",
  );
  const [offboarding, setOffboarding] = useState<OrganizationUser | null>(null);
  const [review, setReview] = useState<{
    label: string;
    previewUserId?: string;
    previewVersion?: string | null;
    run: () => Promise<void>;
  } | null>(null);
  const verifyRestoration = useCallback((version: string | null) => {
    setReview((previous) =>
      previous?.previewUserId
        ? { ...previous, previewVersion: version }
        : previous,
    );
  }, []);
  const selected = data.users.find((user) => user.id === selectedId);
  const name = (id: string | null | undefined) =>
    data.users.find((user) => user.id === id)?.full_name || "Не назначен";
  const departmentName = (id: string | null | undefined) =>
    data.departments.find((department) => department.id === id)?.name ||
    "Отдел не найден";
  const membershipLabel = (member: OrganizationMembership | undefined) =>
    member
      ? `${name(member.user_id)} · ${data.positions.find((position) => position.id === member.position_id)?.name || "Без должности"} · ${departmentName(member.department_id)}`
      : "Требует уточнения назначения руководителя";
  const changed = () => {
    router.refresh();
    window.dispatchEvent(new Event(ACCESS_REFRESH_EVENT));
  };
  const membersOf = (userId: string) =>
    data.memberships.filter((member) => member.user_id === userId);
  const unresolvedSupervisors = data.memberships.filter(
    (member) => member.reports_to_user_id && !member.reports_to_membership_id,
  );
  const attention = data.users.filter(
    (user) =>
      user.is_active &&
      ((!user.is_admin && !membersOf(user.id).length) ||
        (membersOf(user.id).length > 1 &&
          !membersOf(user.id).some((member) => member.is_primary))),
  ).length;
  async function run(
    operation: () => Promise<{ success: boolean; error: string | null }>,
    message = "Изменения сохранены",
  ) {
    setBusy(true);
    try {
      const result = await operation();
      if (!result.success)
        throw new Error(result.error || "Операция не выполнена");
      toast.success(message);
      changed();
      setReview(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Операция не выполнена",
      );
      changed();
    } finally {
      setBusy(false);
    }
  }
  const change = (
    kind: OrganizationChange["kind"],
    id: string | null,
    values: OrganizationChange["data"],
  ) =>
    applyOrganizationChange({
      kind,
      id,
      data: values,
      expectedVersion: data.version,
    });
  function chooseTab(value: string) {
    router.push(`/admin/organization?tab=${value}`);
    setSearch("");
  }
  function editAssignment(member: OrganizationMembership) {
    setEditor({
      kind: "assignment",
      id: member.id,
      userId: member.user_id,
      values: {
        department_id: member.department_id,
        position_id: member.position_id,
        is_primary: member.is_primary,
        is_department_head: member.is_department_head,
        reports_to_membership_id: member.reports_to_membership_id,
        reports_to_user_id: member.reports_to_user_id,
      },
    });
  }

  function removeMember(member: OrganizationMembership) {
    setReview({
      label: `Удалить ${name(member.user_id)} из отдела «${departmentName(member.department_id)}»? Снимется только это назначение. Права по нему перестанут действовать; аккаунт и другие назначения сохранятся.`,
      run: () =>
        run(
          () => change("remove_assignment", member.id, {}),
          "Назначение удалено из отдела",
        ),
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            Пользователи и структура
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Аккаунты, назначения и руководители в одном месте.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            aria-label="Обновить организацию"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="size-4" />
            Обновить
          </Button>
          {canMatrix && (
            <Link href="/admin/settings/access">
              <Button variant="outline">
                <ShieldCheck className="size-4" />
                Матрица доступа
              </Button>
            </Link>
          )}
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Активные пользователи</p>
          <strong className="text-2xl">
            {data.users.filter((user) => user.is_active).length}
          </strong>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Действующие отделы</p>
          <strong className="text-2xl">
            {
              data.departments.filter((department) => department.is_active)
                .length
            }
          </strong>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Требуют уточнения назначений
          </p>
          <strong className="text-2xl">{attention}</strong>
        </div>
      </div>
      <nav
        aria-label="Разделы организации"
        className="flex flex-wrap gap-1 rounded-xl border bg-card p-1"
      >
        {visibleTabs.map(([key, label, Icon]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "ghost"}
            className="min-h-11"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => chooseTab(key)}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="Поиск в организации"
          placeholder="Имя, отдел или должность…"
          className="max-w-md"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {tab === "users" && (
            <select
              aria-label="Состояние пользователей"
              className="min-h-10 rounded-md border bg-background px-3 text-sm"
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
            >
              <option value="active">Активные пользователи</option>
              <option value="blocked">Заблокированные</option>
              <option value="archived">Удалённые в архив</option>
              <option value="all">Все пользователи</option>
            </select>
          )}
          {((tab === "users" && manageUsers) ||
            (tab !== "users" && manageDepartments)) && (
            <Button
              onClick={() =>
                setEditor({
                  kind:
                    tab === "users"
                      ? "user"
                      : tab === "positions"
                        ? "position"
                        : "department",
                  id: null,
                  values: {},
                })
              }
            >
              <Plus className="size-4" />
              {tab === "users"
                ? "Новый пользователь"
                : tab === "positions"
                  ? "Новая должность"
                  : "Новый отдел"}
            </Button>
          )}
        </div>
      </div>
      {tab === "users" && (
        <>
          {unresolvedSupervisors.length > 0 && (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <h2 className="font-semibold">Нужно уточнить подчинение</h2>
              <p className="mt-1 text-sm">
                У этих назначений сохранилась старая связь с руководителем.
                Нажмите «Уточнить», выберите назначение руководителя или явно
                укажите «Без непосредственного руководителя», затем сохраните.
              </p>
              {unresolvedSupervisors.map((member) => (
                <div
                  key={member.id}
                  className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {membershipLabel(member)} →{" "}
                    {name(member.reports_to_user_id)}
                  </span>
                  {manageDepartments && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editAssignment(member)}
                    >
                      Уточнить
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-4">Пользователь</th>
                  <th className="p-4">Основное назначение</th>
                  <th className="p-4">Другие назначения</th>
                  <th className="p-4">Состояние</th>
                </tr>
              </thead>
              <tbody>
                {data.users
                  .filter(
                    (user) =>
                      userFilter === "all" ||
                      (userFilter === "archived"
                        ? !!user.archived_at
                        : userFilter === "blocked"
                          ? !user.is_active && !user.archived_at
                          : user.is_active),
                  )
                  .filter((user) =>
                    `${user.full_name} ${user.email} ${membersOf(user.id)
                      .map((m) => membershipLabel(m))
                      .join(" ")}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((user) => {
                    const memberships = membersOf(user.id),
                      primary = memberships.find((member) => member.is_primary);
                    return (
                      <tr
                        key={user.id}
                        className={`border-t ${selectedId === user.id ? "bg-primary/5" : ""}`}
                      >
                        <td className="p-4">
                          <button
                            className="min-h-11 text-left font-semibold text-primary underline-offset-4 hover:underline"
                            onClick={() => {
                              router.replace(
                                `/admin/organization?tab=users&user=${user.id}`,
                                { scroll: false },
                              );
                            }}
                          >
                            {user.full_name || user.email}
                          </button>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </td>
                        <td className="p-4">
                          {primary ? (
                            <>
                              {departmentName(primary.department_id)}
                              <p className="text-xs text-muted-foreground">
                                {data.positions.find(
                                  (p) => p.id === primary.position_id,
                                )?.name || "Без должности"}
                              </p>
                            </>
                          ) : (
                            <Badge variant="outline">
                              {user.is_admin && memberships.length === 0
                                ? "Не требуется для доступа"
                                : "Требует уточнения"}
                            </Badge>
                          )}
                        </td>
                        <td className="p-4">
                          {memberships
                            .filter((member) => !member.is_primary)
                            .map((member) => (
                              <p key={member.id}>
                                {departmentName(member.department_id)}
                              </p>
                            ))}
                        </td>
                        <td className="space-y-1 p-4">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="float-right"
                            aria-label={`Настройки пользователя ${user.full_name || user.email}`}
                            onClick={() =>
                              router.replace(
                                `/admin/organization?tab=users&user=${user.id}`,
                                { scroll: false },
                              )
                            }
                          >
                            <Settings className="size-4" />
                          </Button>
                          <Badge
                            variant={user.is_active ? "secondary" : "outline"}
                          >
                            {user.archived_at
                              ? "В архиве"
                              : user.is_active
                                ? "Активен"
                                : "Заблокирован"}
                          </Badge>
                          {user.is_admin && (
                            <p>
                              <Badge>
                                <ShieldCheck className="mr-1 size-3" />
                                Администратор CRM
                              </Badge>
                            </p>
                          )}
                          {user.auth_sync_pending && (
                            <p className="text-xs text-amber-700">
                              Синхронизация входа ожидает
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {selected && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open)
                  router.replace("/admin/organization?tab=users", {
                    scroll: false,
                  });
              }}
            >
              <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle>Настройки пользователя</DialogTitle>
                  <DialogDescription>
                    Профиль, назначения, фактические права и состояние аккаунта.
                  </DialogDescription>
                </DialogHeader>
                <section
                  className="space-y-5 rounded-xl border bg-card p-5"
                  aria-label={`Карточка пользователя ${selected.full_name}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">
                        {selected.full_name || selected.email}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selected.email}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {manageUsers && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            setEditor({
                              kind: "profile",
                              id: selected.id,
                              values: {
                                full_name: selected.full_name,
                                email: selected.email,
                                telegram_chat_id: selected.telegram_chat_id,
                                factory_id: selected.factory_id,
                              },
                            })
                          }
                        >
                          Редактировать пользователя
                        </Button>
                      )}
                      {manageDepartments && selected.is_active && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            setEditor({
                              kind: "assignment",
                              id: null,
                              userId: selected.id,
                              values: {
                                is_primary: membersOf(selected.id).length === 0,
                              },
                            })
                          }
                        >
                          Добавить назначение
                        </Button>
                      )}
                    </div>
                  </div>
                  {!selected.is_active && (
                    <p className="rounded-lg bg-muted p-3 text-sm">
                      Аккаунт заблокирован. Назначения сохранены для истории и
                      проверки при восстановлении.
                    </p>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    {membersOf(selected.id).map((member) => (
                      <div
                        key={member.id}
                        className="space-y-2 rounded-lg border p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>
                            {departmentName(member.department_id)}
                          </strong>
                          {member.is_primary && (
                            <Badge variant="secondary">Основное</Badge>
                          )}
                          {member.is_department_head && (
                            <Badge variant="outline">
                              <Crown className="mr-1 size-3" />
                              Руководитель отдела
                            </Badge>
                          )}
                        </div>
                        <p>
                          {data.positions.find(
                            (position) => position.id === member.position_id,
                          )?.name || "Без должности"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Подчинение:{" "}
                          {member.reports_to_membership_id
                            ? membershipLabel(
                                data.memberships.find(
                                  (row) =>
                                    row.id === member.reports_to_membership_id,
                                )!,
                              )
                            : member.reports_to_user_id
                              ? "Требует уточнения назначения руководителя"
                              : "Не задано"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {manageDepartments && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => editAssignment(member)}
                            >
                              Изменить
                            </Button>
                          )}
                          {manageDepartments && !member.is_primary && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                run(() =>
                                  change("assignment", member.id, {
                                    is_primary: true,
                                  }),
                                )
                              }
                            >
                              Сделать основным
                            </Button>
                          )}
                          {manageDepartments && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setReview({
                                  label: `Снять назначение «${departmentName(member.department_id)}» у ${selected.full_name}? Это может изменить доступ.`,
                                  run: () =>
                                    run(
                                      () =>
                                        change(
                                          "remove_assignment",
                                          member.id,
                                          {},
                                        ),
                                      "Назначение снято",
                                    ),
                                })
                              }
                            >
                              Снять назначение
                            </Button>
                          )}
                          {canMatrix && (
                            <Link
                              className="inline-flex min-h-9 items-center gap-1 px-2 text-sm text-primary underline"
                              href={`/admin/settings/access?department=${member.department_id}`}
                            >
                              Матрица отдела
                              <ArrowRight className="size-3" />
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!selected.is_admin &&
                    membersOf(selected.id).length === 0 && (
                      <p className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                        Назначения отсутствуют. Права через матрицу не выдаются.
                      </p>
                    )}
                  <details className="rounded-lg border p-4">
                    <summary className="min-h-8 cursor-pointer font-semibold">
                      Фактические права
                    </summary>
                    <div className="mt-3">
                      <UserAccessPreview userId={selected.id} />
                    </div>
                  </details>
                  <details className="rounded-lg border p-4">
                    <summary className="min-h-8 cursor-pointer font-semibold">
                      История изменений
                    </summary>
                    <div className="mt-3">
                      <History userId={selected.id} data={data} />
                    </div>
                  </details>
                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    {data.isAdmin &&
                      selected.id !== data.currentUserId &&
                      selected.is_active && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setReview({
                              label: selected.is_admin
                                ? `Снять статус администратора CRM у ${selected.full_name}? Доступ будет определяться назначениями и матрицей.`
                                : `Назначить ${selected.full_name} администратором CRM с полным доступом ко всем разделам?`,
                              run: () =>
                                run(() =>
                                  setOrganizationAdministrator(
                                    selected.id,
                                    !selected.is_admin,
                                    data.version,
                                  ),
                                ),
                            })
                          }
                        >
                          {selected.is_admin
                            ? "Снять статус администратора"
                            : "Назначить администратором CRM"}
                        </Button>
                      )}
                    {manageUsers && selected.id !== data.currentUserId && (
                      <Button
                        variant={selected.is_active ? "outline" : "default"}
                        onClick={() =>
                          selected.is_active
                            ? (setOffboardingMode("block"),
                              setOffboarding(selected))
                            : setReview({
                                label: `Восстановить вход для ${selected.full_name}? Проверьте права, которые будут действовать после восстановления.`,
                                previewUserId: selected.id,
                                run: () =>
                                  run(
                                    () =>
                                      changeOrganizationUserStatus(
                                        selected.id,
                                        true,
                                        data.version,
                                      ),
                                    "Восстановление доступа сохранено",
                                  ),
                              })
                        }
                      >
                        {selected.is_active
                          ? "Передать дела и заблокировать"
                          : "Восстановить доступ"}
                      </Button>
                    )}
                    {manageUsers &&
                      selected.id !== data.currentUserId &&
                      !selected.archived_at && (
                        <Button
                          variant="outline"
                          className="text-destructive"
                          onClick={() => {
                            setOffboardingMode("archive");
                            setOffboarding(selected);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Удалить пользователя
                        </Button>
                      )}
                    {manageUsers && selected.auth_sync_pending && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          run(
                            () => retryOrganizationAuthSync(selected.id),
                            "Вход синхронизирован",
                          )
                        }
                      >
                        Повторить синхронизацию входа
                      </Button>
                    )}
                  </div>
                </section>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}
      {tab === "departments" && (
        <DepartmentTree
          data={data}
          search={search}
          canMatrix={canMatrix}
          canManage={manageDepartments}
          edit={(department) =>
            setEditor({
              kind: "department",
              id: department.id,
              values: {
                name: department.name,
                description: department.description,
                parent_id: department.parent_id,
                factory_id: department.factory_id,
              },
            })
          }
          create={(parentId) =>
            setEditor({
              kind: "department",
              id: null,
              values: { parent_id: parentId },
            })
          }
          archive={(department) =>
            setReview({
              label: `${department.is_active ? "Архивировать" : "Восстановить"} отдел «${department.name}»?`,
              run: () =>
                run(() =>
                  change("department", department.id, {
                    is_active: !department.is_active,
                  }),
                ),
            })
          }
          editMember={editAssignment}
          removeMember={removeMember}
        />
      )}
      {tab === "positions" && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.positions
            .filter((position) =>
              position.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((position) => (
              <section
                key={position.id}
                className="space-y-3 rounded-xl border bg-card p-4"
              >
                <h2 className="font-semibold">
                  {position.name}{" "}
                  {!position.is_active && (
                    <Badge variant="outline">Архив</Badge>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {position.description || "Описание не задано"} · Уровень{" "}
                  {position.level}
                </p>
                <p className="text-sm">
                  Назначений:{" "}
                  {
                    data.memberships.filter(
                      (member) => member.position_id === position.id,
                    ).length
                  }
                </p>
                {position.name === "Администратор CRM" && (
                  <p className="text-sm text-muted-foreground">
                    Название должности не выдаёт административный доступ.
                  </p>
                )}
                {manageDepartments && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setEditor({
                          kind: "position",
                          id: position.id,
                          values: {
                            name: position.name,
                            description: position.description,
                            level: position.level,
                          },
                        })
                      }
                    >
                      Изменить
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setReview({
                          label: `${position.is_active ? "Архивировать" : "Восстановить"} должность «${position.name}»?`,
                          run: () =>
                            run(() =>
                              change("position", position.id, {
                                is_active: !position.is_active,
                              }),
                            ),
                        })
                      }
                    >
                      {position.is_active ? "В архив" : "Восстановить"}
                    </Button>
                  </div>
                )}
              </section>
            ))}
        </div>
      )}
      {editor && (
        <OrganizationEditor
          key={`${editor.kind}:${editor.id || editor.userId || "new"}`}
          editor={editor}
          data={data}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            changed();
          }}
        />
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Проверьте изменение</DialogTitle>
            <DialogDescription>{review?.label}</DialogDescription>
          </DialogHeader>
          {review?.previewUserId && (
            <UserAccessPreview
              userId={review.previewUserId}
              afterRestore
              onVerified={verifyRestoration}
            />
          )}
          {review?.previewVersion && review.previewVersion !== data.version && (
            <p role="alert">
              Структура или права изменились. Закройте окно и обновите данные
              перед восстановлением.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Отмена
            </Button>
            <Button
              disabled={
                busy ||
                (!!review?.previewUserId &&
                  review.previewVersion !== data.version)
              }
              onClick={() => review?.run()}
            >
              {busy ? "Применяем…" : "Применить"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {offboarding && (
        <OffboardingWizard
          user={offboarding}
          mode={offboardingMode}
          data={data}
          onClose={() => {
            setOffboarding(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

function OrganizationEditor({
  editor,
  data,
  onClose,
  onSaved,
}: {
  editor: Editor;
  data: OrganizationData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState(
    String(editor.values.department_id || ""),
  );
  const savedProfileEmail = String(editor.values.email || "");
  const [profileEmail, setProfileEmail] = useState(savedProfileEmail);
  const profileUser = editor.id
    ? data.users.find((user) => user.id === editor.id)
    : undefined;
  const [review, setReview] = useState<OrganizationChange | null>(null);
  const isUser = editor.kind === "user",
    isProfile = editor.kind === "profile",
    isAssignment = editor.kind === "assignment";
  const titles = {
    user: "Новый пользователь",
    profile: "Профиль пользователя",
    assignment: "Назначение сотрудника",
    department: "Отдел",
    position: "Должность",
  };
  const value = (key: string) => String(editor.values[key] ?? "");
  async function sendPasswordReset() {
    if (!editor.id || !isProfile) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendOrganizationPasswordReset(editor.id);
      if (!result.success)
        throw new Error(result.error || "Не удалось отправить письмо");
      toast.success(`Письмо для сброса пароля отправлено на ${result.email}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось отправить письмо",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget),
      values: Record<string, string | number | boolean | null> = {};
    for (const [key, val] of form) values[key] = String(val).trim() || null;
    if (isAssignment || isUser) {
      values.is_department_head = form.get("is_department_head") === "on";
      values.department_id = departmentId;
    }
    if (isAssignment) {
      values.is_primary = form.get("is_primary") === "on";
      if (values.reports_to_membership_id === "unresolved") {
        setError(
          "Выберите назначение руководителя или явно укажите «Без непосредственного руководителя».",
        );
        return;
      }
      const duplicate = data.memberships.find(
        (m) =>
          m.id !== editor.id &&
          m.user_id === editor.userId &&
          m.department_id === departmentId &&
          m.position_id === values.position_id,
      );
      if (duplicate) {
        if (!editor.id) {
          setError(
            "Такое назначение уже существует. Откройте его в карточке пользователя.",
          );
          return;
        }
        setReview({
          kind: "consolidate_assignment",
          id: editor.id,
          data: { target_membership_id: duplicate.id },
          expectedVersion: data.version,
        });
        return;
      }
    }
    if (isAssignment && !editor.id) values.user_id = editor.userId || "";
    if (editor.kind === "position")
      values.level = Number(form.get("level") || 0);
    if (isUser) {
      setBusy(true);
      try {
        const result = await createOrganizationUser({
          email: String(values.email),
          password: String(form.get("password")),
          full_name: String(values.full_name),
          department_id: departmentId,
          position_id: String(values.position_id),
          factory_id: values.factory_id as string | null,
          reports_to_membership_id: values.reports_to_membership_id as
            string | null,
          is_department_head: values.is_department_head === true,
          expectedVersion: data.version,
        });
        if (!result.success)
          throw new Error(result.error || "Не удалось создать пользователя");
        toast.success(
          result.authPending
            ? "Аккаунт создан. Вход ожидает синхронизации."
            : "Пользователь создан",
        );
        onSaved();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Ошибка создания");
      } finally {
        setBusy(false);
      }
    } else
      setReview({
        kind: editor.kind as OrganizationChange["kind"],
        id: editor.id,
        data: values,
        expectedVersion: data.version,
      });
  }
  async function apply() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyOrganizationChange(review);
      if (!result.success)
        throw new Error(result.error || "Не удалось сохранить");
      toast.success("Изменения сохранены");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сохранения");
      setReview(null);
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
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{titles[editor.kind]}</DialogTitle>
          <DialogDescription>
            {isAssignment
              ? "Права объединяются по всем назначениям. Основное назначение используется для отображения."
              : "Изменения сохраняются вместе с записью в журнале организации."}
          </DialogDescription>
        </DialogHeader>
        {isUser &&
          data.departments.find((department) => department.id === departmentId)
            ?.head_user_id && (
            <p className="rounded-lg bg-muted p-3 text-sm">
              У этого отдела уже есть руководитель. Если отметить нового
              пользователя руководителем, прежний станет сотрудником; его права
              изменятся по матрице отдела.
            </p>
          )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            {error}
          </p>
        )}
        {review && (
          <div className="space-y-4">
            <h3 className="font-semibold">Проверьте перед сохранением</h3>
            <p className="text-sm">
              {review.kind === "consolidate_assignment"
                ? "Такое назначение уже существует в выбранном отделе. При объединении исходное назначение будет удалено, а должность, руководитель и права существующего назначения сохранятся. Если исходное было основным, основным станет оставшееся. Перед объединением необходимо передать руководство и подчинённых."
                : isAssignment
                  ? "Изменение отдела или признака руководителя влияет на доступ по матрице. При назначении руководителем прежний руководитель отдела станет сотрудником."
                  : "Будут применены значения, указанные в форме."}
            </p>
            <dl className="space-y-2 text-sm">
              {Object.entries(review.data).map(([key, val]) => {
                const labels: Record<string, string> = {
                  full_name: "Имя",
                  email: "Email",
                  target_membership_id: "Существующее назначение",
                  telegram_chat_id: "Telegram",
                  factory_id: "Завод",
                  name: "Название",
                  description: "Описание",
                  parent_id: "Родительский отдел",
                  level: "Уровень",
                  department_id: "Отдел",
                  position_id: "Должность",
                  reports_to_membership_id: "Руководитель",
                  is_primary: "Основное назначение",
                  is_department_head: "Руководитель отдела",
                  user_id: "Пользователь",
                };
                const target =
                  key === "target_membership_id"
                    ? data.memberships.find((m) => m.id === val)
                    : undefined;
                const label = target
                  ? `${data.departments.find((d) => d.id === target.department_id)?.name} · ${data.positions.find((p) => p.id === target.position_id)?.name || "Без должности"}`
                  : key === "department_id" || key === "parent_id"
                    ? data.departments.find((d) => d.id === val)?.name
                    : key === "position_id"
                      ? data.positions.find((p) => p.id === val)?.name
                      : key === "factory_id"
                        ? data.factories.find((f) => f.id === val)?.name
                        : key === "reports_to_membership_id"
                          ? data.users.find(
                              (u) =>
                                u.id ===
                                data.memberships.find((m) => m.id === val)
                                  ?.user_id,
                            )?.full_name
                          : key === "user_id"
                            ? data.users.find((u) => u.id === val)?.full_name
                            : null;
                return (
                  <div
                    key={key}
                    className="flex justify-between gap-4 border-b pb-2"
                  >
                    <dt className="text-muted-foreground">
                      {labels[key] || key}
                    </dt>
                    <dd>
                      {label ||
                        (typeof val === "boolean"
                          ? val
                            ? "Да"
                            : "Нет"
                          : val === null
                            ? "Не задано"
                            : String(val))}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setReview(null)}
              >
                Вернуться
              </Button>
              <Button disabled={busy} onClick={apply}>
                {busy
                  ? "Сохраняем…"
                  : review.kind === "consolidate_assignment"
                    ? "Объединить назначения"
                    : "Сохранить изменения"}
              </Button>
            </div>
          </div>
        )}
        <form onSubmit={save} className="space-y-4" hidden={!!review}>
          {(isUser || isProfile) && (
            <Field label="Имя">
              <Input
                name="full_name"
                required
                minLength={2}
                defaultValue={value("full_name")}
              />
            </Field>
          )}
          {isUser && (
            <>
              <Field label="Email">
                <Input name="email" type="email" autoComplete="off" required />
              </Field>
              <Field label="Первоначальный пароль">
                <Input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
                <span className="text-xs text-muted-foreground">
                  Не менее 12 символов.
                </span>
              </Field>
            </>
          )}
          {(isUser || isProfile || editor.kind === "department") && (
            <Field label={isProfile ? "Основной завод" : "Завод"}>
              <select
                className={selectClass}
                name="factory_id"
                defaultValue={value("factory_id")}
              >
                <option value="">Не указан</option>
                {data.factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>
                    {factory.name}
                  </option>
                ))}
              </select>
              {isProfile && (
                <span className="text-xs text-muted-foreground">
                  Доступ к другим заводам настраивается отдельно в матрице доступа. «Не указан» не означает «Все заводы».
                </span>
              )}
            </Field>
          )}
          {isProfile && (
            <Field label="Email для входа">
              <Input
                type="email"
                name="email"
                required
                value={profileEmail}
                onChange={(event) => setProfileEmail(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                Изменение синхронизируется с сервисом входа. При задержке в
                карточке появится статус синхронизации.
              </span>
            </Field>
          )}
          {isProfile && (
            <Field label="Telegram Chat ID">
              <Input
                name="telegram_chat_id"
                defaultValue={value("telegram_chat_id")}
              />
            </Field>
          )}
          {isProfile && (
            <section className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div>
                <h3 className="font-semibold text-foreground">Сброс пароля</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Пользователь получит одноразовую ссылку и самостоятельно задаст новый пароль.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy ||
                  !profileUser?.is_active ||
                  Boolean(profileUser?.archived_at) ||
                  Boolean(profileUser?.auth_sync_pending) ||
                  profileEmail.trim().toLowerCase() !==
                    savedProfileEmail.trim().toLowerCase()
                }
                onClick={sendPasswordReset}
              >
                Отправить письмо для сброса пароля
              </Button>
              {profileEmail.trim().toLowerCase() !==
                savedProfileEmail.trim().toLowerCase() && (
                <p className="text-xs text-amber-700">
                  Сначала сохраните новый email и дождитесь синхронизации входа.
                </p>
              )}
              {profileUser?.auth_sync_pending && (
                <p className="text-xs text-amber-700">
                  Отправка станет доступна после синхронизации email с сервисом входа.
                </p>
              )}
              {profileUser && !profileUser.is_active && (
                <p className="text-xs text-muted-foreground">
                  Для заблокированного или архивного аккаунта письмо не отправляется.
                </p>
              )}
            </section>
          )}
          {(isUser || isAssignment) && (
            <>
              <Field label="Отдел">
                <select
                  className={selectClass}
                  name="department_id"
                  required
                  value={departmentId}
                  onChange={(event) => setDepartmentId(event.target.value)}
                >
                  <option value="">Выберите отдел</option>
                  {data.departments
                    .filter((d) => d.is_active)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Должность">
                <select
                  className={selectClass}
                  name="position_id"
                  required={isUser}
                  defaultValue={value("position_id")}
                >
                  <option value="">
                    {isUser ? "Выберите должность" : "Без должности"}
                  </option>
                  {data.positions
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Непосредственный руководитель">
                <select
                  key={departmentId}
                  className={selectClass}
                  name="reports_to_membership_id"
                  defaultValue={
                    departmentId === value("department_id")
                      ? value("reports_to_membership_id") ||
                        (value("reports_to_user_id") ? "unresolved" : "")
                      : ""
                  }
                >
                  {value("reports_to_user_id") &&
                    !value("reports_to_membership_id") && (
                      <option value="unresolved" disabled>
                        Уточните:{" "}
                        {data.users.find(
                          (u) => u.id === value("reports_to_user_id"),
                        )?.full_name || "Прежний руководитель"}
                      </option>
                    )}
                  <option value="">Без непосредственного руководителя</option>
                  {data.memberships
                    .filter(
                      (m) =>
                        m.department_id === departmentId &&
                        m.user_id !== editor.userId &&
                        data.users.find((u) => u.id === m.user_id)?.is_active,
                    )
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {data.users.find((u) => u.id === m.user_id)?.full_name}{" "}
                        ·{" "}
                        {data.positions.find((p) => p.id === m.position_id)
                          ?.name || "Без должности"}
                      </option>
                    ))}
                </select>
              </Field>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="is_department_head"
                  defaultChecked={editor.values.is_department_head === true}
                />
                Руководитель отдела
              </label>
              {isAssignment && (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="is_primary"
                    defaultChecked={editor.values.is_primary === true}
                  />
                  Основное назначение
                </label>
              )}
            </>
          )}
          {(editor.kind === "department" || editor.kind === "position") && (
            <>
              <Field label="Название">
                <Input
                  name="name"
                  required
                  minLength={2}
                  defaultValue={value("name")}
                  readOnly={
                    editor.kind === "department" &&
                    !!editor.id &&
                    criticalDepartments.has(value("name"))
                  }
                />
                {editor.kind === "department" &&
                  criticalDepartments.has(value("name")) && (
                    <span className="text-xs text-muted-foreground">
                      Название используется в маршрутизации автоматических
                      задач.
                    </span>
                  )}
              </Field>
              <Field label="Описание">
                <Input name="description" defaultValue={value("description")} />
              </Field>
            </>
          )}
          {editor.kind === "department" && (
            <Field label="Родительский отдел">
              <select
                name="parent_id"
                className={selectClass}
                defaultValue={value("parent_id")}
              >
                <option value="">Корневой отдел</option>
                {data.departments
                  .filter((d) => d.id !== editor.id && d.is_active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {editor.kind === "position" && (
            <Field label="Уровень в структуре">
              <Input
                name="level"
                type="number"
                min={0}
                max={10}
                defaultValue={value("level") || "0"}
              />
              <span className="text-xs text-muted-foreground">
                Уровень не выдаёт разрешения доступа.
              </span>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy
                ? "Сохраняем…"
                : isUser
                  ? "Создать пользователя"
                  : "Проверить изменения"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
