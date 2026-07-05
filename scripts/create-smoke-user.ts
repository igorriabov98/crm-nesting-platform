import { createClient } from '@supabase/supabase-js';

type Json = Record<string, unknown>;

const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const email = requiredEnv('SMOKE_USER_EMAIL');
const password = requiredEnv('SMOKE_USER_PASSWORD');
type SupabaseAdminClient = ReturnType<typeof createAdminClient>;

async function main() {
  const supabase = createAdminClient();

  const existingUser = await findUserByEmail(supabase, email);
  const user = existingUser
    ? await updateAuthUser(supabase, existingUser.id)
    : await createAuthUser(supabase);

  const { error: profileError } = await supabase
    .from('users')
    .upsert({
      id: user.id,
      email,
      full_name: 'CI Smoke User',
      role: 'technologist',
      factory_id: null,
      is_active: true,
    }, { onConflict: 'id' });

  if (profileError) throw new Error(`public.users upsert failed: ${profileError.message}`);

  console.log(JSON.stringify({
    email,
    userId: user.id,
    role: 'technologist',
    isActive: true,
  }, null, 2));
}

function createAdminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function findUserByEmail(supabase: SupabaseAdminClient, targetEmail: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  throw new Error('listUsers pagination limit reached before smoke user lookup completed');
}

async function createAuthUser(supabase: SupabaseAdminClient) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: 'production-smoke' },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message || 'user missing'}`);
  return data.user;
}

async function updateAuthUser(supabase: SupabaseAdminClient, userId: string) {
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    user_metadata: { purpose: 'production-smoke' },
  });
  if (error || !data.user) throw new Error(`updateUserById failed: ${error?.message || 'user missing'}`);
  return data.user;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
});
