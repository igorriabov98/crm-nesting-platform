"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AccessVisibilityContext } from "./access-visibility";
import { usePathname } from "next/navigation";
import {
  getPermissionRequirementForPath,
  hasPermission,
  type PermissionMap,
  type PermissionOperation,
  type ResourceKey,
} from "@/lib/permissions/resources";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Button } from "@/components/ui/button";

type Snapshot = {
  permissions: PermissionMap;
  isAdminPosition: boolean;
  userId?: string;
  version?: string;
};
type AccessState = Snapshot & {
  status: "ready" | "loading" | "denied" | "error";
  refresh: () => void;
};
const PermissionContext = createContext<AccessState>({
  permissions: {},
  isAdminPosition: false,
  status: "loading",
  refresh: () => {},
});
export const ACCESS_REFRESH_EVENT = "crm:access-refresh";

export function PermissionProvider({
  permissions,
  isAdminPosition = false,
  userId,
  version,
  children,
}: Snapshot & { children: ReactNode }) {
  const pathname = usePathname();
  const [requestNumber, setRequestNumber] = useState(0);
  const [state, setState] = useState<
    Snapshot & {
      status: AccessState["status"];
    }
  >({
    permissions,
    isAdminPosition,
    userId,
    version,
    status: "ready",
  });
  const sequence = useRef(0);
  const refresh = () => setRequestNumber((n) => n + 1);
  useEffect(() => {
    const request = ++sequence.current;
    const controller = new AbortController();
    fetch("/api/access/snapshot", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (request !== sequence.current) return;
        if (response.status === 401 || response.status === 403) {
          setState({
            permissions: {},
            isAdminPosition: false,
            userId,
            status: "denied",
          });
          return;
        }
        if (!response.ok) throw new Error("Access check failed");
        const snapshot = (await response.json()) as Snapshot;
        if (request !== sequence.current) return;
        if (snapshot.userId !== userId) {
          // A different session must never inherit the previous RSC payload.
          setState({
            permissions: {},
            isAdminPosition: false,
            userId,
            status: "denied",
          });
          window.location.reload();
          return;
        }
        setState({
          ...snapshot,
          status: "ready",
        });
      })
      .catch(() => {
        if (!controller.signal.aborted && request === sequence.current) {
          setState((previous) => ({
            ...previous,
            status: "error",
          }));
        }
      });
    return () => {
      sequence.current += 1;
      controller.abort();
    };
  }, [pathname, requestNumber, userId]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener(ACCESS_REFRESH_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(ACCESS_REFRESH_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  // The server supplied a verified snapshot, and every page/action checks access
  // independently. Navigation and focus refresh it in the background without
  // hiding an already authorized page or its open editors.
  const sameUser = state.userId === userId;
  const status = sameUser ? state.status : "loading";
  return (
    <PermissionContext.Provider value={{
      ...state,
      permissions: sameUser ? state.permissions : {},
      isAdminPosition: sameUser && state.isAdminPosition,
      userId,
      status,
      refresh,
    }}>
      {children}
    </PermissionContext.Provider>
  );
}

export function RouteAccessBoundary({ children }: { children: ReactNode }) {
  const { permissions, status, refresh } = useContext(PermissionContext);
  const pathname = usePathname();
  const requirement = getPermissionRequirementForPath(pathname);
  const organizationAllowed =
    pathname === "/admin/organization" &&
    (hasPermission(permissions, "admin_users", "view") ||
      hasPermission(permissions, "departments", "view"));
  const denied =
    status === "denied" ||
    (pathname === "/admin/organization" && !organizationAllowed) ||
    (requirement &&
      !hasPermission(
        permissions,
        requirement.resourceKey,
        requirement.operation,
      ));
  const visible = status === "ready" && !denied;
  // Preserve drafts on a verification error; confirmed denial removes the page.
  // Server page/action guards remain the authorization boundary during refresh.
  return (
    <>
      {status === "loading" && <div role="status" aria-live="polite" className="p-8 text-muted-foreground">Проверяем доступ…</div>}
      {status === "error" && <div role="alert" className="space-y-4 rounded-xl border bg-white p-8">
        <h2 className="text-xl font-semibold">Не удалось проверить доступ</h2>
        <p>Проверка временно недоступна. Повторите попытку.</p>
        <Button onClick={refresh}>Повторить проверку</Button>
      </div>}
      {(status === "denied" || (status === "ready" && denied)) && <AccessDenied />}
      <AccessVisibilityContext.Provider value={visible}>
        <div hidden={!visible} inert={!visible}>{status === "denied" || (status === "ready" && denied) ? null : children}</div>
      </AccessVisibilityContext.Provider>
    </>
  );
}

export function usePermissions() {
  const { permissions, isAdminPosition, status, refresh } =
    useContext(PermissionContext);
  return {
    permissions,
    isAdminPosition,
    status,
    refresh,
    can: (resourceKey: ResourceKey, operation: PermissionOperation) =>
      status === "ready" && hasPermission(permissions, resourceKey, operation),
  };
}
