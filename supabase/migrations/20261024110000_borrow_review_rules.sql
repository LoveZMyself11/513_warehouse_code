BEGIN;

-- 1. A lone active super admin may accept their own return request: with no other
-- reviewer available, an unreviewed return would reserve stock forever. Any other
-- self-review stays rejected.
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
  IF actor_id = target.user_id OR actor_id = request_row.submitted_by THEN
    IF NOT (actor_role = 'super_admin' AND actor_id = target.user_id
        AND (SELECT count(*) FROM public.users WHERE role = 'super_admin' AND is_active) <= 1) THEN
      RAISE EXCEPTION 'You cannot review your own return';
    END IF;
  END IF;
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
    'self_reviewed_lone_super_admin', actor_id = target.user_id,
    'reviewed_at', pg_catalog.now()));
END;
$$;
REVOKE ALL ON FUNCTION public.review_borrow_return_request(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_borrow_return_request(BIGINT, BOOLEAN, TEXT) TO authenticated;

-- 2. Rejecting a borrow order requires a reason; the borrower sees it on the order.
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
  rejection_reason TEXT := NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), '');
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'Only active administrators can update order status';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'borrowed', 'cancelled') THEN
    RAISE EXCEPTION 'Returns require a return request and review';
  END IF;
  IF p_status = 'cancelled' AND rejection_reason IS NULL THEN
    RAISE EXCEPTION 'A rejection reason is required';
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
    notes = CASE WHEN p_notes IS NULL THEN notes ELSE rejection_reason END,
    updated_at = pg_catalog.now() WHERE id = p_order_id;
  INSERT INTO public.operation_logs (user_id, order_id, action, details)
  VALUES (actor_id, p_order_id, 'update', pg_catalog.jsonb_build_object(
    'source', actor_role, 'status', effective_status, 'changed_at', pg_catalog.now()));
END;
$$;
REVOKE ALL ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_borrow_order_status(BIGINT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
