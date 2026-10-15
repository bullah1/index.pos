-- Shows which POS database updates are installed (true = installed).
SELECT 'base tables (0000-0004)'  AS update_name, to_regclass('public.cash_drawers') IS NOT NULL AS installed
UNION ALL SELECT '0005 returns/cancel fix', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_status_check' AND pg_get_constraintdef(oid) LIKE '%partially_returned%')
UNION ALL SELECT '0006 cash drawer lock',  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'drawer_is_open')
UNION ALL SELECT '0007 price change',      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'list_price')
UNION ALL SELECT '0008 stock adjustments', to_regclass('public.stock_adjustments') IS NOT NULL
UNION ALL SELECT '0009 courier',           to_regclass('public.courier_orders') IS NOT NULL;
