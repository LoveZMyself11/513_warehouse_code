BEGIN;

-- Activities can opt out of borrow approval: orders linked to such an activity are
-- recorded directly as borrowed for every role. Returns keep the shared review flow.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS auto_approve_borrows BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.activities.auto_approve_borrows IS
  '超级管理员勾选：关联该活动的借用单免审批，提交后直接借出';

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
  actor_role TEXT;
  activity_auto_approve BOOLEAN := FALSE;
  instant_borrow BOOLEAN;
  new_order_id BIGINT;
  new_order_number TEXT;
  requested_count INTEGER;
  locked_count INTEGER := 0;
  lock_item RECORD;
  conflict_item TEXT;
BEGIN
  actor_id := (SELECT private.current_app_user_id());
  actor_department_id := (SELECT private.current_app_department_id());
  actor_role := (SELECT private.current_app_role());
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
  IF p_activity_id IS NOT NULL THEN
    PERFORM 1 FROM public.activities
    WHERE id = p_activity_id AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Selected activity is not active'; END IF;
    SELECT auto_approve_borrows INTO activity_auto_approve
    FROM public.activities WHERE id = p_activity_id;
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

  instant_borrow := actor_role = 'super_admin' OR activity_auto_approve;

  new_order_number := 'BO' || to_char(CURRENT_DATE, 'YYYYMMDD')
    || lpad(nextval('public.borrow_order_number_seq')::TEXT, 5, '0');
  INSERT INTO public.borrow_orders (
    order_number, user_id, department_id, activity_id, status, reason, expected_return_date, notes, borrowed_at
  ) VALUES (
    new_order_number, actor_id, actor_department_id, p_activity_id,
    CASE WHEN instant_borrow THEN 'borrowed' ELSE 'pending' END, btrim(p_reason),
    p_expected_return_date, NULLIF(btrim(p_notes), ''),
    CASE WHEN instant_borrow THEN pg_catalog.now() END
  ) RETURNING id INTO new_order_id;

  INSERT INTO public.borrow_items (order_id, item_id, quantity_borrowed)
  SELECT new_order_id, requested.item_id, requested.quantity
  FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER);

  INSERT INTO public.operation_logs (user_id, item_id, order_id, action, details)
  SELECT actor_id, requested.item_id, new_order_id, 'borrow',
         jsonb_build_object('source', 'batch_self_service', 'status',
           CASE WHEN instant_borrow THEN 'borrowed' ELSE 'pending' END,
           'auto_borrowed', instant_borrow,
           'auto_source', CASE
             WHEN NOT instant_borrow THEN NULL
             WHEN actor_role = 'super_admin' THEN 'super_admin'
             ELSE 'activity' END)
  FROM jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER);

  RETURN new_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_borrow_order_batch(JSONB, TEXT, DATE, TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_borrow_order_batch(JSONB, TEXT, DATE, TEXT, BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
