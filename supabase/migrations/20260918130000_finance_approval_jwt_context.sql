-- Keep both Supabase JWT settings aligned while the finance head invokes the
-- owner-bound finalizer. Hosted Postgres versions may resolve auth.uid() from
-- request.jwt.claims even when request.jwt.claim.sub is present.
do $$
declare
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef(
    'public.fn_approve_technologist_request(uuid,uuid)'::regprocedure
  );

  v_updated := replace(
    v_definition,
    E'  v_original_sub text;\n',
    E'  v_original_sub text;\n  v_original_claims text;\n'
  );
  if v_updated = v_definition then
    raise exception 'Approval JWT declaration contract changed';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    E'  v_original_sub := current_setting(''request.jwt.claim.sub'', true);\n  perform set_config(''request.jwt.claim.sub'', v_request.created_by::text, true);',
    E'  v_original_sub := current_setting(''request.jwt.claim.sub'', true);\n  v_original_claims := current_setting(''request.jwt.claims'', true);\n  perform set_config(''request.jwt.claim.sub'', v_request.created_by::text, true);\n  perform set_config(\n    ''request.jwt.claims'',\n    jsonb_set(\n      coalesce(nullif(v_original_claims, '''')::jsonb, ''{}''::jsonb),\n      ''{sub}'',\n      to_jsonb(v_request.created_by::text),\n      true\n    )::text,\n    true\n  );'
  );
  if v_updated = v_definition then
    raise exception 'Approval JWT switch contract changed';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    E'  perform set_config(''request.jwt.claim.sub'', coalesce(v_original_sub, p_actor::text), true);',
    E'  perform set_config(''request.jwt.claim.sub'', coalesce(v_original_sub, p_actor::text), true);\n  perform set_config(\n    ''request.jwt.claims'',\n    coalesce(nullif(v_original_claims, ''''), jsonb_build_object(''sub'', p_actor::text)::text),\n    true\n  );'
  );
  if v_updated = v_definition then
    raise exception 'Approval JWT restore contract changed';
  end if;

  execute v_updated;
end $$;

revoke all on function public.fn_approve_technologist_request(uuid,uuid)
  from public, anon;
grant execute on function public.fn_approve_technologist_request(uuid,uuid)
  to authenticated, service_role;
