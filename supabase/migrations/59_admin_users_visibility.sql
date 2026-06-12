-- Planning director manages users and must see the full user list.

DROP POLICY IF EXISTS "Users - Select factory" ON users;
DROP POLICY IF EXISTS "users_select" ON users;

CREATE POLICY "users_select" ON users
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'planning_director'
    OR id = auth.uid()
    OR (
      factory_id IS NOT NULL
      AND factory_id = get_user_factory_id()
    )
  );
