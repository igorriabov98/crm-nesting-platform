import { Metadata } from "next";
import { MeetingsOperationsDashboard } from "@/components/features/meetings-v2/MeetingsOperationsDashboard";
import { getMeetingDashboardV2 } from "./v2-actions";
import { requirePermission } from "@/lib/permissions/server";

export const metadata: Metadata = {
  title: "Собрания | CRM Завода",
  description: "Операционный штаб совещаний, вопросов и решений",
};

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const [data, canManage, canOpenSettings] = await Promise.all([
    getMeetingDashboardV2({ page: Number(params.page || 1), pageSize: 25 }),
    requirePermission("meetings", "manage")
      .then(() => true)
      .catch(() => false),
    requirePermission("meeting_templates", "view")
      .then(() => true)
      .catch(() => false),
  ]);
  return (
    <MeetingsOperationsDashboard
      data={data}
      canManage={canManage}
      canOpenSettings={canOpenSettings}
    />
  );
}
