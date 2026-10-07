BEGIN;

CREATE OR REPLACE FUNCTION private.is_returnable_location(p_code TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.inventory_locations loc
    WHERE loc.code = p_code AND NOT loc.is_pending_level
      AND (loc.code ~ '^[A-D][1-4]$' OR loc.code IN ('FLOOR', 'DOOR'))
      AND loc.qr_payload = '513-warehouse:' || loc.code
  )
$$;
REVOKE ALL ON FUNCTION private.is_returnable_location(TEXT) FROM PUBLIC, anon, authenticated;

-- Both the single-item and batch RPC use this insertion trigger.
CREATE OR REPLACE FUNCTION private.capture_borrow_location()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  SELECT location_code INTO NEW.borrow_location_code
  FROM public.inventory_items WHERE id = NEW.item_id;
  IF NOT private.is_returnable_location(NEW.borrow_location_code) THEN
    RAISE EXCEPTION 'Confirm an official QR-supported location before borrowing this item';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_borrow_location() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_borrow_order_status(
  p_order_id BIGINT, p_status TEXT, p_notes TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.borrow_orders%ROWTYPE;
  actor_id BIGINT := (SELECT private.current_app_user_id());
  actor_role TEXT := (SELECT private.current_app_role());
  effective_status TEXT;
  inventory_row RECORD;
  item_count INTEGER := 0;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Only active administrators can update order status';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'borrowed', 'cancelled') THEN
    RAISE EXCEPTION 'Returns require a return request and review';
  END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow order not found'; END IF;
  IF target.user_id = actor_id THEN RAISE EXCEPTION 'You cannot review your own borrow order'; END IF;
  IF actor_role = 'admin' AND (target.borrower_role <> 'member'
    OR target.department_id IS DISTINCT FROM (SELECT private.current_app_department_id())) THEN
    RAISE EXCEPTION 'Department admins can only review member orders in their department';
  END IF;
  effective_status := CASE WHEN p_status = 'approved' THEN 'borrowed' ELSE p_status END;
  IF target.status NOT IN ('pending', 'approved') OR effective_status NOT IN ('borrowed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid borrow order transition';
  END IF;
  IF effective_status = 'borrowed' THEN
    FOR inventory_row IN
      SELECT ii.id, ii.location_code FROM public.inventory_items ii
      JOIN public.borrow_items bi ON bi.item_id = ii.id
      WHERE bi.order_id = p_order_id ORDER BY ii.id FOR UPDATE OF ii
    LOOP
      IF NOT private.is_returnable_location(inventory_row.location_code) THEN
        RAISE EXCEPTION 'Confirm an official QR-supported location before approving item %', inventory_row.id;
      END IF;
      item_count := item_count + 1;
    END LOOP;
    IF item_count = 0 THEN RAISE EXCEPTION 'Borrow order has no inventory items'; END IF;
    UPDATE public.borrow_items bi SET borrow_location_code = ii.location_code, updated_at = pg_catalog.now()
    FROM public.inventory_items ii WHERE bi.order_id = p_order_id AND ii.id = bi.item_id;
  END IF;
  UPDATE public.borrow_orders SET status = effective_status,
    borrowed_at = CASE WHEN effective_status = 'borrowed' THEN pg_catalog.now() ELSE borrowed_at END,
    notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(pg_catalog.btrim(p_notes), '') END,
    updated_at = pg_catalog.now() WHERE id = p_order_id;
  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'update', pg_catalog.jsonb_build_object(
    'source', actor_role, 'status', effective_status, 'changed_at', pg_catalog.now()));
END;
$$;
REVOKE ALL ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_unresolved_borrow_location(
  p_borrow_item_id BIGINT, p_location_code TEXT, p_reason TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id BIGINT := (SELECT private.current_app_user_id());
  borrow_row public.borrow_items%ROWTYPE;
  target public.borrow_orders%ROWTYPE;
  inventory_row public.inventory_items%ROWTYPE;
  confirmed_code TEXT := pg_catalog.upper(pg_catalog.btrim(p_location_code));
BEGIN
  IF actor_id IS NULL OR (SELECT private.current_app_role()) IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only active super administrators can correct unresolved borrow locations';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A location correction reason is required'; END IF;
  IF NOT private.is_returnable_location(confirmed_code) THEN RAISE EXCEPTION 'Choose a confirmed official QR-supported location'; END IF;
  SELECT * INTO borrow_row FROM public.borrow_items WHERE id = p_borrow_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow item not found'; END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = borrow_row.order_id FOR UPDATE;
  IF target.status <> 'borrowed' THEN RAISE EXCEPTION 'Only outstanding borrowed orders can be corrected'; END IF;
  SELECT * INTO borrow_row FROM public.borrow_items WHERE id = p_borrow_item_id FOR UPDATE;
  IF borrow_row.quantity_returned >= borrow_row.quantity_borrowed THEN RAISE EXCEPTION 'Borrow item is already returned'; END IF;
  IF private.is_returnable_location(borrow_row.borrow_location_code) THEN
    RAISE EXCEPTION 'This borrow item already has a confirmed return location';
  END IF;
  SELECT * INTO inventory_row FROM public.inventory_items WHERE id = borrow_row.item_id FOR UPDATE;
  UPDATE public.inventory_items SET location_code = confirmed_code, updated_at = pg_catalog.now() WHERE id = inventory_row.id;
  UPDATE public.borrow_items SET borrow_location_code = confirmed_code, updated_at = pg_catalog.now() WHERE id = p_borrow_item_id;
  INSERT INTO public.operation_logs(user_id, item_id, order_id, action, details)
  VALUES (actor_id, borrow_row.item_id, target.id, 'move', pg_catalog.jsonb_build_object(
    'source', 'correct_unresolved_borrow_location', 'borrow_item_id', p_borrow_item_id,
    'previous_borrow_location', borrow_row.borrow_location_code,
    'previous_inventory_location', inventory_row.location_code,
    'confirmed_location', confirmed_code, 'reason', pg_catalog.btrim(p_reason),
    'responsible_user_id', target.user_id, 'corrected_at', pg_catalog.now()));
END;
$$;
REVOKE ALL ON FUNCTION public.correct_unresolved_borrow_location(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_unresolved_borrow_location(BIGINT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
