/** Local, synthetic, read-only UI fixture. No production credentials or DB connection. */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { PERMISSION_RESOURCES } from "../src/lib/permissions/resources";
const admin = "c0000000-0000-4000-8000-000000000001",
  employee = "c0000000-0000-4000-8000-000000000002",
  department = "c0000000-0000-4000-8000-000000000010",
  position = "c0000000-0000-4000-8000-000000000020",
  factory = "c0000000-0000-4000-8000-000000000030";
const user = (id: string, name: string) => ({
  id,
  full_name: name,
  email: `${id}@example.test`,
  role: "engineer",
  factory_id: factory,
  is_active: true,
  created_at: "2026-09-19T00:00:00Z",
  telegram_chat_id: null,
  is_admin: id === admin,
  auth_sync_pending: false,
});
const users = [
  user(admin, "Тестовый администратор"),
  user(employee, "Тестовый сотрудник"),
];
const departments = [
  {
    id: department,
    name: "Финансовый отдел",
    is_active: true,
    parent_id: null as string | null,
    head_user_id: employee,
    factory_id: factory,
    sort_order: 0,
    description: "Синтетический отдел для проверки интерфейса",
  },
];
departments.push({...departments[0],id:"c0000000-0000-4000-8000-000000000011",name:"Планирование",parent_id:department,head_user_id:admin});
const positions = [
  {
    id: position,
    name: "Финансовый специалист",
    level: 2,
    is_active: true,
    description: null,
  },
];
const memberships = [
  {
    id: "c0000000-0000-4000-8000-000000000040",
    user_id: employee,
    department_id: department,
    position_id: position,
    is_department_head: true,
    is_primary: true,
    reports_to_membership_id: null,
    reports_to_user_id: null,
    joined_at: "2026-09-19T00:00:00Z",
  },
];
const matrix = PERMISSION_RESOURCES.flatMap((resource) =>
  ["head", "member"].map((subject_scope) => ({
    department_id: department,
    subject_scope,
    resource_key: resource.key,
    can_view: ["inventory", "tasks", "departments"].includes(resource.key),
    can_manage: resource.key === "tasks",
    factory_scope: "own",
    company_view_scope: "own",
    company_manage_scope: "own",
    revision: 1,
  })),
);
let accessFailure = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1:4319");
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4320");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  if (url.pathname === "/session") {
    const sessionUser = url.searchParams.get("user") === "employee" ? users[1] : users[0];
    const payload = {
      sub: sessionUser.id,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };
    const jwt = [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
      "synthetic",
    ].join(".");
    const session = {
      access_token: jwt,
      refresh_token: "synthetic-local-only",
      expires_at: payload.exp,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        ...sessionUser,
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
      },
    };
    res.setHeader(
      "Set-Cookie",
      `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}; Path=/; SameSite=Lax`,
    );
    res.writeHead(302, {
      Location: "http://127.0.0.1:4320/admin/organization",
    });
    res.end();
    return;
  }
  if (url.pathname === "/control") {
    if (url.searchParams.has("failure"))
      accessFailure = url.searchParams.get("failure") === "true";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<h1>Локальная проверка доступа</h1><p>Ошибка проверки: ${accessFailure ? "включена" : "выключена"}</p><a href="/control?failure=true">Включить ошибку</a> <a href="/control?failure=false">Восстановить проверку</a> <a href="http://127.0.0.1:4320/admin/organization">Открыть организацию</a>`,
    );
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  let value: unknown = [];
  let actor = users[0];
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const claims = JSON.parse(Buffer.from(token?.split(".")[1] || "", "base64url").toString());
    actor = users.find((u) => u.id === claims.sub) || actor;
  } catch { /* The synthetic service key does not encode a user. */ }

  if (url.pathname === "/auth/v1/user")
    value = {
      ...actor,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
    };
  else if (url.pathname === "/auth/v1/admin/users")
    value = { users, last_page: 1, total: users.length };
  else if (url.pathname.endsWith("/rpc/crm_user_is_admin"))
    value = args.p_user_id === admin;
  else if (url.pathname.endsWith("/rpc/crm_access_snapshot")) {
    if (accessFailure) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Synthetic permission read failure" }));
      return;
    }
    const selected = users.find((u) => u.id === args.p_user_id) || users[0];
    value = {
      userId: selected.id,
      fullName: selected.full_name,
      email: selected.email,
      isActive: true,
      isAdmin: selected.id === admin,
      hasAdminStatus: selected.id === admin,
      version: "1",
      memberships:
        selected.id === employee
          ? [
              {
                id: memberships[0].id,
                departmentId: department,
                departmentName: departments[0].name,
                positionId: position,
                positionName: positions[0].name,
                positionLevel: 2,
                isDepartmentHead: true,
                isPrimary: true,
              },
            ]
          : [],
      accessRows: matrix,
    };
  } else if (url.pathname.endsWith("/rpc/crm_organization_snapshot"))
    value = {
      version: "1",
      users,
      departments,
      positions,
      memberships,
      factories: [{ id: factory, name: "Тестовый завод" }],
    };
  else if (url.pathname.endsWith("/rpc/crm_preview_offboarding"))
    value = {
      userId: employee,
      version: "1",
      obligations: [
        {
          key: `head:${memberships[0].id}`,
          source: "head",
          id: memberships[0].id,
          label: "Руководитель отдела",
          title: departments[0].name,
          href: "/admin/organization?tab=departments",
          transferable: true,
          reason: null,
          fingerprint: "a".repeat(32),
          resourceKey: "departments",
        },
      ],
    };
  else if (url.pathname.includes("/rpc/crm_")) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        message: "Синтетический стенд доступен только для просмотра",
      }),
    );
    return;
  } else if (url.pathname.endsWith("/users"))
    value = users.filter(
      (u) =>
        !url.searchParams.has("id") ||
        url.searchParams.get("id") === `eq.${u.id}`,
    );
  else if (url.pathname.endsWith("/departments")) value = departments;
  else if (url.pathname.endsWith("/positions")) value = positions;
  else if (url.pathname.endsWith("/department_members"))
    value = memberships
      .filter(
        (m) =>
          !url.searchParams.has("user_id") ||
          url.searchParams.get("user_id") === `eq.${m.user_id}`,
      )
      .map((m) => ({
        ...m,
        department: departments[0],
        position: positions[0],
        user: users[1],
      }));
  else if (url.pathname.endsWith("/department_access_permissions"))
    value = matrix;
  else if (url.pathname.endsWith("/user_system_roles"))
    value = [{ user_id: admin, role: "crm_admin" }];
  else if (url.pathname.endsWith("/factories"))
    value = [{ id: factory, name: "Тестовый завод" }];
  if (req.headers.accept?.includes("vnd.pgrst.object"))
    value = Array.isArray(value) ? value[0] || null : value;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
});
server.listen(4319, "127.0.0.1", () =>
  console.log("Synthetic UI session: http://127.0.0.1:4319/session"),
);
const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4320",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4319",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-local-key",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-service-key",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
process.on("SIGINT", () => {
  next.kill("SIGINT");
  server.close();
  process.exit();
});
process.on("SIGTERM", () => {
  next.kill("SIGTERM");
  server.close();
  process.exit();
});
