import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("Auth worker synchronizes queued email and ban together; failures remain retryable", async () => {
  const updates: Array<unknown> = [],
    finishes: Array<Record<string, unknown>> = [];
  let failure = false;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "crm_claim_auth_sync")
        return {
          data: [
            {
              user_id: "u",
              desired_active: false,
              desired_email: "new@example.test",
              generation: "g",
            },
          ],
          error: null,
        };
      finishes.push(args);
      return { error: null };
    },
    auth: {
      admin: {
        updateUserById: async (id: string, attributes: unknown) => {
          updates.push({ id, attributes });
          return { error: failure ? { message: "sensitive" } : null };
        },
      },
    },
    from: () => ({
      select: () => ({
        is: () => ({
          eq: async () => ({ count: failure ? 1 : 0, error: null }),
        }),
      }),
    }),
  };
  const loaded = {
    exports: {} as {
      synchronizeUserAuth: (id: string) => Promise<{ pending: number }>;
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("src/lib/organization/auth-sync.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      module: loaded,
      exports: loaded.exports,
      require(name: string) {
        if (name === "server-only") return {};
        if (name === "node:crypto") return { randomUUID: () => "lease" };
        return { createAdminClient: () => client };
      },
    },
  );
  assert.equal((await loaded.exports.synchronizeUserAuth("u")).pending, 0);
  assert.equal(
    JSON.stringify(updates[0]),
    JSON.stringify({
      id: "u",
      attributes: {
        ban_duration: "876600h",
        email: "new@example.test",
        email_confirm: true,
      },
    }),
  );
  assert.equal(finishes[0].p_generation, "g");
  assert.equal(finishes[0].p_error, null);
  failure = true;
  assert.equal((await loaded.exports.synchronizeUserAuth("u")).pending, 1);
  assert.equal(finishes[1].p_error, "Сервис авторизации временно недоступен");
});
