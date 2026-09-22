# Receipt surplus protection and CIV-19-2026 correction

Receiving correctly allocated 12 sheets to CIV-19-2026 and left 3 free. Cutting
later reconstructed a reservation from the second delivery's received quantity,
despite its allocation being zero, and consumed all 15 sheets.

Migration `20260922115830_protect_supply_receipt_surplus.sql` makes receipt
allocation authoritative: cutting consumes existing reservations and cannot
recreate them from delivery quantities. A database trigger rejects receipt
reservations without a delivered allocation or above its physical quantity.
This applies to all nine request categories, including whole bars whose physical
quantity can exceed their logical cut length. The existing unique schedule index
prevents multiple reservations against the same allocation.

## Targeted data correction

`scripts/repair-civ19-receipt-surplus.sql` is separate from the migration. It
requires an active CRM administrator, the installed guard, and the exact audited
inventory, receipt and cutting state. Any subsequent operations stop the repair.

The correction restores 3 free sheets, removes the invalid consumed reservation
and its cutting rollback snapshot, and adds an adjustment transaction. All six
original movement records remain. Removing the invalid rollback snapshot is
necessary to prevent a later cutting rollback from restoring these 3 sheets twice.
The valid reservation of 12 remains intact. Repeating the repair is a no-op.

Before production execution, obtain the separate operator confirmation required
by `AGENTS.md` and record the current production backup location and timestamp
as required by `docs/OPERATIONS.md`. Apply the protection migration first.

Use an authenticated database connection configured through standard PostgreSQL
environment variables. Never put credentials in the command line. Choose a new,
absolute backup filename for each execution; do not overwrite an earlier backup.

```sh
# Rehearsal writes inside a transaction, captures evidence, then rolls back.
# This also requires production mutation approval.
psql -X -v ON_ERROR_STOP=1 -v actor_id=<administrator-uuid> \
  -v backup_path=<absolute-path-to-new-rehearsal.json> \
  -f scripts/repair-civ19-receipt-surplus.sql

# Apply only after confirming the backup and unchanged evidence.
psql -X -v ON_ERROR_STOP=1 -v apply=true -v actor_id=<administrator-uuid> \
  -v backup_path=<absolute-path-to-new-before-repair.json> \
  -f scripts/repair-civ19-receipt-surplus.sql
```

The JSON evidence includes the inventory row, both reservations, both cutting
snapshots, six transactions, and delivery schedules. The transaction locks these
records before capture and correction. Verify the result as total 3, reserved 0,
available 3, with the adjustment visible in warehouse history. Original erroneous
movements remain visible as historical events, compensated by the adjustment.

## Local regression checks

`FULL_SCHEMA_TEST_DATABASE_URL=postgresql://localhost/crm_receipt_surplus_test npm run test:supply-receiving-plan-fact`
rebuilds a dedicated local test database, runs receiving and allocation suites,
checks all categories, repeats concurrent receiving attempts, and tests the exact
CIV-19 repair. The repair test covers rollback-by-default, backup contents,
idempotency, and an actual cutting rollback: total 15, reserved 12, available 3.

Whole-bar consumption and rollback are additionally covered by
`supabase/tests/long_stock_cutting_fact_test.sql` against the same local schema.
