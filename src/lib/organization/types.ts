import type {
  Department,
  DepartmentMember,
  Position,
} from "@/lib/types/departments";
import type { PermissionMap } from "@/lib/permissions/resources";
export type OrganizationUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  factory_id: string | null;
  telegram_chat_id: string | null;
  is_active: boolean;
  archived_at?: string | null;
  is_admin: boolean;
  auth_sync_pending: boolean;
};
export type OrganizationMembership = DepartmentMember & {
  is_primary: boolean;
  reports_to_membership_id: string | null;
};
export type OrganizationData = {
  version: string;
  currentUserId: string;
  isAdmin: boolean;
  permissions: PermissionMap;
  users: OrganizationUser[];
  departments: Department[];
  positions: Position[];
  memberships: OrganizationMembership[];
  factories: Array<{ id: string; name: string }>;
};
export type OrganizationChange = {
  kind:
    | "profile"
    | "department"
    | "position"
    | "assignment"
    | "remove_assignment"
    | "consolidate_assignment"
    | "head";
  id: string | null;
  data: Record<string, string | number | boolean | null>;
  expectedVersion: string;
};
export type Obligation = {
  key: string;
  source: string;
  id: string;
  label: string;
  title: string;
  href: string;
  transferable: boolean;
  reason: string | null;
  fingerprint: string;
  resourceKey: string;
};
export type OffboardingPreview = {
  userId: string;
  version: string;
  obligations: Obligation[];
};
export type OrganizationAudit = {
  id: number;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};
