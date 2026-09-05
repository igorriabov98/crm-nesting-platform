import { Metadata } from "next";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { MeetingFlowCard } from "@/components/features/meetings-v2/MeetingFlowCard";
import { getMeetingDetailV2 } from "../v2-actions";
import { requirePermission } from "@/lib/permissions/server";

export const metadata: Metadata = {
  title: "Карточка собрания | CRM Завода",
};

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const allowed = await requirePermission("meetings", "view")
    .then(() => true)
    .catch(() => false);
  if (!allowed) return <AccessDenied />;
  const [data, canManage] = await Promise.all([
    getMeetingDetailV2(id),
    requirePermission("meetings", "manage")
      .then(() => true)
      .catch(() => false),
  ]);
  return <MeetingFlowCard data={data} canManage={canManage} />;
}
