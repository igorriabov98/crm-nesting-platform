do $$
declare
  v_setting uuid;
  v_new_version uuid := '40000000-0000-0000-0000-000000000003';
begin
  if 'wp_plate'::text <> 'wp_plate' then
    raise exception 'legacy enum value unexpectedly disappeared';
  end if;
  if exists (
    select 1 from public.product_versions
    where fastening_types @> array['wp_plate'::public.product_fastening_type]
  ) then
    raise exception 'WP was not removed from legacy arrays';
  end if;
  if (select count(*) from public.product_version_client_fastening_settings
      where product_version_id = '40000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'current shared fastening was not copied to every client';
  end if;
  if exists (
    select 1 from public.product_version_client_fastening_settings
    where fastening_types <> array['metal_plate', 'a4_plate']::public.product_fastening_type[]
  ) then
    raise exception 'migrated fastening values are incorrect';
  end if;
  if exists (select 1 from public.product_version_client_fastening_files) then
    raise exception 'migration created client files';
  end if;
  if (select count(distinct client_id) from public.tasks
      where task_type = 'product_version_incomplete' and status = 'pending') <> 2 then
    raise exception 'incomplete tasks were not reconciled independently per client';
  end if;
  if has_table_privilege('authenticated', 'public.product_version_client_fastening_settings', 'SELECT') then
    raise exception 'authenticated has direct read access to client settings';
  end if;
  if has_table_privilege('authenticated', 'public.product_version_client_fastening_files', 'INSERT') then
    raise exception 'authenticated has direct write access to client files';
  end if;
  if not has_table_privilege('service_role', 'public.product_version_client_fastening_files', 'SELECT') then
    raise exception 'service role cannot read client files';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.fn_copy_product_version_client_fastening_settings(uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute protected copy function';
  end if;

  begin
    insert into public.product_version_client_fastening_settings(
      product_version_id, client_id, fastening_types
    ) values (
      '40000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      array['wp_plate']::public.product_fastening_type[]
    );
    raise exception 'WP setting was accepted';
  exception when check_violation then null;
  end;

  select id into v_setting
  from public.product_version_client_fastening_settings
  where product_version_id = '40000000-0000-0000-0000-000000000001'
    and client_id = '20000000-0000-0000-0000-000000000001';
  insert into public.product_version_client_fastening_files(
    setting_id, fastening_type, file_name, file_path, mime_type, file_size
  ) values (
    v_setting, 'metal_plate', 'plate.strange42',
    'products/p/versions/v/clients/c/metal_plate/uploads/plate.strange42',
    'application/octet-stream', 52428800
  );
  if not exists (
    select 1 from public.file_archive_assets
    where source_kind = 'product_version_client_fastening_file'
      and policy_key = 'product_client_metal_plate'
  ) then
    raise exception 'client file was not registered in archive subsystem';
  end if;
  begin
    insert into public.product_version_client_fastening_files(
      setting_id, fastening_type, file_name, file_path, file_size
    ) values (v_setting, 'metal_plate', 'duplicate.xyz', 'duplicate.xyz', 1);
    raise exception 'second file for one type was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.product_version_client_fastening_files(
      setting_id, fastening_type, file_name, file_path, file_size
    ) values (v_setting, 'a4_plate', 'too-large.xyz', 'too-large.xyz', 52428801);
    raise exception 'file larger than 50 MB was accepted';
  exception when check_violation then null;
  end;

  insert into public.product_versions(
    id, product_id, version_number, status, drawing_number,
    fastening_types, completion_type, created_by
  ) values (
    v_new_version, '30000000-0000-0000-0000-000000000001', 2, 'archived', 'TEST-02',
    '{}', 'mounting_set', '10000000-0000-0000-0000-000000000001'
  );
  perform public.fn_copy_product_version_client_fastening_settings(
    '40000000-0000-0000-0000-000000000001', v_new_version,
    '10000000-0000-0000-0000-000000000001'
  );
  if (select count(*) from public.product_version_client_fastening_settings
      where product_version_id = v_new_version) <> 2 then
    raise exception 'new version did not copy client checkboxes';
  end if;
  if exists (
    select 1
    from public.product_version_client_fastening_files file
    join public.product_version_client_fastening_settings setting on setting.id = file.setting_id
    where setting.product_version_id = v_new_version
  ) then
    raise exception 'new version copied client files';
  end if;

  perform public.fn_copy_product_version_client_fastening_settings(
    '40000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001'
  );
  if (select count(*) from public.product_version_client_fastening_settings
      where product_version_id = '40000000-0000-0000-0000-000000000002') <> 2 then
    raise exception 'legacy rollback did not materialize settings for every client';
  end if;
  if exists (
    select 1 from public.product_version_client_fastening_settings
    where product_version_id = '40000000-0000-0000-0000-000000000002'
      and fastening_types <> array['white_sticker']::public.product_fastening_type[]
  ) then
    raise exception 'legacy rollback materialized incorrect values';
  end if;
end;
$$;

select 'product version client fastening database scenarios passed' as result;
