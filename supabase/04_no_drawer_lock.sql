-- Sales, purchases, stock entry, expenses and payments no longer need an open cash drawer.
-- The Cash Drawer page still works for counting cash, but it never blocks anything.
CREATE OR REPLACE FUNCTION public.require_open_drawer()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN;
END $$;
