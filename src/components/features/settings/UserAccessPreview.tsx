"use client";

import { useEffect, useState } from "react";
import {
  getAccessPreviewForUser,
  type UserAccessPreview as Preview,
} from "@/lib/actions/role-permissions";
import { RESOURCE_BY_KEY } from "@/lib/permissions/resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function UserAccessPreview({
  userId,
  afterRestore = false,
  onVerified,
}: {
  userId: string;
  afterRestore?: boolean;
  onVerified?: (version: string | null) => void;
}) {
  const [result, setResult] = useState<{
    data: Preview | null;
    error: string | null;
    requestKey: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const requestKey = `${userId}:${afterRestore}:${attempt}`;
  useEffect(() => {
    let current = true;
    onVerified?.(null);
    getAccessPreviewForUser(userId, afterRestore)
      .then((value) => {
        if (current) {
          setResult({ ...value, requestKey });
          onVerified?.(value.data?.version ?? null);
        }
      })
      .catch(() => {
        if (current)
          setResult({
            data: null,
            error: "Не удалось проверить доступ",
            requestKey,
          });
      });
    return () => {
      current = false;
    };
  }, [userId, afterRestore, requestKey, onVerified]);
  if (!result || result.requestKey !== requestKey)
    return <p role="status">Проверяем фактические права…</p>;
  if (!result.data)
    return (
      <div role="alert">
        <p>{result.error}</p>
        <Button
          variant="outline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Повторить проверку
        </Button>
      </div>
    );
  const preview = result.data;
  return (
    <div className="space-y-3">
      {afterRestore && (
        <p className="rounded-lg bg-muted p-3 text-sm">
          Предварительный просмотр после восстановления. Сейчас аккаунт остаётся
          заблокированным.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <strong>{preview.fullName || preview.email}</strong>
        {!preview.isActive && (
          <Badge variant="destructive">Аккаунт заблокирован</Badge>
        )}
        {preview.isAdminPosition && (
          <Badge>Администратор CRM · полный доступ</Badge>
        )}
      </div>
      <Input
        aria-label="Поиск в фактических правах"
        placeholder="Найти раздел…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="max-h-[55vh] overflow-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="p-3">Раздел</th>
              <th className="p-3">Права и ограничения</th>
              <th className="p-3">Источник</th>
            </tr>
          </thead>
          <tbody>
            {preview.permissions
              .filter((row) =>
                row.label.toLowerCase().includes(search.toLowerCase()),
              )
              .map((row) => (
                <tr key={row.resourceKey} className="border-t">
                  <td className="p-3">{row.label}</td>
                  <td className="p-3">
                    {row.canManage
                      ? "Просмотр и управление"
                      : row.canView
                        ? "Просмотр"
                        : "Нет доступа"}
                    {row.canView &&
                      RESOURCE_BY_KEY[row.resourceKey].supportsFactoryScope && (
                        <p className="text-xs text-muted-foreground">
                          Просмотр: заводы{" "}
                          {row.factoryViewScope === "all" ? "все" : "свой"}
                        </p>
                      )}
                    {row.canView &&
                      RESOURCE_BY_KEY[row.resourceKey].supportsCompanyScope && (
                        <p className="text-xs text-muted-foreground">
                          Просмотр: компании{" "}
                          {row.companyViewScope === "all" ? "все" : "свои"}
                        </p>
                      )}
                    {row.canManage &&
                      RESOURCE_BY_KEY[row.resourceKey].supportsFactoryScope && (
                        <p className="text-xs text-muted-foreground">
                          Управление: заводы{" "}
                          {row.factoryManageScope === "all" ? "все" : "свой"}
                        </p>
                      )}
                    {row.canManage &&
                      RESOURCE_BY_KEY[row.resourceKey].supportsCompanyScope && (
                        <p className="text-xs text-muted-foreground">
                          Управление: компании{" "}
                          {row.companyManageScope === "all" ? "все" : "свои"}
                        </p>
                      )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {row.sources.join("; ") ||
                      (preview.isActive
                        ? "Разрешение не назначено"
                        : "Аккаунт заблокирован")}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
