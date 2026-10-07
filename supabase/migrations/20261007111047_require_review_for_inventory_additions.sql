BEGIN;

-- Publication is restricted to the review RPC after its independent approvals.
REVOKE INSERT ON TABLE public.inventory_items FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Super admins create inventory" ON public.inventory_items;
REVOKE ALL ON FUNCTION public.create_inventory_item(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
