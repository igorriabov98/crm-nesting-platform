-- Archive business scrap that was created only as a byproduct of a cut reservation
-- once that reservation is removed and the original piece has been restored.

CREATE OR REPLACE FUNCTION fn_archive_empty_business_scrap_after_unreserve()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_cut_reservation
    AND OLD.business_scrap_inventory_id IS NOT NULL
    AND COALESCE(OLD.business_scrap_quantity, 0) > 0
  THEN
    UPDATE inventory
    SET deleted_at = now(),
        deleted_by = OLD.reserved_by,
        delete_comment = 'Деловой отход удален после снятия брони и восстановления исходного куска',
        source_reservation_id = NULL,
        last_updated_by = OLD.reserved_by,
        updated_at = now()
    WHERE id = OLD.business_scrap_inventory_id
      AND is_business_scrap = true
      AND deleted_at IS NULL
      AND COALESCE(total_quantity, 0) <= 0
      AND COALESCE(total_secondary_quantity, 0) <= 0
      AND COALESCE(reserved_quantity, 0) <= 0
      AND COALESCE(reserved_secondary_quantity, 0) <= 0;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_archive_empty_business_scrap_after_unreserve ON inventory_reservations;

CREATE TRIGGER trg_archive_empty_business_scrap_after_unreserve
AFTER DELETE ON inventory_reservations
FOR EACH ROW
EXECUTE FUNCTION fn_archive_empty_business_scrap_after_unreserve();
