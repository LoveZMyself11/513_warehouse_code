-- Owner-run regression checks for the role-based borrow approval matrix.
-- 超级管理员提交即借出；普通用户/部门管理员沿用审批链；归还流程三身份一致。
BEGIN;
CREATE TEMP TABLE instant_test_users(label TEXT PRIMARY KEY, auth_id UUID, app_id BIGINT, student_id TEXT, department_id BIGINT);
CREATE TEMP TABLE instant_test_state(label TEXT PRIMARY KEY, id BIGINT, item_id TEXT);
GRANT SELECT, INSERT, UPDATE ON instant_test_users, instant_test_state TO authenticated;
INSERT INTO public.departments(name) VALUES ('instant-test-' || pg_catalog.gen_random_uuid()::TEXT);
INSERT INTO instant_test_users(label, auth_id, student_id, department_id)
SELECT role_label, pg_catalog.gen_random_uuid(), 'instant-' || pg_catalog.gen_random_uuid()::TEXT,
  (SELECT max(id) FROM public.departments)
FROM (VALUES ('member'), ('member2'), ('admin'), ('super'), ('super2')) labels(role_label);
INSERT INTO public.departments(name) VALUES ('instant-other-' || pg_catalog.gen_random_uuid()::TEXT);
INSERT INTO instant_test_users(label, auth_id, student_id, department_id)
VALUES ('admin_other', pg_catalog.gen_random_uuid(), 'instant-' || pg_catalog.gen_random_uuid()::TEXT,
  (SELECT max(id) FROM public.departments));
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT auth_id, student_id || '@instant-test.invalid', pg_catalog.jsonb_build_object('name', label)
FROM instant_test_users;
UPDATE public.users u SET student_id = fixture.student_id, name = fixture.label,
  department_id = fixture.department_id, is_active = TRUE,
  role = CASE WHEN fixture.label LIKE 'super%' THEN 'super_admin'
    WHEN fixture.label LIKE 'admin%' THEN 'admin' ELSE 'member' END
FROM instant_test_users fixture WHERE fixture.auth_id = u.auth_user_id;
UPDATE instant_test_users fixture SET app_id = u.id FROM public.users u WHERE fixture.auth_id = u.auth_user_id;

CREATE FUNCTION pg_temp.instant_actor(p_label TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', (SELECT auth_id::TEXT FROM instant_test_users WHERE label = p_label), true);
END;
$$;
CREATE FUNCTION pg_temp.instant_assert(p_condition BOOLEAN, p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Instant borrow assertion: %', p_message; END IF;
END;
$$;
CREATE FUNCTION pg_temp.instant_reject(p_sql TEXT, p_expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
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

-- Fixture item with countable capacity 10 at a scannable location, created via the
-- standard super-admin change-request flow (another super admin reviews).
SET LOCAL ROLE authenticated;
SELECT pg_temp.instant_actor('super');
WITH request AS (
  INSERT INTO public.inventory_change_requests(request_type, proposed_name, proposed_location_code, proposed_quantity, requested_by)
  VALUES ('create', 'Instant borrow test item', 'A1', '10', (SELECT app_id FROM instant_test_users WHERE label = 'super'))
  RETURNING id
)
INSERT INTO instant_test_state(label, id) SELECT 'super_request', id FROM request;
SELECT pg_temp.instant_actor('super2');
INSERT INTO instant_test_state(label, item_id)
SELECT 'test_item', public.review_inventory_change_request(
  (SELECT id FROM instant_test_state WHERE label = 'super_request'), TRUE);

SELECT pg_temp.instant_assert((SELECT count(*) = 1 FROM public.inventory_items
  WHERE id = (SELECT item_id FROM instant_test_state WHERE label = 'test_item')
    AND quantity = '10' AND location_code = 'A1'), 'Fixture item ready');

-- 1. Super admin submission is recorded directly as borrowed.
SELECT pg_temp.instant_actor('super');
INSERT INTO instant_test_state(label, id)
SELECT 'super_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE item_id IS NOT NULL), 'quantity', 2)),
  'instant super borrow', CURRENT_DATE + 1);
SELECT pg_temp.instant_assert((SELECT status = 'borrowed' AND borrowed_at IS NOT NULL
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'super_order')),
  'Super admin order skips review');
SELECT pg_temp.instant_assert((SELECT borrow_location_code = 'A1' FROM public.borrow_items
  WHERE order_id = (SELECT id FROM instant_test_state WHERE label = 'super_order')),
  'Instant borrow records the borrow location');
SELECT pg_temp.instant_assert((SELECT count(*) = 1 FROM public.operation_logs
  WHERE order_id = (SELECT id FROM instant_test_state WHERE label = 'super_order')
    AND details ->> 'auto_borrowed' = 'true'), 'Instant borrow is audit marked');
SELECT pg_temp.instant_assert((SELECT available_quantity = 8 FROM public.get_inventory_availability()
  WHERE item_id = (SELECT item_id FROM instant_test_state WHERE item_id IS NOT NULL)),
  'Instant borrow reserves availability immediately');

-- 2. Instant borrows obey the same quantity guard.
SELECT pg_temp.instant_reject('SELECT public.create_borrow_order_batch(pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object(''item_id'', (SELECT item_id FROM instant_test_state WHERE item_id IS NOT NULL), ''quantity'', 9)),
  ''too much'', CURRENT_DATE + 1)', 'insufficient available quantity');

-- 3. Member order: department admin approval suffices; other-department admins rejected.
SELECT pg_temp.instant_actor('member');
INSERT INTO instant_test_state(label, id)
SELECT 'member_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE item_id IS NOT NULL), 'quantity', 1)),
  'member borrow', CURRENT_DATE + 1);
SELECT pg_temp.instant_assert((SELECT status = 'pending' FROM public.borrow_orders
  WHERE id = (SELECT id FROM instant_test_state WHERE label = 'member_order')),
  'Member order stays pending');
-- Members are never reviewers; the administrator gate fires before any self-review check.
SELECT pg_temp.instant_reject('SELECT public.update_borrow_order_status(
  (SELECT id FROM instant_test_state WHERE label = ''member_order''), ''approved'')',
  'Only active administrators can update order status');
SELECT pg_temp.instant_actor('admin_other');
SELECT pg_temp.instant_reject('SELECT public.update_borrow_order_status(
  (SELECT id FROM instant_test_state WHERE label = ''member_order''), ''approved'')',
  'Department admins can only review');
SELECT pg_temp.instant_actor('admin');
SELECT public.update_borrow_order_status((SELECT id FROM instant_test_state WHERE label = 'member_order'), 'approved');
SELECT pg_temp.instant_assert((SELECT status = 'borrowed' AND borrowed_at IS NOT NULL
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'member_order')),
  'Department admin approval borrows the member order');

-- 4. Admin order: only a super admin can approve it.
SELECT pg_temp.instant_actor('admin');
INSERT INTO instant_test_state(label, id)
SELECT 'admin_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE item_id IS NOT NULL), 'quantity', 1)),
  'admin borrow', CURRENT_DATE + 1);
SELECT pg_temp.instant_reject('SELECT public.update_borrow_order_status(
  (SELECT id FROM instant_test_state WHERE label = ''admin_order''), ''approved'')', 'own borrow order');
SELECT pg_temp.instant_actor('admin_other');
SELECT pg_temp.instant_reject('SELECT public.update_borrow_order_status(
  (SELECT id FROM instant_test_state WHERE label = ''admin_order''), ''approved'')',
  'Department admins can only review');
SELECT pg_temp.instant_actor('super');
SELECT public.update_borrow_order_status((SELECT id FROM instant_test_state WHERE label = 'admin_order'), 'approved');
SELECT pg_temp.instant_assert((SELECT status = 'borrowed'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'admin_order')),
  'Super admin borrows the admin order');

-- 5. Super admins keep oversight: they can still approve member orders directly.
SELECT pg_temp.instant_actor('member2');
INSERT INTO instant_test_state(label, id)
SELECT 'member2_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE item_id IS NOT NULL), 'quantity', 1)),
  'member2 borrow', CURRENT_DATE + 1);
SELECT pg_temp.instant_actor('super');
SELECT public.update_borrow_order_status((SELECT id FROM instant_test_state WHERE label = 'member2_order'), 'approved');
SELECT pg_temp.instant_assert((SELECT status = 'borrowed'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'member2_order')),
  'Super admin can still approve member orders');

-- 6. Returns are identical for every role: the super admin's own return needs another reviewer.
SELECT pg_temp.instant_actor('super');
INSERT INTO instant_test_state(label, id)
SELECT 'super_return', public.submit_borrow_return_request(
  (SELECT id FROM instant_test_state WHERE label = 'super_order'),
  (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', id, 'returned_location_code', borrow_location_code,
    'scanned_qr_payload', '513-warehouse:' || borrow_location_code, 'item_condition', 'good'))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM instant_test_state WHERE label = 'super_order')));
SELECT pg_temp.instant_assert((SELECT status = 'return_requested' FROM public.borrow_orders
  WHERE id = (SELECT id FROM instant_test_state WHERE label = 'super_order')),
  'Super admin return enters the shared review flow');
SELECT pg_temp.instant_actor('super');
SELECT pg_temp.instant_reject('SELECT public.review_borrow_return_request(
  (SELECT id FROM instant_test_state WHERE label = ''super_return''), TRUE)', 'own return');
SELECT pg_temp.instant_actor('admin');
SELECT pg_temp.instant_reject('SELECT public.review_borrow_return_request(
  (SELECT id FROM instant_test_state WHERE label = ''super_return''), TRUE)',
  'Department admins can only review member returns');
SELECT pg_temp.instant_actor('super2');
SELECT public.review_borrow_return_request((SELECT id FROM instant_test_state WHERE label = 'super_return'), TRUE);
SELECT pg_temp.instant_assert((SELECT status = 'returned'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'super_order')),
  'Another super admin completes the return review');

-- 7. Rejecting a borrow order requires a reason that lands on the order.
SELECT pg_temp.instant_actor('member');
INSERT INTO instant_test_state(label, id)
SELECT 'member_order2', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE label = 'test_item'), 'quantity', 1)),
  'reject reason test', CURRENT_DATE + 1);
SELECT pg_temp.instant_actor('admin');
SELECT pg_temp.instant_reject('SELECT public.update_borrow_order_status(
  (SELECT id FROM instant_test_state WHERE label = ''member_order2''), ''cancelled'')',
  'A rejection reason is required');
SELECT public.update_borrow_order_status((SELECT id FROM instant_test_state WHERE label = 'member_order2'),
  'cancelled', '数量不足，暂不外借');
SELECT pg_temp.instant_assert((SELECT status = 'cancelled' AND notes = '数量不足，暂不外借'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'member_order2')),
  'Rejection reason is stored on the order');

-- 8. Activities can opt out of approval: linked orders borrow instantly for every role.
-- The flag is super-admin-gated at the table level, so the fixture is created by super.
SELECT pg_temp.instant_actor('super');
WITH new_activity AS (
  INSERT INTO public.activities(name, department_id, status, auto_approve_borrows, created_by)
  VALUES ('Instant test activity', (SELECT department_id FROM instant_test_users WHERE label = 'admin'),
    'active', TRUE, (SELECT app_id FROM instant_test_users WHERE label = 'super'))
  RETURNING id
)
INSERT INTO instant_test_state(label, id) SELECT 'auto_activity', id FROM new_activity;
SELECT pg_temp.instant_actor('member');
INSERT INTO instant_test_state(label, id)
SELECT 'member_activity_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE label = 'test_item'), 'quantity', 1)),
  'activity auto approve', CURRENT_DATE + 1, NULL,
  (SELECT id FROM instant_test_state WHERE label = 'auto_activity'));
SELECT pg_temp.instant_assert((SELECT status = 'borrowed' AND borrowed_at IS NOT NULL
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'member_activity_order')),
  'Auto-approve activity borrows instantly for members');
-- operation_logs are super-admin-readable only; switch actor before the audit assert.
SELECT pg_temp.instant_actor('super');
SELECT pg_temp.instant_assert((SELECT count(*) = 1 FROM public.operation_logs
  WHERE order_id = (SELECT id FROM instant_test_state WHERE label = 'member_activity_order')
    AND details ->> 'auto_source' = 'activity'), 'Activity auto borrow is audit marked');
SELECT pg_temp.instant_actor('admin');
INSERT INTO instant_test_state(label, id)
SELECT 'admin_activity_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE label = 'test_item'), 'quantity', 1)),
  'activity auto approve admin', CURRENT_DATE + 1, NULL,
  (SELECT id FROM instant_test_state WHERE label = 'auto_activity'));
SELECT pg_temp.instant_assert((SELECT status = 'borrowed'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'admin_activity_order')),
  'Auto-approve activity borrows instantly for admins');
-- Returns of auto-approved orders still go through the shared review flow.
SELECT pg_temp.instant_actor('member');
INSERT INTO instant_test_state(label, id)
SELECT 'member_activity_return', public.submit_borrow_return_request(
  (SELECT id FROM instant_test_state WHERE label = 'member_activity_order'),
  (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', id, 'returned_location_code', borrow_location_code,
    'scanned_qr_payload', '513-warehouse:' || borrow_location_code, 'item_condition', 'good'))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM instant_test_state WHERE label = 'member_activity_order')));
SELECT pg_temp.instant_actor('admin');
SELECT public.review_borrow_return_request((SELECT id FROM instant_test_state WHERE label = 'member_activity_return'), TRUE);
SELECT pg_temp.instant_assert((SELECT status = 'returned'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'member_activity_order')),
  'Auto-approved activity order still reviews returns');

-- 9. A lone active super admin may accept their own return request.
SELECT pg_temp.instant_actor('super');
INSERT INTO instant_test_state(label, id)
SELECT 'super_order2', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE label = 'test_item'), 'quantity', 1)),
  'lone super return test', CURRENT_DATE + 1);
INSERT INTO instant_test_state(label, id)
SELECT 'super_return2', public.submit_borrow_return_request(
  (SELECT id FROM instant_test_state WHERE label = 'super_order2'),
  (SELECT jsonb_agg(jsonb_build_object('borrow_item_id', id, 'returned_location_code', borrow_location_code,
    'scanned_qr_payload', '513-warehouse:' || borrow_location_code, 'item_condition', 'good'))
   FROM public.borrow_items WHERE order_id = (SELECT id FROM instant_test_state WHERE label = 'super_order2')));
-- With another active super admin, self review stays rejected.
SELECT pg_temp.instant_actor('super');
SELECT pg_temp.instant_reject('SELECT public.review_borrow_return_request(
  (SELECT id FROM instant_test_state WHERE label = ''super_return2''), TRUE)', 'own return');
-- Deactivate every other active super admin (fixtures and any pre-existing
-- accounts in the test database); the lone super admin can now self-review.
UPDATE public.users SET is_active = FALSE
WHERE role = 'super_admin' AND is_active
  AND id <> (SELECT app_id FROM instant_test_users WHERE label = 'super');
SELECT public.review_borrow_return_request((SELECT id FROM instant_test_state WHERE label = 'super_return2'), TRUE);
SELECT pg_temp.instant_assert((SELECT status = 'returned'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'super_order2')),
  'Lone super admin can accept their own return');

-- 10. auto_approve_borrows is guarded at the table level (INSERT and UPDATE).
SELECT pg_temp.instant_actor('admin');
-- Enabling the flag on a new activity is rejected for department admins.
SELECT pg_temp.instant_reject('INSERT INTO public.activities(name, department_id, status, auto_approve_borrows, created_by)
  VALUES (''Admin auto attempt'', (SELECT department_id FROM instant_test_users WHERE label = ''admin''), ''active'', TRUE,
  (SELECT app_id FROM instant_test_users WHERE label = ''admin''))',
  'Only active super administrators can change activity auto approval');
-- Admins can still create their own activities without the flag.
WITH plain AS (
  INSERT INTO public.activities(name, department_id, status, created_by)
  VALUES ('Admin plain activity', (SELECT department_id FROM instant_test_users WHERE label = 'admin'), 'active',
    (SELECT app_id FROM instant_test_users WHERE label = 'admin'))
  RETURNING id
)
INSERT INTO instant_test_state(label, id) SELECT 'plain_activity', id FROM plain;
SELECT pg_temp.instant_assert((SELECT count(*) = 1 FROM public.activities
  WHERE id = (SELECT id FROM instant_test_state WHERE label = 'plain_activity')
    AND auto_approve_borrows = FALSE), 'Admin creates activities without the flag');
-- Flipping an existing flag from false to true is rejected...
SELECT pg_temp.instant_reject('UPDATE public.activities SET auto_approve_borrows = TRUE
  WHERE id = (SELECT id FROM instant_test_state WHERE label = ''plain_activity'')',
  'Only active super administrators can change activity auto approval');
-- ...and so is disabling an enabled one (the value itself may not change).
SELECT pg_temp.instant_reject('UPDATE public.activities SET auto_approve_borrows = FALSE
  WHERE id = (SELECT id FROM instant_test_state WHERE label = ''auto_activity'')',
  'Only active super administrators can change activity auto approval');
-- Admins keep maintaining the other fields of an activity whose flag stays unchanged.
SELECT pg_temp.instant_actor('admin');
UPDATE public.activities SET description = 'updated by admin'
WHERE id = (SELECT id FROM instant_test_state WHERE label = 'auto_activity');
SELECT pg_temp.instant_assert((SELECT description = 'updated by admin' AND auto_approve_borrows = TRUE
  FROM public.activities WHERE id = (SELECT id FROM instant_test_state WHERE label = 'auto_activity')),
  'Admins keep editing other fields of a flagged activity');
-- Members cannot modify activities at all (RLS silently filters the update).
SELECT pg_temp.instant_actor('member');
UPDATE public.activities SET name = 'member takeover'
WHERE id = (SELECT id FROM instant_test_state WHERE label = 'plain_activity');
SELECT pg_temp.instant_assert((SELECT name <> 'member takeover'
  FROM public.activities WHERE id = (SELECT id FROM instant_test_state WHERE label = 'plain_activity')),
  'Members cannot modify activities');
-- Super admins can toggle the flag freely.
SELECT pg_temp.instant_actor('super');
UPDATE public.activities SET auto_approve_borrows = FALSE
WHERE id = (SELECT id FROM instant_test_state WHERE label = 'auto_activity');
SELECT pg_temp.instant_assert((SELECT auto_approve_borrows = FALSE
  FROM public.activities WHERE id = (SELECT id FROM instant_test_state WHERE label = 'auto_activity')),
  'Super admin can disable the flag');
UPDATE public.activities SET auto_approve_borrows = TRUE
WHERE id = (SELECT id FROM instant_test_state WHERE label = 'auto_activity');
SELECT pg_temp.instant_assert((SELECT auto_approve_borrows = TRUE
  FROM public.activities WHERE id = (SELECT id FROM instant_test_state WHERE label = 'auto_activity')),
  'Super admin can re-enable the flag');
-- An activity without the flag keeps the original approval flow.
SELECT pg_temp.instant_actor('member2');
INSERT INTO instant_test_state(label, id)
SELECT 'plain_activity_order', public.create_borrow_order_batch(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'item_id', (SELECT item_id FROM instant_test_state WHERE label = 'test_item'), 'quantity', 1)),
  'plain activity approval', CURRENT_DATE + 1, NULL,
  (SELECT id FROM instant_test_state WHERE label = 'plain_activity'));
SELECT pg_temp.instant_assert((SELECT status = 'pending'
  FROM public.borrow_orders WHERE id = (SELECT id FROM instant_test_state WHERE label = 'plain_activity_order')),
  'Flag-free activity keeps the approval flow');

RESET ROLE;
ROLLBACK;
