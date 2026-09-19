/** Read-only cutover report. Does not execute migrations or change any account. */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveDepartmentPermissions } from "../src/lib/permissions/resolve";
import { PERMISSION_RESOURCES } from "../src/lib/permissions/resources";

const url = process.env.ORGANIZATION_DATABASE_URL;
if (!url)
  throw new Error("Set ORGANIZATION_DATABASE_URL; its value is never printed");
const output = process.argv[2];
if (!output)
  throw new Error(
    "Pass a local output filename for the protected organization snapshot",
  );
function read(sql: string) {
  const run = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", url!], {
    input: `BEGIN READ ONLY;\n${sql}\nROLLBACK;`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0)
    throw new Error(
      "Read-only database snapshot failed; verify the connection and schema",
    );
  return JSON.parse(run.stdout.trim());
}
const source = read(`SELECT jsonb_build_object(
 'users',(SELECT coalesce(jsonb_agg(to_jsonb(u)),'[]') FROM public.users u),
 'departments',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM public.departments d),
 'positions',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.positions p),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM public.department_members m),
 'matrix',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.department_access_permissions p),
 'administrators',(SELECT coalesce(jsonb_agg(u.id),'[]') FROM public.users u WHERE public.crm_user_is_admin(u.id)),
 'functions',(SELECT jsonb_agg(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f' AND (p.proname LIKE 'crm_%' OR pg_get_functiondef(p.oid) LIKE '%Администратор CRM%'))
);`);
type User = { id: string; full_name: string; is_active: boolean };
type Department = {
  id: string;
  name: string;
  is_active: boolean;
  head_user_id: string | null;
  parent_id: string | null;
};
type Member = {
  id: string;
  user_id: string;
  department_id: string;
  position_id: string | null;
  is_department_head: boolean;
  reports_to_user_id: string | null;
};
const users = source.users as User[],
  departments = source.departments as Department[],
  members = source.memberships as Member[];
const issues: Array<{
  kind: string;
  userId?: string;
  departmentId?: string;
  membershipId?: string;
  detail: string;
}> = [];
for (const department of departments) {
  const heads = [
    ...new Set(
      members
        .filter(
          (m) => m.department_id === department.id && m.is_department_head,
        )
        .map((m) => m.user_id),
    ),
  ];
  if (heads.length > 1 || (heads[0] || null) !== department.head_user_id)
    issues.push({
      kind: "leadership",
      departmentId: department.id,
      detail: "Источники руководства расходятся",
    });
}
for (const department of departments) {
  const seen = new Set<string>();
  let current: Department | undefined = department;
  while (current) {
    if (seen.has(current.id)) { issues.push({kind:"cycle",departmentId:department.id,detail:"Цикл структуры отделов"}); break; }
    seen.add(current.id);
    current=departments.find((d)=>d.id===current?.parent_id);
  }
}
for (const member of members) {
  const seen=new Set<string>();
  let current: Member | undefined=member;
  while(current) {
    if(seen.has(current.id)){issues.push({kind:"cycle",membershipId:member.id,detail:"Цикл подчинения"});break;}
    seen.add(current.id);
    const candidates=members.filter((m)=>m.user_id===current?.reports_to_user_id&&m.department_id===current?.department_id);
    current=candidates.length===1?candidates[0]:undefined;
  }
}
for (const user of users) {
  const list = members.filter((m) => m.user_id === user.id);
  if (list.length > 1 && !list.some((m) => "is_primary" in m && m.is_primary))
    issues.push({
      kind: "primary",
      userId: user.id,
      detail: "Выберите основное назначение; права сохраняются по всем",
    });
  if (
    user.is_active &&
    !list.length &&
    !source.administrators.includes(user.id)
  )
    issues.push({
      kind: "unassigned",
      userId: user.id,
      detail: "Нет назначений",
    });
}
for (const member of members)
  if (
    member.reports_to_user_id &&
    members.filter(
      (m) =>
        m.user_id === member.reports_to_user_id &&
        m.department_id === member.department_id,
    ).length !== 1
  )
    issues.push({
      kind: "supervisor",
      membershipId: member.id,
      userId: member.user_id,
      detail: "Подчинение требует выбора конкретного назначения",
    });
const snapshots = users.map((user) => {
  if (!/^[a-f0-9-]{36}$/i.test(user.id))
    throw new Error("Unexpected user identifier");
  const resourceList = PERMISSION_RESOURCES.map(
    (resource) => `('${resource.key}')`,
  ).join(",");
  const before =
    read(`SET LOCAL request.jwt.claim.sub='${user.id}'; SET LOCAL request.jwt.claim.role='authenticated';
 SELECT jsonb_object_agg(resource,jsonb_build_object('canView',private.crm_has_permission(resource,'view'),'canManage',private.crm_has_permission(resource,'manage'))) FROM (VALUES ${resourceList}) resources(resource);`);
  const membershipList = members
    .filter(
      (m) =>
        m.user_id === user.id &&
        departments.find((d) => d.id === m.department_id)?.is_active,
    )
    .map((m) => ({
      departmentId: m.department_id,
      departmentName:
        departments.find((d) => d.id === m.department_id)?.name || null,
      isDepartmentHead: m.is_department_head,
    }));
  const canonical = resolveDepartmentPermissions(membershipList, source.matrix);
  const oldCompanyMembers = membershipList.map((member) => ({
    ...member,
    isDepartmentHead:
      member.isDepartmentHead ||
      departments.find((d) => d.id === member.departmentId)?.head_user_id ===
        user.id,
  }));
  const oldCompany = resolveDepartmentPermissions(
    oldCompanyMembers,
    source.matrix,
  );
  const oldFactory = resolveDepartmentPermissions(
    members
      .filter((m) => m.user_id === user.id)
      .map((m) => ({
        departmentId: m.department_id,
        departmentName: null,
        isDepartmentHead: m.is_department_head,
      })),
    source.matrix,
  );
  const scopeDifferences =
    source.administrators.includes(user.id) || !user.is_active
      ? []
      : PERMISSION_RESOURCES.flatMap((resource) => {
          const oldScopes = {
            factory: oldFactory.factoryScopes[resource.key],
            company: oldCompany.companyScopes[resource.key],
          };
          const newScopes = {
            factory: canonical.factoryScopes[resource.key],
            company: canonical.companyScopes[resource.key],
          };
          return JSON.stringify(oldScopes) === JSON.stringify(newScopes)
            ? []
            : [{ resource: resource.key, before: oldScopes, after: newScopes }];
        });
  const differences = PERMISSION_RESOURCES.flatMap((resource) => {
    const expected = !user.is_active
      ? { canView: false, canManage: false }
      : source.administrators.includes(user.id)
        ? { canView: true, canManage: true }
        : canonical.permissions[resource.key];
    return before[resource.key].canView === expected?.canView &&
      before[resource.key].canManage === expected?.canManage
      ? []
      : [
          {
            resource: resource.key,
            before: before[resource.key],
            after: expected,
          },
        ];
  });
  return { userId: user.id, before, canonical, differences, scopeDifferences };
});
const report = {
  generatedAt: new Date().toISOString(),
  source,
  issues,
  snapshots,
  releaseBlocked:
    issues.some((issue) => issue.kind === "leadership" || issue.kind === "cycle") ||
    snapshots.some((s) => s.differences.length || s.scopeDifferences.length) ||
    (users.some((u) => u.is_active) && source.administrators.length === 0),
};
writeFileSync(output, JSON.stringify(report, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  `Read-only snapshot saved. Users: ${users.length}; decisions: ${issues.length}; permission changes: ${snapshots.filter((s) => s.differences.length).length}; release blocked: ${report.releaseBlocked}`,
);
if (report.releaseBlocked) process.exitCode = 2;
