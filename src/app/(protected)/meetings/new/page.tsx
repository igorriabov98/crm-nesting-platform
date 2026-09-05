import { Metadata } from "next";
import { NewMeetingPlanner } from "@/components/features/meetings-v2/NewMeetingPlanner";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { requirePermission } from "@/lib/permissions/server";
import { getMeetingDashboardV2 } from "../v2-actions";

export const metadata: Metadata = {
  title: "Новое собрание | CRM Завода",
};

export default async function NewMeetingPage() {
  const context = await requirePermission("meetings", "manage").catch(
    () => null,
  );
  if (!context) return <AccessDenied />;

  const data = await getMeetingDashboardV2({ page: 1, pageSize: 10 });
  return <NewMeetingPlanner templates={data.templates} />;
}
