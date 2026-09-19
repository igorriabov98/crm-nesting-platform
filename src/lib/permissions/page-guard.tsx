import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUserContextOrRedirect } from "@/lib/auth/current-user";
import { getCurrentUserPermissions, canCurrentUserAccessPath } from "./server";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { AccessUnavailable } from "@/components/ui/AccessUnavailable";

/** Runs before the page function (and therefore before its data loads). */
export function withPagePermission<P>(
  pathname: string,
  page: (props: P) => ReactNode | void | Promise<ReactNode | void>,
) {
  return async function ProtectedPage(props: P) {
    let allowed: boolean;
    try {
      const context = await getCurrentUserContextOrRedirect();
      const snapshot = await getCurrentUserPermissions(context.userId);
      allowed = await canCurrentUserAccessPath(snapshot.permissions, pathname);
    } catch (error) {
      unstable_rethrow(error);
      return <AccessUnavailable />;
    }
    if (!allowed) return <AccessDenied />;
    return (await page(props)) ?? null;
  };
}
