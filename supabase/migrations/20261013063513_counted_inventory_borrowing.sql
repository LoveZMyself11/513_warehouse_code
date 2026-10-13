BEGIN;

-- Only explicit integer quantities are countable. Descriptions remain whole-item stock.
CREATE OR REPLACE FUNCTION private.inventory_capacity(p_quantity TEXT)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF pg_catalog.btrim(p_quantity) ~ '^[0-9]{1,10}$' THEN
    IF pg_catalog.btrim(p_quantity)::NUMERIC <= 2147483647 THEN
      RETURN pg_catalog.btrim(p_quantity)::INTEGER;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.inventory_capacity(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_availability()
RETURNS TABLE (item_id TEXT, total_quantity INTEGER, reserved_quantity BIGINT, available_quantity BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT private.current_app_user_id()) IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN QUERY
  SELECT ii.id, private.inventory_capacity(ii.quantity), COALESCE(used.quantity, 0),
    GREATEST(0::BIGINT, COALESCE(private.inventory_capacity(ii.quantity), 1)::BIGINT - COALESCE(used.quantity, 0))
  FROM public.inventory_items ii
  LEFT JOIN (
    SELECT bi.item_id, sum(bi.quantity_borrowed - COALESCE(bi.quantity_returned, 0)) AS quantity
    FROM public.borrow_items bi JOIN public.borrow_orders bo ON bo.id = bi.order_id
    WHERE bo.status IN ('pending', 'approved', 'borrowed', 'return_requested')
    GROUP BY bi.item_id
  ) used ON used.item_id = ii.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_inventory_availability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_availability() TO authenticated;

-- Updates lock the same inventory row as applications, preventing stock reduction
-- below pending reservations or outstanding loans.
CREATE OR REPLACE FUNCTION private.guard_inventory_quantity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE occupied BIGINT;
BEGIN
  IF NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN RETURN NEW; END IF;
  SELECT COALESCE(sum(bi.quantity_borrowed - COALESCE(bi.quantity_returned, 0)), 0) INTO occupied
  FROM public.borrow_items bi JOIN public.borrow_orders bo ON bo.id = bi.order_id
  WHERE bi.item_id = OLD.id AND bo.status IN ('pending', 'approved', 'borrowed', 'return_requested');
  IF COALESCE(private.inventory_capacity(NEW.quantity), 1) < occupied THEN
    RAISE EXCEPTION 'Inventory quantity cannot be below reserved or borrowed quantity (%)', occupied;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_inventory_quantity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER inventory_items_guard_quantity BEFORE UPDATE OF quantity ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION private.guard_inventory_quantity();

-- Recheck older pending orders that were created before quantity reservations.
CREATE OR REPLACE FUNCTION private.guard_borrow_approval_quantity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE stock RECORD; occupied BIGINT;
BEGIN
  IF NEW.status <> 'borrowed' OR OLD.status NOT IN ('pending', 'approved') THEN RETURN NEW; END IF;
  FOR stock IN SELECT ii.id, ii.quantity FROM public.inventory_items ii
    JOIN public.borrow_items bi ON bi.item_id = ii.id
    WHERE bi.order_id = NEW.id ORDER BY ii.id FOR UPDATE OF ii
  LOOP
    SELECT COALESCE(sum(bi.quantity_borrowed - COALESCE(bi.quantity_returned, 0)), 0) INTO occupied
    FROM public.borrow_items bi JOIN public.borrow_orders bo ON bo.id = bi.order_id
    WHERE bi.item_id = stock.id AND bo.status IN ('pending', 'approved', 'borrowed', 'return_requested');
    IF private.inventory_capacity(stock.quantity) IS NOT NULL
       AND occupied > private.inventory_capacity(stock.quantity) THEN
      RAISE EXCEPTION 'Inventory item % has insufficient available quantity; resolve pending orders first', stock.id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_borrow_approval_quantity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER borrow_orders_guard_approval_quantity BEFORE UPDATE OF status ON public.borrow_orders
FOR EACH ROW EXECUTE FUNCTION private.guard_borrow_approval_quantity();

CREATE OR REPLACE FUNCTION public.create_borrow_order_batch(
  p_items JSONB,
  p_reason TEXT,
  p_expected_return_date DATE,
  p_notes TEXT DEFAULT NULL,
  p_activity_id BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id BIGINT;
  actor_department_id BIGINT;
  new_order_id BIGINT;
  new_order_number TEXT;
  requested_count INTEGER;
  locked_count INTEGER := 0;
  lock_item RECORD;
  conflict_item TEXT;
BEGIN
  actor_id := (SELECT private.current_app_user_id());
  actor_department_id := (SELECT private.current_app_department_id());
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Borrow items must be a JSON array';
  END IF;
  SELECT count(*) INTO requested_count
  FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER);
  IF requested_count < 1 OR requested_count > 100 THEN
    RAISE EXCEPTION 'Select between 1 and 100 items';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER)
    WHERE requested.item_id IS NULL OR btrim(requested.item_id) = '' OR requested.quantity IS NULL OR requested.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Each borrow item needs a positive quantity';
  END IF;
  IF EXISTS (
    SELECT requested.item_id
    FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER)
    GROUP BY requested.item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate inventory items are not allowed';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Borrow reason is required'; END IF;
  IF p_expected_return_date IS NULL OR p_expected_return_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Expected return date cannot be before today';
  END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.activities
    WHERE id = p_activity_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Selected activity is not active';
  END IF;

  -- Lock all selected inventory rows before checking active orders. This makes
  -- concurrent batch submissions serialize on the inventory item.
  FOR lock_item IN
    SELECT ii.id
    FROM public.inventory_items ii
    JOIN (
      SELECT DISTINCT item_id
      FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER)
    ) requested ON requested.item_id = ii.id
    ORDER BY ii.id
    FOR UPDATE OF ii
  LOOP
    locked_count := locked_count + 1;
  END LOOP;
  IF locked_count <> requested_count THEN
    RAISE EXCEPTION 'One or more inventory items were not found';
  END IF;

  SELECT ii.id INTO conflict_item
  FROM public.inventory_items ii
  JOIN jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER)
    ON requested.item_id = ii.id
  WHERE requested.quantity > COALESCE(private.inventory_capacity(ii.quantity), 1)
    - (SELECT COALESCE(sum(bi.quantity_borrowed - COALESCE(bi.quantity_returned, 0)), 0)
       FROM public.borrow_items bi JOIN public.borrow_orders bo ON bo.id = bi.order_id
       WHERE bi.item_id = ii.id AND bo.status IN ('pending', 'approved', 'borrowed', 'return_requested'))
  ORDER BY ii.id LIMIT 1;
  IF conflict_item IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory item % has insufficient available quantity; refresh inventory', conflict_item;
  END IF;

  new_order_number := 'BO' || to_char(CURRENT_DATE, 'YYYYMMDD')
    || lpad(nextval('public.borrow_order_number_seq')::TEXT, 5, '0');
  INSERT INTO public.borrow_orders (
    order_number, user_id, department_id, activity_id, status, reason, expected_return_date, notes
  ) VALUES (
    new_order_number, actor_id, actor_department_id, p_activity_id, 'pending', btrim(p_reason),
    p_expected_return_date, NULLIF(btrim(p_notes), '')
  ) RETURNING id INTO new_order_id;

  INSERT INTO public.borrow_items (order_id, item_id, quantity_borrowed)
  SELECT new_order_id, requested.item_id, requested.quantity
  FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER);

  INSERT INTO public.operation_logs (user_id, item_id, order_id, action, details)
  SELECT actor_id, requested.item_id, new_order_id, 'borrow',
         jsonb_build_object('source', 'batch_self_service', 'status', 'pending')
  FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER);

  RETURN new_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_borrow_order_batch(JSONB, TEXT, DATE, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_borrow_order_batch(JSONB, TEXT, DATE, TEXT, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
