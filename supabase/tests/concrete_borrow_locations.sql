-- Owner-run regression checks. Legacy unresolved snapshots are simulated only in fixtures.
BEGIN;
CREATE TEMP TABLE location_test_users(label TEXT PRIMARY KEY, auth_id UUID, app_id BIGINT, student_id TEXT);
CREATE TEMP TABLE location_test_state(label TEXT PRIMARY KEY, id BIGINT, item_id TEXT);
GRANT SELECT, INSERT, UPDATE ON location_test_users, location_test_state TO authenticated;
INSERT INTO location_test_users(label, auth_id, student_id)
SELECT label, pg_catalog.gen_random_uuid(), 'location-' || pg_catalog.gen_random_uuid()::TEXT
FROM (VALUES ('member'), ('admin'), ('super'), ('super2'), ('unready')) roles(label);
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT auth_id, student_id || '@location-test.invalid', jsonb_build_object('name', label) FROM location_test_users;
INSERT INTO public.departments(name) VALUES ('location-test-' || pg_catalog.gen_random_uuid()::TEXT);
UPDATE public.users u SET student_id = fixture.student_id, department_id = (SELECT max(id) FROM public.departments),
  is_active = TRUE, must_change_password = fixture.label = 'unready',
  role = CASE WHEN fixture.label LIKE 'super%' THEN 'super_admin'
    WHEN fixture.label = 'admin' THEN 'admin' ELSE 'member' END
FROM location_test_users fixture WHERE fixture.auth_id = u.auth_user_id;
UPDATE location_test_users fixture SET app_id = u.id FROM public.users u WHERE fixture.auth_id = u.auth_user_id;

CREATE FUNCTION pg_temp.location_actor(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT auth_id::TEXT FROM location_test_users WHERE label = p_label), true);
END;
$$;
CREATE FUNCTION pg_temp.location_assert(p_condition BOOLEAN, p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Location assertion: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.location_reject(p_sql TEXT, p_expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE did_fail BOOLEAN := FALSE;
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_expected IN SQLERRM) = 0 THEN RAISE EXCEPTION 'Unexpected rejection: %', SQLERRM; END IF;
    did_fail := TRUE;
  END;
  IF NOT did_fail THEN RAISE EXCEPTION 'Expected rejection: %', p_expected; END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.location_actor('super');
DO $$
DECLARE
  fixture RECORD;
  request_id BIGINT;
  item_id TEXT;
BEGIN
  FOR fixture IN SELECT * FROM (VALUES ('unresolved', 'PENDING_A'), ('moving', 'A1'), ('legacy', 'A1'),
    ('legacy_pending', 'A1'), ('cancel', 'A1')) items(label, location)
  LOOP
    PERFORM pg_temp.location_actor('super');
    INSERT INTO public.inventory_change_requests(request_type, proposed_name, proposed_location_code, requested_by)
    VALUES ('create', 'Location test ' || fixture.label, fixture.location,
      (SELECT app_id FROM location_test_users WHERE label = 'super')) RETURNING id INTO request_id;
    PERFORM pg_temp.location_actor('super2');
    item_id := public.review_inventory_change_request(request_id, TRUE);
    INSERT INTO location_test_state(label, item_id) VALUES (fixture.label, item_id);
  END LOOP;
END;
$$;
SELECT pg_temp.location_actor('member');
SELECT pg_temp.location_reject('SELECT public.create_borrow_order((SELECT item_id FROM location_test_state WHERE label = ''unresolved''), 1, ''test'', CURRENT_DATE + 1)',
  'official QR-supported location');
SELECT pg_temp.location_reject('SELECT public.create_borrow_order_batch((SELECT jsonb_agg(jsonb_build_object(''item_id'', item_id, ''quantity'', 1))
  FROM location_test_state WHERE label IN (''unresolved'', ''moving'')), ''test'', CURRENT_DATE + 1)', 'official QR-supported location');
SELECT pg_temp.location_assert((SELECT count(*) = 0 FROM public.borrow_orders WHERE user_id = (SELECT app_id FROM location_test_users WHERE label = 'member')),
  'Failed mixed batch leaves no partial order');
UPDATE location_test_state SET id = public.create_borrow_order(item_id, 1, 'test', CURRENT_DATE + 1)
WHERE label IN ('moving', 'legacy', 'legacy_pending', 'cancel');

SELECT pg_temp.location_actor('super');
SELECT public.update_inventory_item(item_id, 'Moving test', 'PENDING_B', '1') FROM location_test_state WHERE label = 'moving';
SELECT public.update_inventory_item(item_id, 'Cancellation test', 'PENDING_C', '1') FROM location_test_state WHERE label = 'cancel';
SELECT pg_temp.location_actor('admin');
SELECT pg_temp.location_reject('SELECT public.update_borrow_order_status((SELECT id FROM location_test_state WHERE label = ''moving''), ''borrowed'')',
  'official QR-supported location');
SELECT pg_temp.location_assert((SELECT status = 'pending' AND borrowed_at IS NULL FROM public.borrow_orders
  WHERE id = (SELECT id FROM location_test_state WHERE label = 'moving')), 'Approval failure preserves pending status');
SELECT public.update_borrow_order_status((SELECT id FROM location_test_state WHERE label = 'cancel'), 'cancelled');
SELECT pg_temp.location_actor('super');
SELECT public.update_inventory_item(item_id, 'Moving test', 'C3', '1') FROM location_test_state WHERE label = 'moving';
SELECT pg_temp.location_actor('admin');
SELECT public.update_borrow_order_status(id, 'borrowed') FROM location_test_state WHERE label IN ('moving', 'legacy');
SELECT pg_temp.location_assert((SELECT borrow_location_code = 'C3' FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = 'moving')), 'Approval refreshes location changed since application');
SELECT pg_temp.location_actor('member');
SELECT pg_temp.location_reject('SELECT public.submit_borrow_return_request((SELECT id FROM location_test_state WHERE label = ''moving''),
  (SELECT jsonb_agg(jsonb_build_object(''borrow_item_id'', id, ''returned_location_code'', ''A1'', ''scanned_qr_payload'', ''513-warehouse:A1'', ''item_condition'', ''good''))
  FROM public.borrow_items WHERE order_id = (SELECT id FROM location_test_state WHERE label = ''moving'')))', 'official QR code');

RESET ROLE;
UPDATE public.borrow_items SET borrow_location_code = 'PENDING_A' WHERE order_id IN (
  SELECT id FROM location_test_state WHERE label IN ('legacy', 'legacy_pending'));
UPDATE public.inventory_items SET location_code = 'PENDING_A' WHERE id IN (
  SELECT item_id FROM location_test_state WHERE label IN ('legacy', 'legacy_pending'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.location_actor('admin');
SELECT pg_temp.location_reject('SELECT public.update_borrow_order_status((SELECT id FROM location_test_state WHERE label = ''legacy_pending''), ''approved'')',
  'official QR-supported location');
SELECT pg_temp.location_reject('SELECT public.correct_unresolved_borrow_location((SELECT id FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = ''legacy'')), ''FLOOR'', ''verified'')', 'Only active super');
SELECT pg_temp.location_actor('super');
SELECT pg_temp.location_reject('SELECT public.correct_unresolved_borrow_location((SELECT id FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = ''legacy'')), ''PENDING_A'', ''verified'')', 'confirmed official');
SELECT pg_temp.location_reject('SELECT public.correct_unresolved_borrow_location((SELECT id FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = ''legacy'')), ''FLOOR'', ''  '')', 'reason is required');
SELECT pg_temp.location_reject('SELECT public.correct_unresolved_borrow_location((SELECT id FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = ''legacy_pending'')), ''A2'', ''verified'')', 'Only outstanding borrowed');
SELECT public.correct_unresolved_borrow_location((SELECT id FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = 'legacy')), 'floor', 'Shelf position confirmed by operator');
SELECT pg_temp.location_assert((SELECT borrow_location_code = 'FLOOR' FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = 'legacy')), 'Legacy snapshot corrected to confirmed location');
SELECT pg_temp.location_assert((SELECT location_code = 'FLOOR' FROM public.inventory_items
  WHERE id = (SELECT item_id FROM location_test_state WHERE label = 'legacy')), 'Legacy inventory and return snapshot agree');
SELECT pg_temp.location_assert((SELECT count(*) = 1 FROM public.operation_logs
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = 'legacy')
    AND details ->> 'source' = 'correct_unresolved_borrow_location'
    AND details ->> 'previous_borrow_location' = 'PENDING_A'
    AND details ->> 'confirmed_location' = 'FLOOR'
    AND details ->> 'reason' = 'Shelf position confirmed by operator'), 'Correction includes operator reason and previous location audit');
SELECT pg_temp.location_reject('SELECT public.correct_unresolved_borrow_location((SELECT id FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = ''legacy'')), ''A2'', ''verified'')', 'already has a confirmed');
SELECT public.update_inventory_item(item_id, 'Legacy pending test', 'B2', '1') FROM location_test_state WHERE label = 'legacy_pending';
SELECT pg_temp.location_actor('admin');
SELECT public.update_borrow_order_status((SELECT id FROM location_test_state WHERE label = 'legacy_pending'), 'approved');
SELECT pg_temp.location_assert((SELECT borrow_location_code = 'B2' FROM public.borrow_items
  WHERE order_id = (SELECT id FROM location_test_state WHERE label = 'legacy_pending')), 'Legacy pending order snapshots refresh after inventory confirmation');
SELECT pg_temp.location_actor('member');
WITH submitted AS (
  SELECT bo.id AS order_id, public.submit_borrow_return_request(bo.id,
    (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', bi.id, 'returned_location_code', bi.borrow_location_code,
      'scanned_qr_payload', '513-warehouse:' || bi.borrow_location_code, 'item_condition', 'good'))
     FROM public.borrow_items bi WHERE bi.order_id = bo.id)) AS return_id
  FROM public.borrow_orders bo WHERE bo.id IN (SELECT id FROM location_test_state WHERE label IN ('legacy', 'legacy_pending', 'moving'))
)
INSERT INTO location_test_state(label, id) SELECT 'return-' || order_id, return_id FROM submitted;
SELECT pg_temp.location_actor('admin');
SELECT public.review_borrow_return_request(id, TRUE) FROM location_test_state WHERE label LIKE 'return-%';
SELECT pg_temp.location_assert((SELECT count(*) = 3 FROM public.borrow_orders
  WHERE id IN (SELECT id FROM location_test_state WHERE label IN ('legacy', 'legacy_pending', 'moving')) AND status = 'returned'),
  'Moved and repaired orders return through matching official QR');

SELECT pg_temp.location_actor('unready');
SELECT pg_temp.location_assert((SELECT private.current_app_user_id()) IS NULL AND (SELECT private.current_app_role()) IS NULL,
  'First-password-change gate hides operational identity');
SELECT pg_temp.location_assert((SELECT count(*) = 0 FROM public.inventory_locations), 'Password gate denies inventory location reads');
SELECT pg_temp.location_reject('SELECT public.create_borrow_order((SELECT item_id FROM location_test_state WHERE label = ''moving''), 1, ''test'', CURRENT_DATE + 1)',
  'Authentication required');
SELECT pg_temp.location_reject('SELECT public.assign_borrow_return_delegate((SELECT id FROM location_test_state WHERE label = ''legacy''), NULL)',
  'Authentication required');
SELECT pg_temp.location_reject('SELECT public.submit_borrow_return_request((SELECT id FROM location_test_state WHERE label = ''legacy''), ''[]''::jsonb)',
  'Authentication required');
SELECT pg_temp.location_reject('SELECT public.correct_unresolved_borrow_location(1, ''A1'', ''test'')', 'Only active super');

RESET ROLE;
ROLLBACK;
