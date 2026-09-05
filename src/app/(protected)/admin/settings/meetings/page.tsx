import { AccessDenied } from "@/components/ui/AccessDenied";
import { MeetingSettingsWorkspace } from "@/components/features/meetings-v2/MeetingSettingsWorkspace";
import { getMeetingSettingsV2 } from "@/app/(protected)/meetings/v2-actions";
import { requirePermission } from "@/lib/permissions/server";

export const metadata = { title: "Конструктор совещаний | CRM Завода" };

export default async function MeetingSettingsPage() {
  const canView = await requirePermission("meeting_templates", "view")
    .then(() => true)
    .catch(() => false);
  if (!canView) return <AccessDenied />;
  const [data, canManageTemplates, canManageQuestions, canManageRules] =
    await Promise.all([
      getMeetingSettingsV2(),
      requirePermission("meeting_templates", "manage")
        .then(() => true)
        .catch(() => false),
      requirePermission("meeting_question_templates", "manage")
        .then(() => true)
        .catch(() => false),
      requirePermission("meeting_rules", "manage")
        .then(() => true)
        .catch(() => false),
    ]);
  return (
    <MeetingSettingsWorkspace
      data={data}
      canManageTemplates={canManageTemplates}
      canManageQuestions={canManageQuestions}
      canManageRules={canManageRules}
    />
  );
}
