"use client";

import Link from "next/link";
import { Building2, CornerDownRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Department } from "@/lib/types/departments";
import type {
  OrganizationData,
  OrganizationMembership,
} from "@/lib/organization/types";
import { organizationTreeRows } from "@/lib/organization/tree";

export function DepartmentTree({
  data,
  search,
  canMatrix,
  canManage,
  edit,
  create,
  archive,
  editMember,
  removeMember,
}: {
  data: OrganizationData;
  search: string;
  canMatrix: boolean;
  canManage: boolean;
  edit: (department: Department) => void;
  create: (parentId: string) => void;
  archive: (department: Department) => void;
  editMember: (member: OrganizationMembership) => void;
  removeMember: (member: OrganizationMembership) => void;
}) {
  const rows = organizationTreeRows(data.departments, search);
  const name = (id: string | null) =>
    data.users.find((user) => user.id === id)?.full_name || "Не назначен";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Дерево отделов: вложенные ветви подчиняются отделу над ними. Разверните
        сотрудников для управления назначениями.
      </p>
      <ol aria-label="Дерево отделов" className="space-y-3">
        {rows.map(({ department, depth, path }) => {
          const members = data.memberships.filter(
            (m) =>
              m.department_id === department.id &&
              data.users.some((u) => u.id === m.user_id && u.is_active),
          );
          return (
            <li
              key={department.id}
              style={{ marginInlineStart: `${Math.min(depth, 6) * 20}px` }}
              className={depth ? "border-l-2 border-primary/25 pl-3" : ""}
            >
              <section
                id={`department-${department.id}`}
                className="rounded-xl border bg-card p-4"
                aria-label={department.name}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {path.length ? path.join(" → ") : "Верхний уровень"}
                    </p>
                    <h2 className="flex items-center gap-2 font-semibold">
                      {depth ? (
                        <CornerDownRight className="size-4 shrink-0 text-primary" />
                      ) : (
                        <Building2 className="size-4 shrink-0 text-primary" />
                      )}
                      {department.name}
                      {!department.is_active && (
                        <Badge variant="outline">Архив</Badge>
                      )}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {data.factories.find(
                        (f) => f.id === department.factory_id,
                      )?.name || "Завод не указан"}
                    </p>
                    <p className="mt-2 text-sm">
                      Руководитель:{" "}
                      <strong>{name(department.head_user_id)}</strong>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Сотрудников: {new Set(members.map((m) => m.user_id)).size}{" "}
                      · Назначений: {members.length}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canMatrix && (
                      <Button
                        variant="outline"
                        nativeButton={false}
                        render={
                          <Link
                            href={`/admin/settings/access?department=${department.id}`}
                          />
                        }
                      >
                        Матрица отдела
                      </Button>
                    )}
                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => edit(department)}
                        >
                          Изменить
                        </Button>
                        {department.is_active && (
                          <Button
                            variant="outline"
                            onClick={() => create(department.id)}
                          >
                            <Plus className="size-4" />
                            Подотдел
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => archive(department)}
                        >
                          {department.is_active ? "В архив" : "Восстановить"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <details className="mt-3 border-t pt-3">
                  <summary className="min-h-9 cursor-pointer text-sm font-medium">
                    Сотрудники и назначения ({members.length})
                  </summary>
                  <div className="space-y-2">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm"
                      >
                        <div>
                          <strong>{name(member.user_id)}</strong>
                          <p className="text-muted-foreground">
                            {data.positions.find(
                              (p) => p.id === member.position_id,
                            )?.name || "Без должности"}
                          </p>
                          {member.is_department_head && (
                            <Badge variant="outline">Руководитель</Badge>
                          )}
                          {member.is_primary && (
                            <Badge variant="secondary">Основное</Badge>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => editMember(member)}
                            >
                              Изменить назначение
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => removeMember(member)}
                            >
                              <Trash2 className="size-4" />
                              Удалить из отдела
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {!members.length && (
                      <p className="text-sm text-muted-foreground">
                        Активных сотрудников нет.
                      </p>
                    )}
                  </div>
                </details>
              </section>
            </li>
          );
        })}
      </ol>
      {!rows.length && (
        <p className="text-sm text-muted-foreground">Отделы не найдены.</p>
      )}
    </div>
  );
}
