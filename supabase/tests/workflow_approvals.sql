-- Run with a database owner. Fixtures and business records are rolled back.
BEGIN;

CREATE TEMP TABLE workflow_test_users (
  label TEXT PRIMARY KEY, auth_id UUID, app_id BIGINT, student_id TEXT, department_id BIGINT
);
CREATE TEMP TABLE workflow_test_state (label TEXT PRIMARY KEY, id BIGINT, item_id TEXT);
GRANT SELECT, INSERT, UPDATE ON workflow_test_users, workflow_test_state TO authenticated;

INSERT INTO public.departments(name) VALUES ('workflow-test-' || pg_catalog.gen_random_uuid()::TEXT);
INSERT INTO workflow_test_users(label, auth_id, student_id, department_id)
SELECT role_label, pg_catalog.gen_random_uuid(), 'test-' || pg_catalog.gen_random_uuid()::TEXT,
  (SELECT max(id) FROM public.departments)
FROM (VALUES ('member'), ('delegate'), ('outsider'), ('admin'), ('admin2'), ('super'), ('super2')) labels(role_label);
INSERT INTO public.departments(name) VALUES ('workflow-other-' || pg_catalog.gen_random_uuid()::TEXT);
INSERT INTO workflow_test_users(label, auth_id, student_id, department_id)
VALUES ('admin_other', pg_catalog.gen_random_uuid(), 'test-' || pg_catalog.gen_random_uuid()::TEXT,
  (SELECT max(id) FROM public.departments));
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT auth_id, student_id || '@workflow-test.invalid', pg_catalog.jsonb_build_object('name', label)
FROM workflow_test_users;
UPDATE public.users u SET student_id = fixture.student_id, name = fixture.label,
  department_id = fixture.department_id, is_active = TRUE,
  role = CASE WHEN fixture.label LIKE 'super%' THEN 'super_admin'
    WHEN fixture.label LIKE 'admin%' THEN 'admin' ELSE 'member' END
FROM workflow_test_users fixture WHERE fixture.auth_id = u.auth_user_id;
UPDATE workflow_test_users fixture SET app_id = u.id FROM public.users u WHERE fixture.auth_id = u.auth_user_id;

CREATE FUNCTION pg_temp.workflow_actor(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT auth_id::TEXT FROM workflow_test_users WHERE label = p_label), true);
END;
$$;
CREATE FUNCTION pg_temp.workflow_assert(p_condition BOOLEAN, p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Workflow assertion: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.workflow_reject(p_sql TEXT, p_expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  did_fail BOOLEAN := FALSE;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected IN SQLERRM) = 0 THEN RAISE EXCEPTION 'Unexpected rejection: %', SQLERRM; END IF;
    did_fail := TRUE;
  END;
  IF NOT did_fail THEN RAISE EXCEPTION 'Expected rejection: %', p_expected; END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.workflow_actor('member');
WITH request AS (
  INSERT INTO public.inventory_change_requests(request_type, proposed_name, proposed_location_code, requested_by)
  VALUES ('create', 'Workflow member item', 'A1', (SELECT app_id FROM workflow_test_users WHERE label = 'member'))
  RETURNING id
)
INSERT INTO workflow_test_state(label, id) SELECT 'member_request', id FROM request;

SELECT pg_temp.workflow_actor('super');
SELECT pg_temp.workflow_reject('SELECT public.create_inventory_item(''Direct RPC bypass'', ''A1'')',
  'permission denied');
SELECT pg_temp.workflow_reject('INSERT INTO public.inventory_items(id, name, location_code)
  VALUES (''ITEM9999'', ''Direct table bypass'', ''A1'')', 'permission denied');
WITH request AS (
  INSERT INTO public.inventory_change_requests(request_type, proposed_name, proposed_location_code, requested_by)
  VALUES ('create', 'Workflow super administrator item', 'B4', (SELECT app_id FROM workflow_test_users WHERE label = 'super'))
  RETURNING id
)
INSERT INTO workflow_test_state(label, id) SELECT 'super_request', id FROM request;
SELECT pg_temp.workflow_reject('SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = ''super_request''), TRUE)',
  'own request');
SELECT pg_temp.workflow_assert((SELECT status = 'pending' AND result_item_id IS NULL FROM public.inventory_change_requests
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'super_request')), 'Super request remains unpublished until independent approval');
SELECT pg_temp.workflow_actor('super2');
SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = 'super_request'), TRUE);
SELECT pg_temp.workflow_assert((SELECT r.status = 'approved' AND ii.name = 'Workflow super administrator item'
  FROM public.inventory_change_requests r JOIN public.inventory_items ii ON ii.id = r.result_item_id
  WHERE r.id = (SELECT id FROM workflow_test_state WHERE label = 'super_request')), 'Another super administrator approval publishes inventory');
SELECT pg_temp.workflow_actor('super');
SELECT pg_temp.workflow_assert((SELECT count(*) = 1 FROM public.inventory_change_requests
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_request')), 'Super sees member request immediately');
SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = 'member_request'), TRUE);
SELECT pg_temp.workflow_assert((SELECT status = 'pending' AND result_item_id IS NULL
  AND super_review_status = 'approved' AND department_review_status = 'pending'
  FROM public.inventory_change_requests WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_request')),
  'Super approval alone must not publish member item');
SELECT pg_temp.workflow_actor('admin_other');
SELECT pg_temp.workflow_reject('SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = ''member_request''), TRUE)',
  'Department admins can only review');
SELECT pg_temp.workflow_actor('admin');
SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = 'member_request'), TRUE);
UPDATE workflow_test_state SET item_id = (SELECT result_item_id FROM public.inventory_change_requests
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_request')) WHERE label = 'member_request';
SELECT pg_temp.workflow_assert((SELECT status = 'approved' AND department_review_status = 'approved'
  AND super_review_status = 'approved' FROM public.inventory_change_requests
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_request')), 'Both reviews publish member item');

WITH request AS (
  INSERT INTO public.inventory_change_requests(request_type, proposed_name, proposed_location_code, requested_by)
  VALUES ('create', 'Workflow administrator item', 'D4', (SELECT app_id FROM workflow_test_users WHERE label = 'admin'))
  RETURNING id
)
INSERT INTO workflow_test_state(label, id) SELECT 'admin_request', id FROM request;
SELECT pg_temp.workflow_reject('SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = ''admin_request''), TRUE)',
  'own request');
SELECT pg_temp.workflow_actor('admin2');
SELECT pg_temp.workflow_reject('SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = ''admin_request''), TRUE)',
  'Department admins can only review');
SELECT pg_temp.workflow_actor('super');
SELECT public.review_inventory_change_request((SELECT id FROM workflow_test_state WHERE label = 'admin_request'), TRUE);
UPDATE workflow_test_state SET item_id = (SELECT result_item_id FROM public.inventory_change_requests
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'admin_request')) WHERE label = 'admin_request';
SELECT pg_temp.workflow_actor('member');
SELECT pg_temp.workflow_reject('INSERT INTO public.inventory_change_requests(request_type, item_id, requested_by)
  SELECT ''delete'', item_id, (SELECT app_id FROM workflow_test_users WHERE label = ''member'')
  FROM workflow_test_state WHERE label = ''member_request''', 'Members can only request');

INSERT INTO workflow_test_state(label, id)
SELECT 'member_order', public.create_borrow_order_batch(pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'item_id', (SELECT item_id FROM workflow_test_state WHERE label = 'member_request'), 'quantity', 1)), 'workflow test', CURRENT_DATE + 1);
SELECT pg_temp.workflow_actor('admin');
SELECT public.update_borrow_order_status((SELECT id FROM workflow_test_state WHERE label = 'member_order'), 'approved');
SELECT pg_temp.workflow_assert((SELECT status = 'borrowed' AND borrowed_at IS NOT NULL FROM public.borrow_orders
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_order')), 'Approval immediately records borrowed state');

INSERT INTO workflow_test_state(label, id)
SELECT 'admin_order', public.create_borrow_order_batch(pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
  'item_id', (SELECT item_id FROM workflow_test_state WHERE label = 'admin_request'), 'quantity', 1)), 'workflow admin test', CURRENT_DATE + 1);
SELECT pg_temp.workflow_reject('SELECT public.update_borrow_order_status((SELECT id FROM workflow_test_state WHERE label = ''admin_order''), ''borrowed'')',
  'own borrow order');
SELECT pg_temp.workflow_actor('admin2');
SELECT pg_temp.workflow_reject('SELECT public.update_borrow_order_status((SELECT id FROM workflow_test_state WHERE label = ''admin_order''), ''borrowed'')',
  'Department admins can only review');
SELECT pg_temp.workflow_actor('super');
SELECT public.update_borrow_order_status((SELECT id FROM workflow_test_state WHERE label = 'admin_order'), 'borrowed');

SELECT pg_temp.workflow_actor('delegate');
SELECT pg_temp.workflow_assert((SELECT count(*) = 0 FROM public.borrow_orders
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_order')), 'Unassigned delegate cannot read order');
SELECT pg_temp.workflow_actor('member');
SELECT public.assign_borrow_return_delegate((SELECT id FROM workflow_test_state WHERE label = 'member_order'),
  (SELECT ' ' || upper(student_id) || ' ' FROM workflow_test_users WHERE label = 'delegate'));
SELECT pg_temp.workflow_actor('delegate');
SELECT pg_temp.workflow_assert((SELECT count(*) = 1 FROM public.borrow_orders
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_order')), 'Assigned delegate can read specific order');
SELECT pg_temp.workflow_assert((SELECT count(*) = 0 FROM public.borrow_orders
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'admin_order')), 'Delegate cannot read unrelated order');
SELECT pg_temp.workflow_reject('SELECT public.assign_borrow_return_delegate((SELECT id FROM workflow_test_state WHERE label = ''member_order''), NULL)',
  'Only the borrower');
SELECT pg_temp.workflow_reject('SELECT public.submit_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = ''member_order''),
  (SELECT jsonb_agg(jsonb_build_object(''borrow_item_id'', id, ''returned_location_code'', ''A1'', ''item_condition'', ''good''))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM workflow_test_state WHERE label = ''member_order'')))', 'official QR code');
SELECT pg_temp.workflow_reject('SELECT public.submit_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = ''member_order''),
  (SELECT jsonb_agg(jsonb_build_object(''borrow_item_id'', id, ''returned_location_code'', ''A1'', ''scanned_qr_payload'', ''513-warehouse:B1'', ''item_condition'', ''good''))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM workflow_test_state WHERE label = ''member_order'')))', 'official QR code');
INSERT INTO workflow_test_state(label, id)
SELECT 'delegated_return', public.submit_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = 'member_order'),
  (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', id, 'returned_location_code', borrow_location_code,
   'scanned_qr_payload', '513-warehouse:' || borrow_location_code, 'item_condition', 'good'))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM workflow_test_state WHERE label = 'member_order')));
SELECT pg_temp.workflow_assert((SELECT user_id = (SELECT app_id FROM workflow_test_users WHERE label = 'member')
  AND submitted_by = (SELECT app_id FROM workflow_test_users WHERE label = 'delegate')
  FROM public.borrow_return_requests WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'delegated_return')),
  'Delegation preserves borrower responsibility and records actual submitter');
SELECT pg_temp.workflow_actor('admin');
SELECT public.review_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = 'delegated_return'), TRUE);
SELECT pg_temp.workflow_assert((SELECT status = 'returned' FROM public.borrow_orders
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_order')), 'Return review completes order');
SELECT pg_temp.workflow_actor('delegate');
SELECT pg_temp.workflow_assert((SELECT count(*) = 0 FROM public.borrow_orders
  WHERE id = (SELECT id FROM workflow_test_state WHERE label = 'member_order')), 'Delegate access expires after completed return');

SELECT pg_temp.workflow_actor('admin');
INSERT INTO workflow_test_state(label, id)
SELECT 'admin_return', public.submit_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = 'admin_order'),
  (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', id, 'returned_location_code', borrow_location_code,
   'scanned_qr_payload', '513-warehouse:' || borrow_location_code, 'item_condition', 'good'))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM workflow_test_state WHERE label = 'admin_order')));
SELECT pg_temp.workflow_reject('SELECT public.review_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = ''admin_return''), TRUE)',
  'own return');
SELECT pg_temp.workflow_actor('super');
SELECT public.review_borrow_return_request((SELECT id FROM workflow_test_state WHERE label = 'admin_return'), TRUE);
SELECT pg_temp.workflow_assert((SELECT count(*) = 18 FROM public.inventory_locations
  WHERE (code ~ '^[A-D][1-4]$' OR code IN ('FLOOR', 'DOOR')) AND qr_payload = '513-warehouse:' || code), 'All 18 physical QR locations registered');

DO $$
DECLARE
  location RECORD;
  test_item TEXT;
  test_order BIGINT;
  test_borrow_item BIGINT;
  test_return BIGINT;
  test_inventory_request BIGINT;
BEGIN
  FOR location IN SELECT code FROM public.inventory_locations
    WHERE code ~ '^[A-D][1-4]$' OR code IN ('FLOOR', 'DOOR') ORDER BY code
  LOOP
    PERFORM pg_temp.workflow_actor('super');
    INSERT INTO public.inventory_change_requests(request_type, proposed_name, proposed_location_code, requested_by)
    VALUES ('create', 'QR workflow ' || location.code, location.code,
      (SELECT app_id FROM workflow_test_users WHERE label = 'super'))
    RETURNING id INTO test_inventory_request;
    PERFORM pg_temp.workflow_actor('super2');
    test_item := public.review_inventory_change_request(test_inventory_request, TRUE);
    PERFORM pg_temp.workflow_actor('member');
    test_order := public.create_borrow_order_batch(jsonb_build_array(jsonb_build_object('item_id', test_item, 'quantity', 1)),
      'QR workflow', CURRENT_DATE + 1);
    PERFORM pg_temp.workflow_actor('admin');
    PERFORM public.update_borrow_order_status(test_order, 'borrowed');
    PERFORM pg_temp.workflow_actor('member');
    SELECT id INTO test_borrow_item FROM public.borrow_items WHERE order_id = test_order;
    PERFORM pg_temp.workflow_reject(format('SELECT public.submit_borrow_return_request(%s, %L::jsonb)', test_order,
      jsonb_build_array(jsonb_build_object('borrow_item_id', test_borrow_item, 'returned_location_code', location.code,
        'scanned_qr_payload', location.code, 'item_condition', 'good'))::TEXT), 'official QR code');
    test_return := public.submit_borrow_return_request(test_order, jsonb_build_array(jsonb_build_object(
      'borrow_item_id', test_borrow_item, 'returned_location_code', location.code,
      'scanned_qr_payload', '513-warehouse:' || location.code, 'item_condition', 'good')));
    PERFORM pg_temp.workflow_actor('admin');
    PERFORM public.review_borrow_return_request(test_return, TRUE);
    PERFORM pg_temp.workflow_assert((SELECT status = 'returned' FROM public.borrow_orders WHERE id = test_order),
      'Official return QR accepted: ' || location.code);
  END LOOP;
END;
$$;

RESET ROLE;
ROLLBACK;
