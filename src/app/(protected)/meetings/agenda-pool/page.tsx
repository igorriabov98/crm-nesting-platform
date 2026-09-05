import { AccessDenied } from "@/components/ui/AccessDenied";
import { AgendaPoolWorkspace } from "@/components/features/meetings-v2/AgendaPoolWorkspace";
import { getAgendaPoolV2 } from "@/app/(protected)/meetings/v2-actions";
import { requirePermission } from "@/lib/permissions/server";

export const metadata = {
  title: "Пул повесток | CRM Завода",
};

export default async function AgendaPoolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const allowed = await requirePermission("meetings_agenda_pool", "view")
    .then(() => true)
    .catch(() => false);
  if (!allowed) return <AccessDenied />;

  const params = await searchParams;
  const [data, canManage] = await Promise.all([
    getAgendaPoolV2({
      status: params.status as
        | "new"
        | "assigned"
        | "in_meeting"
        | "on_control"
        | "deferred"
        | "resolved"
        | "auto_closed"
        | "dismissed"
        | "closed"
        | undefined,
      priority: params.priority,
      factoryId: params.factoryId,
      responsibleUserId: params.responsibleUserId,
      ruleId: params.ruleId,
      query: params.query,
      page: Number(params.page || 1),
      pageSize: 50,
    }),
    requirePermission("meetings_agenda_pool", "manage")
      .then(() => true)
      .catch(() => false),
  ]);
  return (
    <AgendaPoolWorkspace
      data={data}
      currentStatus={params.status || ""}
      currentFilters={{
        priority: params.priority,
        factoryId: params.factoryId,
        responsibleUserId: params.responsibleUserId,
        ruleId: params.ruleId,
        query: params.query,
      }}
      canManage={canManage}
    />
  );
}
