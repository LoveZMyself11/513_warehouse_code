-- Owner-run regression checks. Legacy unresolved snapshots are simulated only in fixtures.
BEGIN;
CREATE TEMP TABLE counted_test_users(label TEXT PRIMARY KEY, auth_id UUID, app_id BIGINT, student_id TEXT);
CREATE TEMP TABLE counted_test_state(label TEXT PRIMARY KEY, id BIGINT, item_id TEXT);
GRANT SELECT, INSERT, UPDATE ON counted_test_users, counted_test_state TO authenticated;
INSERT INTO counted_test_users(label, auth_id, student_id)
SELECT label, pg_catalog.gen_random_uuid(), 'counted-' || pg_catalog.gen_random_uuid()::TEXT
FROM (VALUES ('member'), ('member2'), ('admin'), ('super'), ('super2'), ('unready')) roles(label);
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT auth_id, student_id || '@counted-test.invalid', jsonb_build_object('name', label) FROM counted_test_users;
INSERT INTO public.departments(name) VALUES ('counted-test-' || pg_catalog.gen_random_uuid()::TEXT);
UPDATE public.users u SET student_id = fixture.student_id, department_id = (SELECT max(id) FROM public.departments),
  is_active = TRUE, must_change_password = fixture.label = 'unready',
  role = CASE WHEN fixture.label LIKE 'super%' THEN 'super_admin'
    WHEN fixture.label = 'admin' THEN 'admin' ELSE 'member' END
FROM counted_test_users fixture WHERE fixture.auth_id = u.auth_user_id;
UPDATE counted_test_users fixture SET app_id = u.id FROM public.users u WHERE fixture.auth_id = u.auth_user_id;

CREATE FUNCTION pg_temp.counted_actor(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT auth_id::TEXT FROM counted_test_users WHERE label = p_label), true);
END;
$$;
CREATE FUNCTION pg_temp.counted_assert(p_condition BOOLEAN, p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Counted inventory assertion: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.counted_reject(p_sql TEXT, p_expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
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

INSERT INTO public.inventory_items(id, name, location_code, quantity) VALUES
 ('ITEM9901', 'Counted water', 'A1', '100'), ('ITEM9902', 'Legacy stock', 'A1', '若干'),
 ('ITEM9903', 'Empty stock', 'A1', '0');
SELECT pg_temp.counted_assert(private.inventory_capacity('100') = 100, 'Integer quantity');
SELECT pg_temp.counted_assert(private.inventory_capacity('100瓶') IS NULL, 'Do not guess units');
SELECT pg_temp.counted_assert(private.inventory_capacity('9999999999') IS NULL, 'Overflow');
SELECT pg_temp.counted_assert(private.inventory_capacity('若干') IS NULL, 'Unknown quantity');

SET LOCAL ROLE authenticated;
SELECT pg_temp.counted_actor('member');
INSERT INTO counted_test_state(label, id) VALUES
 ('first', public.create_borrow_order('ITEM9901', 20, 'test', CURRENT_DATE + 1));
SELECT pg_temp.counted_actor('member2');
INSERT INTO counted_test_state(label, id) VALUES
 ('second', public.create_borrow_order('ITEM9901', 30, 'test', CURRENT_DATE + 1));
SELECT pg_temp.counted_assert((SELECT available_quantity = 50 AND reserved_quantity = 50
 FROM public.get_inventory_availability() WHERE item_id = 'ITEM9901'), 'Pending applications reserve only requested quantities across users');
SELECT pg_temp.counted_reject('SELECT public.create_borrow_order(''ITEM9901'', 51, ''test'', CURRENT_DATE + 1)', 'insufficient available quantity');
SELECT pg_temp.counted_reject('SELECT public.create_borrow_order(''ITEM9902'', 2, ''test'', CURRENT_DATE + 1)', 'insufficient available quantity');
SELECT pg_temp.counted_reject('SELECT public.create_borrow_order(''ITEM9903'', 1, ''test'', CURRENT_DATE + 1)', 'insufficient available quantity');
SELECT pg_temp.counted_reject('SELECT public.create_borrow_order_batch(''[{"item_id":"ITEM9902","quantity":1},{"item_id":"ITEM9901","quantity":51}]'', ''test'', CURRENT_DATE + 1)', 'insufficient available quantity');
SELECT pg_temp.counted_assert((SELECT available_quantity = 1 FROM public.get_inventory_availability() WHERE item_id = 'ITEM9902'), 'Failed batch rolls back whole reservation');

SELECT pg_temp.counted_actor('admin');
SELECT public.update_borrow_order_status(id, 'cancelled', 'counted test cancellation') FROM counted_test_state WHERE label = 'second';
SELECT public.update_borrow_order_status(id, 'borrowed') FROM counted_test_state WHERE label = 'first';
SELECT pg_temp.counted_assert((SELECT available_quantity = 80 AND reserved_quantity = 20
 FROM public.get_inventory_availability() WHERE item_id = 'ITEM9901'), 'Rejection releases stock; approval does not double reserve');
SELECT pg_temp.counted_actor('super');
SELECT pg_temp.counted_reject('SELECT public.update_inventory_item(''ITEM9901'', ''Counted water'', ''A1'', ''19'')', 'cannot be below reserved or borrowed');
SELECT pg_temp.counted_reject('SELECT public.update_inventory_item(''ITEM9901'', ''Counted water'', ''A1'', ''若干'')', 'cannot be below reserved or borrowed');

SELECT pg_temp.counted_actor('member');
INSERT INTO counted_test_state(label, id)
SELECT 'return', public.submit_borrow_return_request(
 (SELECT id FROM counted_test_state WHERE label = 'first'),
 (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', id, 'returned_location_code', 'A1',
  'scanned_qr_payload', '513-warehouse:A1', 'item_condition', 'good'))
  FROM public.borrow_items WHERE order_id = (SELECT id FROM counted_test_state WHERE label = 'first')));
SELECT pg_temp.counted_assert((SELECT available_quantity = 80 FROM public.get_inventory_availability() WHERE item_id = 'ITEM9901'), 'Unreviewed return does not release stock');
SELECT pg_temp.counted_actor('admin');
SELECT public.review_borrow_return_request(id, TRUE) FROM counted_test_state WHERE label = 'return';
SELECT pg_temp.counted_assert((SELECT available_quantity = 100 AND reserved_quantity = 0
 FROM public.get_inventory_availability() WHERE item_id = 'ITEM9901'), 'Confirmed return restores stock');
SELECT pg_temp.counted_actor('member2');
SELECT public.create_borrow_order('ITEM9901', 100, 'test', CURRENT_DATE + 1);
SELECT pg_temp.counted_assert((SELECT available_quantity = 0 FROM public.get_inventory_availability() WHERE item_id = 'ITEM9901'), 'Exact remaining stock allowed');
SELECT pg_temp.counted_reject('SELECT public.create_borrow_order(''ITEM9901'', 1, ''test'', CURRENT_DATE + 1)', 'insufficient available quantity');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.counted_reject('SELECT public.get_inventory_availability()', 'Authentication required');
ROLLBACK;
