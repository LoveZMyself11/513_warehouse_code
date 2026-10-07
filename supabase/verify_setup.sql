-- Read-only verification for the 513 warehouse schema and access model.
WITH expected_tables(table_name) AS (
  VALUES
    ('inventory_locations'),
    ('inventory_items'),
    ('inventory_location_history'),
    ('activities'),
    ('departments'),
    ('users'),
    ('borrow_orders'),
    ('borrow_items'),
    ('borrow_return_requests'),
    ('borrow_return_items'),
    ('operation_logs'),
    ('inventory_change_requests'),
    ('system_announcements')
),
actual_tables AS (
  SELECT tablename AS table_name
  FROM pg_tables
  WHERE schemaname = 'public'
),
rls_state AS (
  SELECT relname AS table_name, relrowsecurity AS rls_enabled
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace
    AND relkind = 'r'
    AND relname IN (SELECT table_name FROM expected_tables)
),
app_functions AS (
  SELECT DISTINCT p.proname AS function_name
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_inventory_item',
      'update_inventory_item',
      'delete_inventory_item',
      'review_inventory_change_request',
      'update_department_member',
      'update_borrow_order_status',
      'create_borrow_order',
      'create_borrow_order_batch',
      'get_inventory_borrow_status',
      'submit_borrow_return_request',
      'review_borrow_return_request'
    )
),
role_constraint AS (
  SELECT pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid = 'public.users'::regclass
    AND conname = 'users_role_check'
),
relevant_policies AS (
  SELECT tablename, policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('users', 'departments', 'activities', 'borrow_orders', 'borrow_items', 'borrow_return_requests', 'borrow_return_items', 'inventory_items', 'system_announcements')
),
storage_policies AS (
  SELECT policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN ('Active users upload inventory images', 'Owners delete inventory image uploads')
),
return_storage_policies AS (
  SELECT policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'Active users upload borrow return images',
      'Return participants view return images',
      'Owners delete borrow return images'
    )
)
SELECT jsonb_pretty(jsonb_build_object(
  'public_tables', (SELECT jsonb_agg(table_name ORDER BY table_name) FROM actual_tables),
  'missing_required_tables', (SELECT COALESCE(jsonb_agg(e.table_name ORDER BY e.table_name), '[]'::jsonb) FROM expected_tables e LEFT JOIN actual_tables a USING (table_name) WHERE a.table_name IS NULL),
  'rls', (SELECT jsonb_object_agg(table_name, rls_enabled ORDER BY table_name) FROM rls_state),
  'roles_in_use', (SELECT COALESCE(jsonb_agg(DISTINCT role ORDER BY role), '[]'::jsonb) FROM public.users),
  'legacy_manager_count', (SELECT count(*) FROM public.users WHERE role = 'manager'),
  'role_constraint', (SELECT definition FROM role_constraint LIMIT 1),
  'user_profile_columns', (SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('position', 'notes')),
  'departments', (SELECT jsonb_agg(name ORDER BY name) FROM public.departments),
  'department_count', (SELECT count(*) FROM public.departments),
  'inventory_item_count', (SELECT count(*) FROM public.inventory_items),
  'activity_count', (SELECT count(*) FROM public.activities),
  'borrow_order_extension_columns', (SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'borrow_orders' AND column_name IN ('activity_id', 'borrowed_at', 'return_submitted_at')),
  'borrow_item_extension_columns', (SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'borrow_items' AND column_name = 'borrow_location_code'),
  'inventory_sequence_last_value', (SELECT last_value FROM public.inventory_item_number_seq),
  'auth_user_count', (SELECT count(*) FROM auth.users),
  'available_rpcs', (SELECT jsonb_agg(function_name ORDER BY function_name) FROM app_functions),
  'anonymous_inventory_select_grant', has_table_privilege('anon', 'public.inventory_items', 'SELECT'),
  'policies', (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd) ORDER BY tablename, policyname) FROM relevant_policies),
  'inventory_image_bucket', (SELECT jsonb_build_object('public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) FROM storage.buckets WHERE id = 'inventory-images'),
  'inventory_image_storage_policies', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', policyname, 'command', cmd) ORDER BY policyname), '[]'::jsonb) FROM storage_policies),
  'borrow_return_image_bucket', (SELECT jsonb_build_object('public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) FROM storage.buckets WHERE id = 'borrow-return-images'),
  'borrow_return_image_storage_policies', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', policyname, 'command', cmd) ORDER BY policyname), '[]'::jsonb) FROM return_storage_policies)
)) AS verification_report;
