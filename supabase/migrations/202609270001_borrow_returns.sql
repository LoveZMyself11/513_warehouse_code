-- Borrow return requests with original-location proof and second-level audit times.
-- Run after 202609220001_borrow_activities.sql.

BEGIN;

ALTER TABLE public.borrow_orders
  ADD COLUMN IF NOT EXISTS return_submitted_at TIMESTAMPTZ;

ALTER TABLE public.borrow_items
  ADD COLUMN IF NOT EXISTS borrow_location_code TEXT;

UPDATE public.borrow_items bi
SET borrow_location_code = ii.location_code
FROM public.inventory_items ii
WHERE bi.item_id = ii.id
  AND bi.borrow_location_code IS NULL;

ALTER TABLE public.borrow_items
  ALTER COLUMN borrow_location_code SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'borrow_orders_status_check'
      AND conrelid = 'public.borrow_orders'::regclass
  ) THEN
    ALTER TABLE public.borrow_orders DROP CONSTRAINT borrow_orders_status_check;
  END IF;
  ALTER TABLE public.borrow_orders
    ADD CONSTRAINT borrow_orders_status_check
    CHECK (status IN ('pending', 'approved', 'borrowed', 'return_requested', 'returned', 'cancelled'));
END
$$;

CREATE INDEX IF NOT EXISTS idx_borrow_orders_user_status
  ON public.borrow_orders(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.borrow_return_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.borrow_orders(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT borrow_return_requests_reviewed_after_submission
    CHECK (reviewed_at IS NULL OR reviewed_at >= submitted_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS borrow_return_requests_one_pending
  ON public.borrow_return_requests(order_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_borrow_return_requests_user_submitted
  ON public.borrow_return_requests(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_return_requests_order_submitted
  ON public.borrow_return_requests(order_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.borrow_return_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_request_id BIGINT NOT NULL REFERENCES public.borrow_return_requests(id) ON DELETE CASCADE,
  borrow_item_id BIGINT NOT NULL REFERENCES public.borrow_items(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  original_location_code TEXT NOT NULL REFERENCES public.inventory_locations(code),
  returned_location_code TEXT NOT NULL REFERENCES public.inventory_locations(code),
  photo_path TEXT,
  item_condition TEXT NOT NULL DEFAULT 'good' CHECK (item_condition IN ('good', 'damaged', 'lost')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (return_request_id, borrow_item_id)
);

CREATE INDEX IF NOT EXISTS idx_borrow_return_items_request
  ON public.borrow_return_items(return_request_id, borrow_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS borrow_return_items_photo_path_unique
  ON public.borrow_return_items(photo_path);

CREATE OR REPLACE FUNCTION private.capture_borrow_location()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  SELECT location_code INTO NEW.borrow_location_code
  FROM public.inventory_items WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_borrow_location() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS borrow_items_capture_location ON public.borrow_items;
CREATE TRIGGER borrow_items_capture_location
BEFORE INSERT ON public.borrow_items
FOR EACH ROW EXECUTE FUNCTION private.capture_borrow_location();

DROP TRIGGER IF EXISTS borrow_return_requests_update_timestamp ON public.borrow_return_requests;
CREATE TRIGGER borrow_return_requests_update_timestamp
BEFORE UPDATE ON public.borrow_return_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.borrow_return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrow_return_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.borrow_return_requests, public.borrow_return_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.borrow_return_requests, public.borrow_return_items TO authenticated;

DROP POLICY IF EXISTS "Users view own return requests and staff view department" ON public.borrow_return_requests;
CREATE POLICY "Users view own return requests and staff view department"
ON public.borrow_return_requests FOR SELECT TO authenticated
USING (
  user_id = (SELECT private.current_app_user_id())
  OR (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.borrow_orders bo
      WHERE bo.id = order_id
        AND bo.department_id = (SELECT private.current_app_department_id())
    )
  )
);

DROP POLICY IF EXISTS "Users view own return items and staff view department" ON public.borrow_return_items;
CREATE POLICY "Users view own return items and staff view department"
ON public.borrow_return_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.borrow_return_requests rr
    JOIN public.borrow_orders bo ON bo.id = rr.order_id
    WHERE rr.id = return_request_id
      AND (
        rr.user_id = (SELECT private.current_app_user_id())
        OR (SELECT private.current_app_role()) = 'super_admin'
        OR (
          (SELECT private.current_app_role()) = 'admin'
          AND bo.department_id = (SELECT private.current_app_department_id())
        )
      )
  )
);

-- Members use the borrowing workflow only. Inventory change requests remain
-- available to department admins and super administrators.
DROP POLICY IF EXISTS "Users view own change requests and super admins view all" ON public.inventory_change_requests;
CREATE POLICY "Staff view inventory change requests"
ON public.inventory_change_requests FOR SELECT TO authenticated
USING (
  (SELECT private.current_app_role()) = 'super_admin'
  OR (
    (SELECT private.current_app_role()) = 'admin'
    AND requested_by = (SELECT private.current_app_user_id())
  )
);

DROP POLICY IF EXISTS "Users submit own pending change requests" ON public.inventory_change_requests;
CREATE POLICY "Department admins submit inventory change requests"
ON public.inventory_change_requests FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.current_app_role()) = 'admin'
  AND requested_by = (SELECT private.current_app_user_id())
  AND status = 'pending'
  AND result_item_id IS NULL
  AND reviewed_by IS NULL
  AND review_note IS NULL
  AND reviewed_at IS NULL
);

DROP POLICY IF EXISTS "Users withdraw own pending change requests" ON public.inventory_change_requests;
CREATE POLICY "Department admins withdraw inventory change requests"
ON public.inventory_change_requests FOR DELETE TO authenticated
USING (
  (SELECT private.current_app_role()) = 'admin'
  AND requested_by = (SELECT private.current_app_user_id())
  AND status = 'pending'
);

CREATE OR REPLACE FUNCTION public.submit_borrow_return_request(
  p_order_id BIGINT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id BIGINT;
  actor_auth_id UUID;
  target_order public.borrow_orders%ROWTYPE;
  request_id BIGINT;
  expected_count INTEGER;
  submitted_count INTEGER;
  submitted_item RECORD;
  submission_time TIMESTAMPTZ;
BEGIN
  actor_id := (SELECT private.current_app_user_id());
  actor_auth_id := (SELECT auth.uid());
  IF actor_id IS NULL OR actor_auth_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Return items must be a JSON array';
  END IF;

  SELECT * INTO target_order
  FROM public.borrow_orders
  WHERE id = p_order_id AND user_id = actor_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow order not found'; END IF;
  IF target_order.status <> 'borrowed' THEN
    RAISE EXCEPTION 'Only borrowed orders can be returned';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.borrow_return_requests
    WHERE order_id = p_order_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A return request is already pending';
  END IF;

  SELECT count(*) INTO expected_count
  FROM public.borrow_items
  WHERE order_id = p_order_id AND quantity_returned < quantity_borrowed;
  SELECT count(*) INTO submitted_count
  FROM pg_catalog.jsonb_to_recordset(p_items) AS submitted(borrow_item_id BIGINT, returned_location_code TEXT, photo_path TEXT, item_condition TEXT, notes TEXT);
  IF expected_count < 1 OR submitted_count <> expected_count THEN
    RAISE EXCEPTION 'Every outstanding borrowed item must be included';
  END IF;
  IF EXISTS (
    SELECT borrow_item_id
    FROM pg_catalog.jsonb_to_recordset(p_items) AS submitted(borrow_item_id BIGINT, returned_location_code TEXT, photo_path TEXT, item_condition TEXT, notes TEXT)
    GROUP BY borrow_item_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Duplicate return items are not allowed'; END IF;

  submission_time := pg_catalog.now();

  INSERT INTO public.borrow_return_requests (order_id, user_id, status, submitted_at, notes)
  VALUES (p_order_id, actor_id, 'pending', submission_time, NULLIF(pg_catalog.btrim(p_notes), ''))
  RETURNING id INTO request_id;

  FOR submitted_item IN
    SELECT * FROM pg_catalog.jsonb_to_recordset(p_items)
      AS submitted(borrow_item_id BIGINT, returned_location_code TEXT, photo_path TEXT, item_condition TEXT, notes TEXT)
  LOOP
    IF submitted_item.photo_path IS NOT NULL
       AND (submitted_item.photo_path NOT LIKE 'returns/' || actor_auth_id::TEXT || '/' || p_order_id::TEXT || '/%'
       OR NOT EXISTS (
         SELECT 1 FROM storage.objects
         WHERE bucket_id = 'borrow-return-images'
           AND name = submitted_item.photo_path
           AND owner_id = actor_auth_id::TEXT
       )) THEN
      RAISE EXCEPTION 'Return photo path is invalid';
    END IF;
    INSERT INTO public.borrow_return_items (
      return_request_id, borrow_item_id, item_id, original_location_code,
      returned_location_code, photo_path, item_condition, notes
    )
    SELECT request_id, bi.id, bi.item_id, bi.borrow_location_code,
           submitted_item.returned_location_code, submitted_item.photo_path,
           submitted_item.item_condition,
           NULLIF(pg_catalog.btrim(submitted_item.notes), '')
    FROM public.borrow_items bi
    WHERE bi.id = submitted_item.borrow_item_id
      AND bi.order_id = p_order_id
      AND bi.quantity_returned < bi.quantity_borrowed
      AND submitted_item.returned_location_code = bi.borrow_location_code
      AND submitted_item.returned_location_code IS NOT NULL
      AND submitted_item.item_condition IN ('good', 'damaged', 'lost');
    IF NOT FOUND THEN RAISE EXCEPTION 'Return item, original location, or condition is invalid'; END IF;
  END LOOP;

  UPDATE public.borrow_orders
  SET status = 'return_requested', return_submitted_at = submission_time, updated_at = submission_time
  WHERE id = p_order_id;

  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'return', pg_catalog.jsonb_build_object(
    'source', 'member_return_request', 'status', 'return_requested',
    'submitted_at', submission_time, 'return_request_id', request_id
  ));
  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_borrow_return_request(BIGINT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_borrow_return_request(BIGINT, JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_borrow_return_request(
  p_return_request_id BIGINT,
  p_approve BOOLEAN,
  p_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id BIGINT;
  actor_role TEXT;
  request_row public.borrow_return_requests%ROWTYPE;
  target_order public.borrow_orders%ROWTYPE;
  return_item RECORD;
BEGIN
  actor_id := (SELECT private.current_app_user_id());
  actor_role := (SELECT private.current_app_role());
  IF actor_id IS NULL OR actor_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Only active administrators can review return requests';
  END IF;
  SELECT * INTO request_row FROM public.borrow_return_requests WHERE id = p_return_request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN RAISE EXCEPTION 'Return request is not pending'; END IF;
  SELECT * INTO target_order FROM public.borrow_orders WHERE id = request_row.order_id FOR UPDATE;
  IF target_order.status <> 'return_requested' THEN
    RAISE EXCEPTION 'Borrow order is not awaiting return review';
  END IF;
  IF actor_role = 'admin' AND target_order.department_id IS DISTINCT FROM (SELECT private.current_app_department_id()) THEN
    RAISE EXCEPTION 'Department admins can only review their own department';
  END IF;

  IF p_approve THEN
    IF NOT EXISTS (SELECT 1 FROM public.borrow_return_items WHERE return_request_id = request_row.id) THEN
      RAISE EXCEPTION 'Return request has no items';
    END IF;
    FOR return_item IN
      SELECT rri.*, bi.quantity_borrowed, bi.quantity_returned
      FROM public.borrow_return_items rri
      JOIN public.borrow_items bi ON bi.id = rri.borrow_item_id
      WHERE rri.return_request_id = request_row.id
      ORDER BY rri.borrow_item_id
      FOR UPDATE OF bi
    LOOP
      IF return_item.item_condition = 'lost' THEN
        RAISE EXCEPTION '遗失物品不能直接确认归还';
      END IF;
      UPDATE public.inventory_items
      SET location_code = return_item.original_location_code,
          updated_at = pg_catalog.now()
      WHERE id = return_item.item_id;
      UPDATE public.borrow_items
      SET quantity_returned = quantity_borrowed,
          item_condition = return_item.item_condition,
          notes = COALESCE(return_item.notes, notes),
          updated_at = pg_catalog.now()
      WHERE id = return_item.borrow_item_id;
    END LOOP;

    UPDATE public.borrow_orders
    SET status = 'returned', actual_return_date = pg_catalog.now(), updated_at = pg_catalog.now()
    WHERE id = target_order.id;
  ELSE
    UPDATE public.borrow_orders
    SET status = 'borrowed', return_submitted_at = NULL, updated_at = pg_catalog.now()
    WHERE id = target_order.id;
  END IF;

  UPDATE public.borrow_return_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = actor_id,
      reviewed_at = pg_catalog.now(),
      review_note = NULLIF(pg_catalog.btrim(p_review_note), ''),
      updated_at = pg_catalog.now()
  WHERE id = request_row.id;

  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, target_order.id, 'return', pg_catalog.jsonb_build_object(
    'source', 'staff_return_review',
    'status', CASE WHEN p_approve THEN 'returned' ELSE 'rejected' END,
    'reviewed_at', pg_catalog.now(), 'return_request_id', request_row.id,
    'review_note', NULLIF(pg_catalog.btrim(p_review_note), '')
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.review_borrow_return_request(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_borrow_return_request(BIGINT, BOOLEAN, TEXT) TO authenticated;

-- The older staff RPC must not bypass the photo-backed return review.
CREATE OR REPLACE FUNCTION public.update_borrow_order_status(
  p_order_id BIGINT, p_status TEXT, p_notes TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  IF p_status NOT IN ('approved', 'borrowed', 'cancelled') THEN
    RAISE EXCEPTION 'Returns require a return request and photo review';
  END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrow order not found'; END IF;
  IF actor_role = 'admin'
     AND target.department_id IS DISTINCT FROM (SELECT private.current_app_department_id()) THEN
    RAISE EXCEPTION 'Department admins can only update orders in their own department';
  END IF;
  IF NOT ((target.status = 'pending' AND p_status IN ('approved', 'cancelled'))
       OR (target.status = 'approved' AND p_status IN ('borrowed', 'cancelled'))) THEN
    RAISE EXCEPTION 'Invalid borrow order transition';
  END IF;
  IF p_status = 'borrowed' THEN
    UPDATE public.borrow_items bi
    SET borrow_location_code = ii.location_code,
        updated_at = pg_catalog.now()
    FROM public.inventory_items ii
    WHERE bi.order_id = p_order_id AND ii.id = bi.item_id;
  END IF;
  UPDATE public.borrow_orders
  SET status = p_status,
      borrowed_at = CASE WHEN p_status = 'borrowed' THEN pg_catalog.now() ELSE borrowed_at END,
      notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(pg_catalog.btrim(p_notes), '') END,
      updated_at = pg_catalog.now()
  WHERE id = p_order_id;
  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'update', pg_catalog.jsonb_build_object(
    'source', actor_role, 'status', p_status, 'changed_at', pg_catalog.now()
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_borrow_status(p_item_ids TEXT[] DEFAULT NULL)
RETURNS TABLE (
  item_id TEXT, order_id BIGINT, order_number TEXT, borrower_name TEXT,
  department_name TEXT, borrowed_at TIMESTAMPTZ, expected_return_date DATE,
  activity_id BIGINT, activity_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT private.current_app_user_id()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  RETURN QUERY
  SELECT bi.item_id, bo.id, bo.order_number, u.name, d.name,
         COALESCE(bo.borrowed_at, bo.updated_at), bo.expected_return_date,
         bo.activity_id, a.name
  FROM public.borrow_items bi
  JOIN public.borrow_orders bo ON bo.id = bi.order_id
  JOIN public.users u ON u.id = bo.user_id
  LEFT JOIN public.departments d ON d.id = bo.department_id
  LEFT JOIN public.activities a ON a.id = bo.activity_id
  WHERE bo.status IN ('borrowed', 'return_requested')
    AND bi.quantity_returned < bi.quantity_borrowed
    AND (p_item_ids IS NULL OR bi.item_id = ANY(p_item_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_borrow_status(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_borrow_status(TEXT[]) TO authenticated;

-- Return photos are private; the app obtains short-lived signed URLs for reviewers.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'borrow-return-images', 'borrow-return-images', FALSE, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET public = FALSE, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Active users upload borrow return images" ON storage.objects;
CREATE POLICY "Active users upload borrow return images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'borrow-return-images'
  AND (SELECT private.current_app_user_id()) IS NOT NULL
  AND (storage.foldername(name))[1] = 'returns'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
  AND EXISTS (
    SELECT 1 FROM public.borrow_orders bo
    WHERE bo.id::TEXT = (storage.foldername(name))[3]
      AND bo.user_id = (SELECT private.current_app_user_id())
      AND bo.status = 'borrowed'
  )
);

DROP POLICY IF EXISTS "Return participants view return images" ON storage.objects;
CREATE POLICY "Return participants view return images"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'borrow-return-images'
  AND (
    (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    OR (
      (SELECT private.current_app_role()) IN ('admin', 'super_admin')
      AND EXISTS (
        SELECT 1 FROM public.borrow_orders bo
        WHERE bo.id::TEXT = (storage.foldername(name))[3]
          AND (
            (SELECT private.current_app_role()) = 'super_admin'
            OR bo.department_id = (SELECT private.current_app_department_id())
          )
      )
    )
  )
);

DROP POLICY IF EXISTS "Owners delete borrow return images" ON storage.objects;
CREATE POLICY "Owners delete borrow return images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'borrow-return-images'
  AND owner_id = (SELECT auth.uid())::TEXT
  AND (storage.foldername(name))[1] = 'returns'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
  AND NOT EXISTS (
    SELECT 1 FROM public.borrow_return_items WHERE photo_path = name
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
