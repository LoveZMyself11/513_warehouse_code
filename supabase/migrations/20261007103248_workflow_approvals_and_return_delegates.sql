BEGIN;

ALTER TABLE public.inventory_change_requests
  ADD COLUMN requested_role TEXT,
  ADD COLUMN requested_department_id BIGINT REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN department_review_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (department_review_status IN ('not_required', 'pending', 'approved', 'rejected')),
  ADD COLUMN department_reviewed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN department_reviewed_at TIMESTAMPTZ,
  ADD COLUMN department_review_note TEXT,
  ADD COLUMN super_review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (super_review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN super_reviewed_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN super_reviewed_at TIMESTAMPTZ,
  ADD COLUMN super_review_note TEXT;

UPDATE public.inventory_change_requests r
SET requested_role = u.role,
    requested_department_id = u.department_id,
    department_review_status = CASE
      WHEN r.status = 'pending' AND u.role = 'member' AND r.request_type = 'create' THEN 'pending'
      ELSE 'not_required'
    END,
    super_review_status = CASE WHEN r.status = 'pending' THEN 'pending' ELSE r.status END,
    super_reviewed_by = r.reviewed_by,
    super_reviewed_at = r.reviewed_at,
    super_review_note = r.review_note
FROM public.users u WHERE u.id = r.requested_by;

ALTER TABLE public.inventory_change_requests
  ALTER COLUMN requested_role SET NOT NULL,
  ADD CONSTRAINT inventory_request_role_check CHECK (requested_role IN ('member', 'admin', 'super_admin'));

CREATE OR REPLACE FUNCTION private.prepare_inventory_change_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.users WHERE id = NEW.requested_by;
  IF NOT FOUND OR NOT actor.is_active
    OR actor.id IS DISTINCT FROM (SELECT private.current_app_user_id()) THEN
    RAISE EXCEPTION 'Only active users can submit their own requests';
  END IF;
  IF actor.role = 'member' AND NEW.request_type <> 'create' THEN
    RAISE EXCEPTION 'Members can only request new inventory';
  END IF;
  IF actor.role = 'member' AND actor.department_id IS NULL THEN
    RAISE EXCEPTION 'A department is required for member inventory requests';
  END IF;
  NEW.requested_role := actor.role;
  NEW.requested_department_id := actor.department_id;
  NEW.department_review_status := CASE WHEN actor.role = 'member' THEN 'pending' ELSE 'not_required' END;
  NEW.super_review_status := 'pending';
  NEW.department_reviewed_by := NULL;
  NEW.department_reviewed_at := NULL;
  NEW.department_review_note := NULL;
  NEW.super_reviewed_by := NULL;
  NEW.super_reviewed_at := NULL;
  NEW.super_review_note := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prepare_inventory_change_request() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER inventory_change_request_prepare
BEFORE INSERT ON public.inventory_change_requests
FOR EACH ROW EXECUTE FUNCTION private.prepare_inventory_change_request();

DROP POLICY IF EXISTS "Staff view inventory change requests" ON public.inventory_change_requests;
DROP POLICY IF EXISTS "Users view own change requests and super admins view all" ON public.inventory_change_requests;
CREATE POLICY "Participants view inventory change requests"
ON public.inventory_change_requests FOR SELECT TO authenticated
USING (
  requested_by = (SELECT private.current_app_user_id())
  OR (SELECT private.current_app_role()) = 'super_admin'
  OR ((SELECT private.current_app_role()) = 'admin'
      AND requested_role = 'member'
      AND requested_department_id = (SELECT private.current_app_department_id()))
);

DROP POLICY IF EXISTS "Department admins submit inventory change requests" ON public.inventory_change_requests;
DROP POLICY IF EXISTS "Users submit own pending change requests" ON public.inventory_change_requests;
CREATE POLICY "Active users submit inventory change requests"
ON public.inventory_change_requests FOR INSERT TO authenticated
WITH CHECK (
  requested_by = (SELECT private.current_app_user_id())
  AND (SELECT private.current_app_role()) IN ('member', 'admin', 'super_admin')
  AND status = 'pending' AND result_item_id IS NULL
  AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL
  AND (request_type = 'create' OR requested_role IN ('admin', 'super_admin'))
);

DROP POLICY IF EXISTS "Department admins withdraw inventory change requests" ON public.inventory_change_requests;
DROP POLICY IF EXISTS "Users withdraw own pending change requests" ON public.inventory_change_requests;
CREATE POLICY "Users withdraw own unreviewed inventory requests"
ON public.inventory_change_requests FOR DELETE TO authenticated
USING (requested_by = (SELECT private.current_app_user_id()) AND status = 'pending'
  AND department_reviewed_by IS NULL AND super_reviewed_by IS NULL);

CREATE OR REPLACE FUNCTION public.review_inventory_change_request(
  p_request_id BIGINT, p_approve BOOLEAN, p_review_note TEXT DEFAULT NULL
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  request_row public.inventory_change_requests%ROWTYPE;
  actor_id BIGINT := (SELECT private.current_app_user_id());
  actor_role TEXT := (SELECT private.current_app_role());
  affected_item_id TEXT;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only active administrators can review inventory requests';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'A review decision is required'; END IF;
  SELECT * INTO request_row FROM public.inventory_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF request_row.requested_by = actor_id THEN RAISE EXCEPTION 'You cannot review your own request'; END IF;
  IF actor_role = 'admin' THEN
    IF request_row.requested_role <> 'member'
      OR request_row.requested_department_id IS DISTINCT FROM (SELECT private.current_app_department_id())
      OR request_row.department_review_status <> 'pending' THEN
      RAISE EXCEPTION 'Department admins can only review pending member requests in their department';
    END IF;
    UPDATE public.inventory_change_requests
    SET department_review_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        department_reviewed_by = actor_id, department_reviewed_at = pg_catalog.now(),
        department_review_note = NULLIF(pg_catalog.btrim(p_review_note), '')
    WHERE id = p_request_id RETURNING * INTO request_row;
  ELSE
    IF request_row.super_review_status <> 'pending' THEN RAISE EXCEPTION 'Super administrator review already completed'; END IF;
    UPDATE public.inventory_change_requests
    SET super_review_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        super_reviewed_by = actor_id, super_reviewed_at = pg_catalog.now(),
        super_review_note = NULLIF(pg_catalog.btrim(p_review_note), '')
    WHERE id = p_request_id RETURNING * INTO request_row;
  END IF;

  IF NOT p_approve THEN
    UPDATE public.inventory_change_requests SET status = 'rejected', reviewed_by = actor_id,
      reviewed_at = pg_catalog.now(), review_note = NULLIF(pg_catalog.btrim(p_review_note), '')
    WHERE id = p_request_id;
  ELSIF request_row.super_review_status = 'approved'
    AND request_row.department_review_status IN ('approved', 'not_required') THEN
    affected_item_id := request_row.item_id;
    IF request_row.request_type = 'create' THEN
      affected_item_id := (SELECT private.allocate_inventory_item_id());
      INSERT INTO public.inventory_items (
        id, name, location_code, specification, quantity, image_name, image_path, recognition_status
      ) VALUES (
        affected_item_id, pg_catalog.btrim(request_row.proposed_name), request_row.proposed_location_code,
        NULLIF(pg_catalog.btrim(request_row.proposed_specification), ''),
        COALESCE(NULLIF(pg_catalog.btrim(request_row.proposed_quantity), ''), '若干'),
        NULLIF(pg_catalog.btrim(request_row.proposed_image_name), ''),
        NULLIF(pg_catalog.btrim(request_row.proposed_image_path), ''),
        COALESCE(NULLIF(pg_catalog.btrim(request_row.proposed_recognition_status), ''), '人工录入')
      );
    ELSIF request_row.request_type = 'update' THEN
      UPDATE public.inventory_items
      SET name = COALESCE(NULLIF(pg_catalog.btrim(request_row.proposed_name), ''), name),
          location_code = COALESCE(request_row.proposed_location_code, location_code),
          specification = CASE WHEN request_row.proposed_specification IS NULL THEN specification
            ELSE NULLIF(pg_catalog.btrim(request_row.proposed_specification), '') END,
          quantity = COALESCE(NULLIF(pg_catalog.btrim(request_row.proposed_quantity), ''), quantity),
          image_name = CASE WHEN request_row.proposed_image_name IS NULL THEN image_name
            ELSE NULLIF(pg_catalog.btrim(request_row.proposed_image_name), '') END,
          image_path = CASE WHEN request_row.proposed_image_path IS NULL THEN image_path
            ELSE NULLIF(pg_catalog.btrim(request_row.proposed_image_path), '') END,
          recognition_status = COALESCE(NULLIF(pg_catalog.btrim(request_row.proposed_recognition_status), ''), recognition_status)
      WHERE id = affected_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Target inventory item not found'; END IF;
    ELSE
      DELETE FROM public.inventory_items WHERE id = affected_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Target inventory item not found'; END IF;
    END IF;
    UPDATE public.inventory_change_requests SET status = 'approved', result_item_id = affected_item_id,
      reviewed_by = actor_id, reviewed_at = pg_catalog.now(),
      review_note = NULLIF(pg_catalog.btrim(p_review_note), '') WHERE id = p_request_id;
    INSERT INTO public.operation_logs (user_id, item_id, action, details)
    VALUES (actor_id, CASE WHEN request_row.request_type = 'delete' THEN NULL ELSE affected_item_id END,
      request_row.request_type, pg_catalog.jsonb_build_object('source', 'approved_request',
      'request_id', p_request_id, 'department_reviewed_by', request_row.department_reviewed_by,
      'super_reviewed_by', request_row.super_reviewed_by, 'item_id', affected_item_id));
  END IF;
  INSERT INTO public.operation_logs (user_id, action, details)
  VALUES (actor_id, 'update', pg_catalog.jsonb_build_object('source', 'inventory_request_review',
    'request_id', p_request_id, 'review_role', actor_role, 'approved', p_approve));
  RETURN affected_item_id;
END;
$$;
REVOKE ALL ON FUNCTION public.review_inventory_change_request(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_inventory_change_request(BIGINT, BOOLEAN, TEXT) TO authenticated;

ALTER TABLE public.borrow_orders
  ADD COLUMN borrower_role TEXT,
  ADD COLUMN return_delegate_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN return_delegate_name TEXT,
  ADD COLUMN return_delegate_student_id TEXT,
  ADD COLUMN return_delegate_assigned_at TIMESTAMPTZ;
UPDATE public.borrow_orders bo SET borrower_role = u.role FROM public.users u WHERE u.id = bo.user_id;
ALTER TABLE public.borrow_orders ALTER COLUMN borrower_role SET NOT NULL,
  ADD CONSTRAINT borrow_orders_borrower_role_check CHECK (borrower_role IN ('member', 'admin', 'super_admin'));
CREATE INDEX borrow_orders_return_delegate_idx ON public.borrow_orders(return_delegate_id, status)
  WHERE return_delegate_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.capture_borrower_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT role INTO NEW.borrower_role FROM public.users WHERE id = NEW.user_id AND is_active;
  IF NEW.borrower_role IS NULL THEN RAISE EXCEPTION 'Borrower must have an active account'; END IF;
  NEW.return_delegate_id := NULL;
  NEW.return_delegate_name := NULL;
  NEW.return_delegate_student_id := NULL;
  NEW.return_delegate_assigned_at := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_borrower_role() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER borrow_orders_capture_role BEFORE INSERT ON public.borrow_orders
FOR EACH ROW EXECUTE FUNCTION private.capture_borrower_role();

-- Status and delegation writes go through the authenticated RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.borrow_orders FROM authenticated;

CREATE OR REPLACE FUNCTION public.update_borrow_order_status(
  p_order_id BIGINT, p_status TEXT, p_notes TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.borrow_orders%ROWTYPE;
  actor_id BIGINT := (SELECT private.current_app_user_id());
  actor_role TEXT := (SELECT private.current_app_role());
  effective_status TEXT;
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

CREATE OR REPLACE FUNCTION public.assign_borrow_return_delegate(
  p_order_id BIGINT, p_delegate_student_id TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id BIGINT := (SELECT private.current_app_user_id());
  target public.borrow_orders%ROWTYPE;
  delegate public.users%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = p_order_id AND user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the borrower may assign a return delegate'; END IF;
  IF target.status <> 'borrowed' THEN RAISE EXCEPTION 'Only borrowed orders can be delegated'; END IF;
  IF NULLIF(pg_catalog.btrim(p_delegate_student_id), '') IS NOT NULL THEN
    SELECT * INTO delegate FROM public.users
    WHERE student_id = pg_catalog.lower(pg_catalog.btrim(p_delegate_student_id)) AND is_active AND auth_user_id IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Delegate student account is not active or does not exist'; END IF;
    IF delegate.id = actor_id THEN RAISE EXCEPTION 'Choose another account as delegate'; END IF;
  END IF;
  UPDATE public.borrow_orders SET return_delegate_id = delegate.id,
    return_delegate_name = delegate.name, return_delegate_student_id = delegate.student_id,
    return_delegate_assigned_at = CASE WHEN delegate.id IS NULL THEN NULL ELSE pg_catalog.now() END,
    updated_at = pg_catalog.now() WHERE id = p_order_id;
  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'update', pg_catalog.jsonb_build_object(
    'source', 'assign_return_delegate', 'delegate_user_id', delegate.id,
    'responsible_user_id', target.user_id));
END;
$$;
REVOKE ALL ON FUNCTION public.assign_borrow_return_delegate(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_borrow_return_delegate(BIGINT, TEXT) TO authenticated;

ALTER TABLE public.borrow_return_requests
  ADD COLUMN submitted_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL;
UPDATE public.borrow_return_requests SET submitted_by = user_id;
ALTER TABLE public.borrow_return_items
  ADD COLUMN scanned_qr_payload TEXT,
  ADD COLUMN scanned_at TIMESTAMPTZ;

UPDATE public.inventory_locations SET qr_payload = '513-warehouse:' || code
WHERE code ~ '^[A-D][1-4]$' OR code IN ('FLOOR', 'DOOR');

DROP POLICY IF EXISTS "Users view own orders and staff view all" ON public.borrow_orders;
CREATE POLICY "Borrow participants and staff view orders" ON public.borrow_orders FOR SELECT TO authenticated
USING (user_id = (SELECT private.current_app_user_id())
  OR (return_delegate_id = (SELECT private.current_app_user_id()) AND status IN ('borrowed', 'return_requested'))
  OR (SELECT private.current_app_role()) = 'super_admin'
  OR ((SELECT private.current_app_role()) = 'admin' AND department_id = (SELECT private.current_app_department_id())));

DROP POLICY IF EXISTS "Users view own order items and staff view all" ON public.borrow_items;
CREATE POLICY "Borrow participants and staff view order items" ON public.borrow_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.borrow_orders bo WHERE bo.id = order_id));

DROP POLICY IF EXISTS "Users view own return requests and staff view department" ON public.borrow_return_requests;
CREATE POLICY "Return participants and staff view requests" ON public.borrow_return_requests FOR SELECT TO authenticated
USING (user_id = (SELECT private.current_app_user_id()) OR submitted_by = (SELECT private.current_app_user_id())
  OR EXISTS (SELECT 1 FROM public.borrow_orders bo WHERE bo.id = order_id));

DROP POLICY IF EXISTS "Users view own return items and staff view department" ON public.borrow_return_items;
CREATE POLICY "Return participants and staff view items" ON public.borrow_return_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.borrow_return_requests rr WHERE rr.id = return_request_id));

CREATE OR REPLACE FUNCTION public.submit_borrow_return_request(
  p_order_id BIGINT, p_items JSONB, p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id BIGINT := (SELECT private.current_app_user_id());
  actor_auth_id UUID := (SELECT auth.uid());
  target public.borrow_orders%ROWTYPE;
  request_id BIGINT;
  expected_count INTEGER;
  submitted_count INTEGER;
  submitted_item RECORD;
  submission_time TIMESTAMPTZ := pg_catalog.now();
BEGIN
  IF actor_id IS NULL OR actor_auth_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR (target.user_id <> actor_id AND target.return_delegate_id IS DISTINCT FROM actor_id) THEN
    RAISE EXCEPTION 'Only the borrower or assigned delegate can submit a return';
  END IF;
  IF target.status <> 'borrowed' THEN RAISE EXCEPTION 'Only borrowed orders can be returned'; END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Return items must be a JSON array'; END IF;
  IF EXISTS (SELECT 1 FROM public.borrow_return_requests WHERE order_id = p_order_id AND status = 'pending') THEN
    RAISE EXCEPTION 'A return request is already pending';
  END IF;
  SELECT count(*) INTO expected_count FROM public.borrow_items
  WHERE order_id = p_order_id AND quantity_returned < quantity_borrowed;
  submitted_count := pg_catalog.jsonb_array_length(p_items);
  IF expected_count < 1 OR submitted_count <> expected_count THEN RAISE EXCEPTION 'Every outstanding item must be returned'; END IF;
  IF EXISTS (SELECT borrow_item_id FROM pg_catalog.jsonb_to_recordset(p_items)
    AS r(borrow_item_id BIGINT) GROUP BY borrow_item_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate return items are not allowed';
  END IF;
  INSERT INTO public.borrow_return_requests(order_id, user_id, submitted_by, status, submitted_at, notes)
  VALUES (p_order_id, target.user_id, actor_id, 'pending', submission_time, NULLIF(pg_catalog.btrim(p_notes), ''))
  RETURNING id INTO request_id;

  FOR submitted_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS r(
    borrow_item_id BIGINT, returned_location_code TEXT, scanned_qr_payload TEXT,
    photo_path TEXT, item_condition TEXT, notes TEXT)
  LOOP
    IF submitted_item.photo_path IS NOT NULL AND (
      submitted_item.photo_path NOT LIKE 'returns/' || actor_auth_id::TEXT || '/' || p_order_id::TEXT || '/%'
      OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'borrow-return-images'
        AND name = submitted_item.photo_path AND owner_id = actor_auth_id::TEXT)) THEN
      RAISE EXCEPTION 'Return photo path is invalid';
    END IF;
    INSERT INTO public.borrow_return_items(return_request_id, borrow_item_id, item_id, original_location_code,
      returned_location_code, scanned_qr_payload, scanned_at, photo_path, item_condition, notes)
    SELECT request_id, bi.id, bi.item_id, bi.borrow_location_code, bi.borrow_location_code,
      submitted_item.scanned_qr_payload, submission_time, submitted_item.photo_path,
      submitted_item.item_condition, NULLIF(pg_catalog.btrim(submitted_item.notes), '')
    FROM public.borrow_items bi JOIN public.inventory_locations loc ON loc.code = bi.borrow_location_code
    WHERE bi.id = submitted_item.borrow_item_id AND bi.order_id = p_order_id
      AND bi.quantity_returned < bi.quantity_borrowed
      AND submitted_item.returned_location_code = bi.borrow_location_code
      AND (loc.code ~ '^[A-D][1-4]$' OR loc.code IN ('FLOOR', 'DOOR'))
      AND NOT loc.is_pending_level
      AND submitted_item.scanned_qr_payload = loc.qr_payload
      AND submitted_item.scanned_qr_payload = '513-warehouse:' || bi.borrow_location_code
      AND submitted_item.item_condition IN ('good', 'damaged', 'lost');
    IF NOT FOUND THEN RAISE EXCEPTION 'Scan the official QR code for the original item location'; END IF;
  END LOOP;
  UPDATE public.borrow_orders SET status = 'return_requested', return_submitted_at = submission_time,
    updated_at = submission_time WHERE id = p_order_id;
  INSERT INTO public.operation_logs(user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'return', pg_catalog.jsonb_build_object('source', 'borrow_return_request',
    'responsible_user_id', target.user_id, 'submitted_by', actor_id, 'return_request_id', request_id,
    'delegated', actor_id <> target.user_id, 'submitted_at', submission_time));
  RETURN request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_borrow_return_request(BIGINT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_borrow_return_request(BIGINT, JSONB, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_borrow_return_request(
  p_return_request_id BIGINT, p_approve BOOLEAN, p_review_note TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id BIGINT := (SELECT private.current_app_user_id());
  actor_role TEXT := (SELECT private.current_app_role());
  request_row public.borrow_return_requests%ROWTYPE;
  target public.borrow_orders%ROWTYPE;
  return_item RECORD;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('admin', 'super_admin') THEN RAISE EXCEPTION 'Only active administrators can review returns'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'A review decision is required'; END IF;
  SELECT * INTO request_row FROM public.borrow_return_requests WHERE id = p_return_request_id FOR UPDATE;
  IF NOT FOUND OR request_row.status <> 'pending' THEN RAISE EXCEPTION 'Return request is not pending'; END IF;
  SELECT * INTO target FROM public.borrow_orders WHERE id = request_row.order_id FOR UPDATE;
  IF target.status <> 'return_requested' THEN RAISE EXCEPTION 'Borrow order is not awaiting return review'; END IF;
  IF actor_id = target.user_id OR actor_id = request_row.submitted_by THEN RAISE EXCEPTION 'You cannot review your own return'; END IF;
  IF actor_role = 'admin' AND (target.borrower_role <> 'member'
    OR target.department_id IS DISTINCT FROM (SELECT private.current_app_department_id())) THEN
    RAISE EXCEPTION 'Department admins can only review member returns in their department';
  END IF;
  IF p_approve THEN
    IF NOT EXISTS (SELECT 1 FROM public.borrow_return_items WHERE return_request_id = request_row.id) THEN RAISE EXCEPTION 'Return request has no items'; END IF;
    FOR return_item IN SELECT rri.* FROM public.borrow_return_items rri
      JOIN public.borrow_items bi ON bi.id = rri.borrow_item_id
      WHERE rri.return_request_id = request_row.id ORDER BY rri.borrow_item_id FOR UPDATE OF bi
    LOOP
      IF return_item.item_condition = 'lost' THEN RAISE EXCEPTION 'Lost items cannot be confirmed returned'; END IF;
      UPDATE public.inventory_items SET location_code = return_item.original_location_code,
        updated_at = pg_catalog.now() WHERE id = return_item.item_id;
      UPDATE public.borrow_items SET quantity_returned = quantity_borrowed,
        item_condition = return_item.item_condition, notes = COALESCE(return_item.notes, notes),
        updated_at = pg_catalog.now() WHERE id = return_item.borrow_item_id;
    END LOOP;
    UPDATE public.borrow_orders SET status = 'returned', actual_return_date = pg_catalog.now(),
      updated_at = pg_catalog.now() WHERE id = target.id;
  ELSE
    UPDATE public.borrow_orders SET status = 'borrowed', return_submitted_at = NULL,
      updated_at = pg_catalog.now() WHERE id = target.id;
  END IF;
  UPDATE public.borrow_return_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_by = actor_id, reviewed_at = pg_catalog.now(), review_note = NULLIF(pg_catalog.btrim(p_review_note), ''),
    updated_at = pg_catalog.now() WHERE id = request_row.id;
  INSERT INTO public.operation_logs(user_id, order_id, action, details)
  VALUES (actor_id, target.id, 'return', pg_catalog.jsonb_build_object('source', 'staff_return_review',
    'status', CASE WHEN p_approve THEN 'returned' ELSE 'rejected' END, 'return_request_id', request_row.id,
    'responsible_user_id', target.user_id, 'submitted_by', request_row.submitted_by,
    'reviewed_at', pg_catalog.now()));
END;
$$;
REVOKE ALL ON FUNCTION public.review_borrow_return_request(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_borrow_return_request(BIGINT, BOOLEAN, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Active users upload borrow return images" ON storage.objects;
CREATE POLICY "Return participants upload images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'borrow-return-images' AND (SELECT private.current_app_user_id()) IS NOT NULL
  AND (storage.foldername(name))[1] = 'returns'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
  AND EXISTS (SELECT 1 FROM public.borrow_orders bo WHERE bo.id::TEXT = (storage.foldername(name))[3]
    AND bo.status = 'borrowed' AND (bo.user_id = (SELECT private.current_app_user_id())
      OR bo.return_delegate_id = (SELECT private.current_app_user_id()))));

DROP POLICY IF EXISTS "Return participants view return images" ON storage.objects;
CREATE POLICY "Return participants view return images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'borrow-return-images' AND (SELECT private.current_app_user_id()) IS NOT NULL
  AND (storage.foldername(name))[1] = 'returns'
  AND ((storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
    OR EXISTS (SELECT 1 FROM public.borrow_orders bo WHERE bo.id::TEXT = (storage.foldername(name))[3])));

NOTIFY pgrst, 'reload schema';
COMMIT;
