-- 1) Adds the Optimum Pharmaceuticals (HBL) range that is not in the POS yet (0 stock; add stock later).
-- 2) Fixes the spelling of 5 Optimum products imported from the inventory sheet.
-- 3) Purchase price for ALL stock = MRP − 55% (cost = 45% of sale price). Opening-stock purchases are re-totalled.
-- Safe to run more than once. Supabase → SQL Editor → paste all → Run.
do $$
declare v_opt uuid; r record; v_n int := 0;
begin
  -- 2) spelling (only if the correct name is not already used)
  for r in select * from (values
    ('Erectob','Erectop'), ('Off Syst','Off Cyst'), ('Lowtense','Lowtens'), ('Parmet','Palmet'), ('J Wort','J-Wort')
  ) as t(old_name, new_name) loop
    if not exists (select 1 from public.medicines where lower(name) = lower(r.new_name)) then
      update public.medicines set name = r.new_name where lower(name) = lower(r.old_name);
    end if;
  end loop;

  -- 1) new products. MRP = full box price from the Optimum website; sold per box.
  for r in select * from (values
    ('Arthomum',             '500 mg',        'Tablet',     'box',    600),
    ('Bronchomum',           '100 ml',        'Syrup',      'bottle',  75),
    ('Bronchomum',           '200 ml',        'Syrup',      'bottle', 140),
    ('Constipen',            '100 gm',        'Powder',     'jar',    480),
    ('Fertile Q10',          '100 mg',        'Capsule',    'box',   1050),
    ('G-Pro',                '500 mg',        'Tablet',     'box',    300),
    ('Ginkoba',              '60 mg',         'Capsule',    'box',    600),
    ('Ginset',               '500 mg',        'Capsule',    'box',    990),
    ('Hepaneo',              '140 mg',        'Capsule',    'box',    300),
    ('Infecnocea',           '400 mg',        'Capsule',    'box',    450),
    ('Lipilow',              '300 mg',        'Capsule',    'box',    480),
    ('Opcid',                '500 mg',        'Capsule',    'box',    250),
    ('Optimum Shampoo',      '200 ml',        'Shampoo',    'bottle', 420),
    ('Optimum Medicated Soap','100 gm',       'Soap',       'pcs',    460),
    ('Optimum Neem Soap',    '100 gm',        'Soap',       'pcs',    200),
    ('Optimum Moringa',      '500 mg',        'Capsule',    'box',    525),
    ('Optimum Toothpaste',   '150 gm',        'Toothpaste', 'pcs',    320),
    ('Oximum',               '100 ml',        'Syrup',      'bottle', 200),
    ('Pearlical-D',          '325 mg',        'Capsule',    'box',    450),
    ('Probiotica',           '4 Billion CFU', 'Capsule',    'box',    700),
    ('Smilon',               '500 mg',        'Capsule',    'box',    800),
    ('Soft Joint',           '820 mg',        'Tablet',     'box',    900),
    ('Spiromum',             '500 mg',        'Capsule',    'box',    450)
  ) as t(name, strength, form, unit, mrp) loop
    if not exists (select 1 from public.medicines where lower(name) = lower(r.name) and coalesce(strength,'') = r.strength) then
      insert into public.medicines (name, manufacturer, category, strength, dosage_form, sale_unit, default_price)
      values (r.name, 'Optimum Pharmaceuticals HLB', 'Herbal', r.strength, r.form, r.unit, r.mrp);
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice 'New products added: %', v_n;

  -- 3) cost = 45% of sale price for every batch
  update public.medicine_batches set unit_cost = round(sale_price * 0.45, 2)
   where unit_cost <> round(sale_price * 0.45, 2);

  -- keep the opening-stock purchase records in line with the new cost (still fully paid, no supplier due)
  update public.purchase_items pi set unit_cost = round(pi.sale_price * 0.45, 2), line_total = round(pi.qty * round(pi.sale_price * 0.45, 2), 2)
    from public.purchases p
   where p.id = pi.purchase_id and p.note = 'Opening stock 17/10/2026';
  update public.purchases p set subtotal = x.s, total = x.s, paid = x.s
    from (select purchase_id, sum(line_total) s from public.purchase_items group by purchase_id) x
   where x.purchase_id = p.id and p.note = 'Opening stock 17/10/2026';
end $$;

-- check: products, stock value at cost
select (select count(*) from public.medicines) as products,
       (select round(sum(qty_on_hand * unit_cost), 2) from public.medicine_batches) as stock_value_at_cost;
