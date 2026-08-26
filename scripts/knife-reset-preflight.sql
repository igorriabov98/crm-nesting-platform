\set ON_ERROR_STOP on
\pset pager off

-- Operationally read-only: this transaction writes only session-local temp
-- tables and is always rolled back. No public row, schema object or storage
-- object is changed.
begin transaction isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

\ir knife-reset-scope.sql

select
  fingerprint as expected_fingerprint,
  jsonb_pretty(report) as affected_counts
from _knife_reset_snapshot;

select
  bucket_id,
  object_path,
  file_name,
  source_kind,
  source_record_id
from _knife_reset_storage_objects
order by bucket_id, object_path;

select
  item.request_item_table,
  count(*) as affected_items
from _knife_reset_items item
group by item.request_item_table
order by item.request_item_table;

rollback;
