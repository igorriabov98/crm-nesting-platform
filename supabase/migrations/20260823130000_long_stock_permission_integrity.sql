-- Close privileged inventory mutation RPCs and make physical long-stock
-- identity immutable once a warehouse row or material variant is in use.

revoke all on function public.fn_reserve_whole_bar_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.fn_reserve_whole_bar_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid
) to service_role;

revoke all on function public.fn_unreserve_inventory_reservation(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_unreserve_inventory_reservation(uuid, uuid, text)
  to service_role;

-- ALTER FUNCTION ... RENAME preserves ACLs. Close the retained implementation
-- as well, otherwise authenticated can bypass the public whole-bar wrapper.
revoke all on function public.fn_unreserve_inventory_reservation_before_whole_bar(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.fn_unreserve_inventory_reservation_before_whole_bar(
  uuid, uuid, text
) to service_role;

revoke all on function public.fn_promote_due_future_business_scrap(date)
  from public, anon, authenticated;
grant execute on function public.fn_promote_due_future_business_scrap(date)
  to service_role;

create or replace function public.fn_inventory_piece_length_immutable_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.piece_length_mm is distinct from old.piece_length_mm then
    raise exception
      'Длину складского хлыста нельзя изменить; спишите строку и оприходуйте материал заново';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_inventory_piece_length_immutable_v1()
  from public, anon, authenticated;

drop trigger if exists inventory_piece_length_immutable_trigger
  on public.inventory;
create trigger inventory_piece_length_immutable_trigger
before update of piece_length_mm on public.inventory
for each row
when (old.piece_length_mm is distinct from new.piece_length_mm)
execute function public.fn_inventory_piece_length_immutable_v1();

create or replace function public.fn_material_variant_knife_bevel_identity_guard_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.knife_bevel_count is not distinct from old.knife_bevel_count then
    return new;
  end if;

  if exists (
    select 1
    from public.inventory inventory
    where inventory.material_variant_id = old.id
  ) or exists (
    select 1
    from public.inventory_reservations reservation
    where reservation.material_variant_id = old.id
  ) or exists (
    select 1
    from public.long_stock_cutting_plans plan
    where plan.material_variant_id = old.id
  ) then
    raise exception
      'Скос варианта ножа нельзя изменить после появления остатков, броней или карт раскроя; создайте новый вариант';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_material_variant_knife_bevel_identity_guard_v1()
  from public, anon, authenticated;

drop trigger if exists material_variant_knife_bevel_identity_guard_trigger
  on public.material_variants;
create trigger material_variant_knife_bevel_identity_guard_trigger
before update of knife_bevel_count on public.material_variants
for each row
when (old.knife_bevel_count is distinct from new.knife_bevel_count)
execute function public.fn_material_variant_knife_bevel_identity_guard_v1();

notify pgrst, 'reload schema';
