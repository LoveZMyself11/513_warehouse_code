-- Borrowing, activities, and safe inventory availability extensions.
-- Run after schema_v2.sql, auth_and_rls.sql, and inventory_workflow.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.activities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  description TEXT,
  department_id BIGINT REFERENCES public.departments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  start_date DATE,
  end_date DATE,
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activities_date_order CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activities_name_department_unique'
      AND conrelid = 'public.activities'::regclass
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_name_department_unique UNIQUE NULLS NOT DISTINCT (name, department_id);
  END IF;
END
$$;

ALTER TABLE public.borrow_orders
  ADD COLUMN IF NOT EXISTS activity_id BIGINT REFERENCES public.activities(id) ON DELETE SET NULL;

ALTER TABLE public.borrow_orders
  ADD COLUMN IF NOT EXISTS borrowed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_activities_status_dates
  ON public.activities(status, start_date, end_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_department
  ON public.activities(department_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_orders_activity
  ON public.borrow_orders(activity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_items_item_active
  ON public.borrow_items(item_id, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS borrow_items_order_item_unique
  ON public.borrow_items(order_id, item_id);

DROP TRIGGER IF EXISTS activities_update_timestamp ON public.activities;
CREATE TRIGGER activities_update_timestamp
BEFORE UPDATE ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.activities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activities TO authenticated;
GRANT USAGE ON SEQUENCE public.activities_id_seq TO authenticated;

DROP POLICY IF EXISTS "Active users view activities" ON public.activities;
CREATE POLICY "Active users view activities" ON public.activities
FOR SELECT TO authenticated
USING (
  (SELECT private.current_app_user_id()) IS NOT NULL
  AND (
    status = 'active'
    OR (SELECT private.current_app_role()) = 'super_admin'
    OR (
      (SELECT private.current_app_role()) = 'admin'
      AND (SELECT private.current_app_department_id()) IS NOT NULL
      AND department_id IS NOT DISTINCT FROM (SELECT private.current_app_department_id())
    )
  )
);

DROP POLICY IF EXISTS "Staff create activities" ON public.activities;
CREATE POLICY "Staff create activities" ON public.activities
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND (SELECT private.current_app_department_id()) IS NOT NULL
    AND department_id IS NOT DISTINCT FROM (SELECT private.current_app_department_id())
    AND created_by = (SELECT private.current_app_user_id())
  )
);

DROP POLICY IF EXISTS "Staff update activities" ON public.activities;
CREATE POLICY "Staff update activities" ON public.activities
FOR UPDATE TO authenticated
USING (
  (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND (SELECT private.current_app_department_id()) IS NOT NULL
    AND department_id IS NOT DISTINCT FROM (SELECT private.current_app_department_id())
  )
)
WITH CHECK (
  (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND (SELECT private.current_app_department_id()) IS NOT NULL
    AND department_id IS NOT DISTINCT FROM (SELECT private.current_app_department_id())
  )
);

DROP POLICY IF EXISTS "Staff delete activities" ON public.activities;
CREATE POLICY "Staff delete activities" ON public.activities
FOR DELETE TO authenticated
USING (
  (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND (SELECT private.current_app_department_id()) IS NOT NULL
    AND department_id IS NOT DISTINCT FROM (SELECT private.current_app_department_id())
  )
);

-- Borrow writes go through the transaction RPCs below. Reads remain protected by
-- the existing order/item policies for the user's own or staff-visible orders.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.borrow_orders FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.borrow_items FROM authenticated;
REVOKE USAGE ON SEQUENCE public.borrow_orders_id_seq, public.borrow_items_id_seq FROM authenticated;

CREATE OR REPLACE FUNCTION public.update_borrow_order_status(
  p_order_id BIGINT,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.borrow_orders%ROWTYPE;
  actor_id BIGINT;
  actor_role TEXT;
BEGIN
  actor_role := (SELECT private.current_app_role());
  actor_id := (SELECT private.current_app_user_id());
  IF actor_role NOT IN ('super_admin', 'admin') OR actor_id IS NULL THEN
    RAISE EXCEPTION 'Only active administrators can update order status';
  END IF;
  IF p_status NOT IN ('pending', 'approved', 'borrowed', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid borrow order status';
  END IF;

  SELECT * INTO target
  FROM public.borrow_orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow order not found'; END IF;
  IF actor_role = 'admin'
     AND target.department_id IS DISTINCT FROM (SELECT private.current_app_department_id()) THEN
    RAISE EXCEPTION 'Department admins can only update orders in their own department';
  END IF;

  IF target.status <> p_status THEN
    IF target.status = 'pending' AND p_status NOT IN ('approved', 'cancelled') THEN
      RAISE EXCEPTION 'Pending orders can only be approved or cancelled';
    ELSIF target.status = 'approved' AND p_status NOT IN ('borrowed', 'cancelled') THEN
      RAISE EXCEPTION 'Approved orders can only be marked borrowed or cancelled';
    ELSIF target.status = 'borrowed' AND p_status <> 'returned' THEN
      RAISE EXCEPTION 'Borrowed orders can only be marked returned';
    ELSIF target.status IN ('returned', 'cancelled') THEN
      RAISE EXCEPTION 'Completed orders cannot be reopened';
    END IF;
  END IF;

  UPDATE public.borrow_orders
  SET status = p_status,
      borrowed_at = CASE WHEN p_status = 'borrowed' THEN COALESCE(borrowed_at, NOW()) ELSE borrowed_at END,
      actual_return_date = CASE WHEN p_status = 'returned' THEN COALESCE(actual_return_date, NOW()) ELSE actual_return_date END,
      notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(btrim(p_notes), '') END,
      updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'update', jsonb_build_object('source', actor_role, 'status', p_status));
END;
$$;

REVOKE ALL ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) TO authenticated;

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

  SELECT bi.item_id INTO conflict_item
  FROM public.borrow_items bi
  JOIN public.borrow_orders bo ON bo.id = bi.order_id
  JOIN jsonb_to_recordset(p_items) AS requested(item_id TEXT, quantity INTEGER)
    ON requested.item_id = bi.item_id
  WHERE bo.status IN ('pending', 'approved', 'borrowed', 'return_requested')
  ORDER BY bi.item_id
  LIMIT 1;
  IF conflict_item IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory item % already has an active borrow order', conflict_item;
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

-- Keep the original RPC compatible for existing clients while routing it
-- through the same atomic validation path.
CREATE OR REPLACE FUNCTION public.create_borrow_order(
  p_item_id TEXT,
  p_quantity INTEGER,
  p_reason TEXT,
  p_expected_return_date DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.create_borrow_order_batch(
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('item_id', p_item_id, 'quantity', p_quantity)
    ),
    p_reason,
    p_expected_return_date,
    p_notes,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_borrow_order(TEXT, INTEGER, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_borrow_order(TEXT, INTEGER, TEXT, DATE, TEXT) TO authenticated;

-- Return only operationally necessary fields for active users. Full orders and
-- contact details remain protected by the existing order/user RLS policies.
CREATE OR REPLACE FUNCTION public.get_inventory_borrow_status(p_item_ids TEXT[] DEFAULT NULL)
RETURNS TABLE (
  item_id TEXT,
  order_id BIGINT,
  order_number TEXT,
  borrower_name TEXT,
  department_name TEXT,
  borrowed_at TIMESTAMPTZ,
  expected_return_date DATE,
  activity_id BIGINT,
  activity_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT private.current_app_user_id()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  RETURN QUERY
  SELECT bi.item_id,
         bo.id,
         bo.order_number,
         u.name,
         d.name,
         COALESCE(bo.borrowed_at, bo.updated_at),
         bo.expected_return_date,
         bo.activity_id,
         a.name
  FROM public.borrow_items bi
  JOIN public.borrow_orders bo ON bo.id = bi.order_id
  JOIN public.users u ON u.id = bo.user_id
  LEFT JOIN public.departments d ON d.id = bo.department_id
  LEFT JOIN public.activities a ON a.id = bo.activity_id
  WHERE bo.status = 'borrowed'
    AND (p_item_ids IS NULL OR bi.item_id = ANY(p_item_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_borrow_status(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_borrow_status(TEXT[]) TO authenticated;

-- Refresh PostgREST's schema cache after adding the table, columns, and RPCs.
NOTIFY pgrst, 'reload schema';

COMMIT;
