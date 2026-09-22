\set ON_ERROR_STOP on
BEGIN;
-- Exact identifiers intentionally mirror the guarded production repair. This
-- fixture is only invoked by the localhost-only regression runner.
INSERT INTO public.factories(id,name) VALUES('14fc4014-3149-4127-b886-d56e30337763','Surplus repair factory') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.users(id,email,full_name,role,factory_id,is_active)
VALUES('49a966fb-683f-4710-a41b-6e9cf57e5615','surplus-repair@example.test','Repair operator','engineer','14fc4014-3149-4127-b886-d56e30337763',true);
INSERT INTO public.user_system_roles(user_id,role) VALUES('49a966fb-683f-4710-a41b-6e9cf57e5615','crm_admin');
SELECT set_config('request.jwt.claim.sub','49a966fb-683f-4710-a41b-6e9cf57e5615',true);
INSERT INTO public.machines(id,factory_id,name,created_by)
VALUES('93766eaa-4656-4779-964c-de604f32c954','14fc4014-3149-4127-b886-d56e30337763','CIV-19-2026','49a966fb-683f-4710-a41b-6e9cf57e5615');
INSERT INTO public.technologist_requests(id,machine_id,created_by,status)
VALUES('c7cc1c62-d902-4614-8675-fb21e74e95d4','93766eaa-4656-4779-964c-de604f32c954','49a966fb-683f-4710-a41b-6e9cf57e5615','submitted_to_supply');
INSERT INTO public.materials(id,name,category,created_by)
VALUES('8ce821e2-8ce0-49b9-bb58-42f358c16513','Repair sheet','sheet_metal','49a966fb-683f-4710-a41b-6e9cf57e5615');
INSERT INTO public.material_variants(id,material_id,category,steel_type_id,sheet_size,thickness_mm,default_unit)
SELECT '311a191d-474b-4e1e-81fc-72ef4367c510','8ce821e2-8ce0-49b9-bb58-42f358c16513','sheet_metal',id,'1200x1200',32,'шт'
FROM public.steel_types ORDER BY name LIMIT 1;
INSERT INTO public.request_sheet_metal(id,request_id,material_name,material_id,material_variant_id,steel_type_id,sheet_size,thickness_mm,remainder_qty,order_status)
SELECT '4aa81ed9-3e2d-4df4-b43b-d158a84370e5','c7cc1c62-d902-4614-8675-fb21e74e95d4','Repair sheet',material_id,id,steel_type_id,sheet_size,thickness_mm,12,'delivered'
FROM public.material_variants WHERE id='311a191d-474b-4e1e-81fc-72ef4367c510';
INSERT INTO public.inventory(id,material_id,material_variant_id,factory_id,total_quantity,reserved_quantity,unit)
VALUES('c40b2464-1b4d-4fb8-88b8-db3d7bddb75d','8ce821e2-8ce0-49b9-bb58-42f358c16513','311a191d-474b-4e1e-81fc-72ef4367c510','14fc4014-3149-4127-b886-d56e30337763',0,0,'шт');
INSERT INTO public.production_fact_sections(id,factory_id,name,production_stage_type,created_by,updated_by)
VALUES('3f90b7b8-d27b-4214-84d2-15e1aa8a2bff','14fc4014-3149-4127-b886-d56e30337763','Repair cutting','cutting','49a966fb-683f-4710-a41b-6e9cf57e5615','49a966fb-683f-4710-a41b-6e9cf57e5615');
INSERT INTO public.production_machine_facts(id,factory_id,fact_date,machine_id,section_id,shift,created_by,updated_by)
VALUES('4d7316bb-18f7-42f1-bc1b-c936e59050ee','14fc4014-3149-4127-b886-d56e30337763',current_date,'93766eaa-4656-4779-964c-de604f32c954','3f90b7b8-d27b-4214-84d2-15e1aa8a2bff','day','49a966fb-683f-4710-a41b-6e9cf57e5615','49a966fb-683f-4710-a41b-6e9cf57e5615');
INSERT INTO public.production_fact_cutting_events(id,machine_id,factory_id,fact_id,section_id,fact_date,status,created_by)
VALUES('b45e2e82-2f66-4bee-98ea-44fe6069aca6','93766eaa-4656-4779-964c-de604f32c954','14fc4014-3149-4127-b886-d56e30337763','4d7316bb-18f7-42f1-bc1b-c936e59050ee','3f90b7b8-d27b-4214-84d2-15e1aa8a2bff',current_date,'applied','49a966fb-683f-4710-a41b-6e9cf57e5615');
INSERT INTO public.supply_order_delivery_schedules(id,request_item_table,request_item_id,delivery_date,quantity,unit,status,received_quantity,allocated_quantity,allocated_physical_quantity,excess_quantity,receipt_inventory_id,delivered_at)
VALUES
('61fb0dc1-8676-49be-be3e-41dba3874f65','request_sheet_metal','4aa81ed9-3e2d-4df4-b43b-d158a84370e5',current_date,12,'шт','delivered',12,12,12,0,'c40b2464-1b4d-4fb8-88b8-db3d7bddb75d',now()),
('e2491227-744f-4d8d-b30f-d747315966b6','request_sheet_metal','4aa81ed9-3e2d-4df4-b43b-d158a84370e5',current_date,3,'шт','delivered',3,0,0,3,'c40b2464-1b4d-4fb8-88b8-db3d7bddb75d',now());
-- Only recreate the historical invalid reservation with the new guard disabled.
ALTER TABLE public.inventory_reservations DISABLE TRIGGER guard_supply_receipt_reservation_allocation;
INSERT INTO public.inventory_reservations(id,inventory_id,material_id,material_variant_id,machine_id,request_item_table,request_item_id,reserved_quantity,reserved_by,reservation_source,supply_order_schedule_id,consumed_at,consumed_by,consumed_cutting_event_id)
SELECT v.id::uuid,'c40b2464-1b4d-4fb8-88b8-db3d7bddb75d','8ce821e2-8ce0-49b9-bb58-42f358c16513','311a191d-474b-4e1e-81fc-72ef4367c510','93766eaa-4656-4779-964c-de604f32c954','request_sheet_metal','4aa81ed9-3e2d-4df4-b43b-d158a84370e5',v.qty,'49a966fb-683f-4710-a41b-6e9cf57e5615','supply_receipt',v.schedule::uuid,now(),'49a966fb-683f-4710-a41b-6e9cf57e5615','b45e2e82-2f66-4bee-98ea-44fe6069aca6'
FROM (VALUES('8f62d647-dea1-4234-b707-615165c9aadf',12,'61fb0dc1-8676-49be-be3e-41dba3874f65'),('7dafd241-97e5-43ac-9595-af0981d33419',3,'e2491227-744f-4d8d-b30f-d747315966b6')) v(id,qty,schedule);
ALTER TABLE public.inventory_reservations ENABLE TRIGGER guard_supply_receipt_reservation_allocation;
INSERT INTO public.production_fact_cutting_event_reservations(event_id,reservation_id,inventory_id,material_id,material_variant_id,request_item_table,request_item_id,reserved_quantity,consumed_quantity)
SELECT consumed_cutting_event_id,id,inventory_id,material_id,material_variant_id,request_item_table,request_item_id,reserved_quantity,reserved_quantity
FROM public.inventory_reservations WHERE inventory_id='c40b2464-1b4d-4fb8-88b8-db3d7bddb75d';
INSERT INTO public.inventory_transactions(id,factory_id,inventory_id,material_id,material_variant_id,transaction_type,quantity,machine_id,request_item_table,request_item_id,performed_by)
SELECT v.id::uuid,'14fc4014-3149-4127-b886-d56e30337763','c40b2464-1b4d-4fb8-88b8-db3d7bddb75d','8ce821e2-8ce0-49b9-bb58-42f358c16513','311a191d-474b-4e1e-81fc-72ef4367c510',v.type::public.inventory_transaction_type,v.qty,'93766eaa-4656-4779-964c-de604f32c954','request_sheet_metal','4aa81ed9-3e2d-4df4-b43b-d158a84370e5','49a966fb-683f-4710-a41b-6e9cf57e5615'
FROM (VALUES
('5a89761e-db04-4f0d-b62e-2c70ca463b35','receipt',12),('67e79a41-46d2-4fe2-ae39-a4f49d58acba','reserve',12),
('ecdb52b5-55fa-4394-ae9e-63b4b73dc76a','receipt',3),('2cf29bfc-2da2-49a7-8d3f-dd500dd604f3','reserve',3),
('e39166ef-de98-4654-81d8-e154ffcdf1cf','write_off',-3),('643c8177-fbbc-40b8-83b0-a25eb2648c46','write_off',-12)) v(id,type,qty);
COMMIT;
