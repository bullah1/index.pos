-- Opening stock from the 17/10/2026 inventory sheet (48 items).
-- Run ONCE, AFTER the first admin has signed up in the app.
-- Purchase price = MRP - 45%. Sale price = MRP. Capsules are stocked per capsule (unit "cap").
-- Batch "OPEN-171026", expiry 2027-12-31 is a placeholder: change it per product later if needed.
do $$
declare
  v_uid uuid; v_idx uuid; v_opt uuid; v_pur uuid; v_sup uuid;
  r record; v_med uuid; v_batch uuid; v_sub numeric := 0;
  v_exp date := date '2027-12-31'; v_bno text := 'OPEN-171026';
begin
  select user_id into v_uid from public.user_roles where role = 'admin' limit 1;
  if v_uid is null then raise exception 'Sign up in the app first (first user becomes admin), then run this file.'; end if;
  if exists (select 1 from public.purchases where note = 'Opening stock 17/10/2026') then
    raise exception 'Opening stock already imported.';
  end if;

  select id into v_idx from public.suppliers where name = 'Index Laboratories (Ayu) Ltd';
  if v_idx is null then insert into public.suppliers (name) values ('Index Laboratories (Ayu) Ltd') returning id into v_idx; end if;
  select id into v_opt from public.suppliers where name = 'Optimum Pharmaceuticals HLB';
  if v_opt is null then insert into public.suppliers (name) values ('Optimum Pharmaceuticals HLB') returning id into v_opt; end if;

  for v_sup in select unnest(array[v_idx, v_opt]) loop
    v_pur := gen_random_uuid(); v_sub := 0;
    insert into public.purchases (id, purchase_no, idempotency_key, supplier_id, purchase_date, subtotal, discount, total, paid, note, created_by)
    values (v_pur, 'PUR-' || lpad(nextval('public.purchase_no_seq')::text, 6, '0'), gen_random_uuid(), v_sup,
            date '2026-10-17', 0, 0, 0, 0, 'Opening stock 17/10/2026', v_uid);

    for r in select * from (values
('Bhidex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',500.0,275.0,6),
('Hilivon','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',250.0,137.5,3),
('Ledex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',270.0,148.5,3),
('Konadex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',600.0,330.0,6),
('Carmidex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',250.0,137.5,7),
('Bolent Plus','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',1200.0,660.0,2),
('Arjunarin','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',380.0,209.0,3),
('Amladex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',350.0,192.5,9),
('Dosodex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',350.0,192.5,2),
('Beladex','450 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',320.0,176.0,1),
('Konadex','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',300.0,165.0,6),
('Bonylin','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',200.0,110.0,6),
('Laxidex','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',250.0,137.5,7),
('Puridex','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',180.0,99.0,8),
('Urofine','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',140.0,77.0,5),
('Ledex','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',150.0,82.5,1),
('Gynoton','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',198.0,108.9,3),
('Carmidex','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',110.0,60.5,2),
('Bhidex','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',250.0,137.5,6),
('Bacicure','200 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',185.0,101.75,2),
('Oximum','200 ml','Syrup','bottle','Optimum Pharmaceuticals HLB',390.0,214.5,1),
('Thermocare','100 ml','Syrup','bottle','Index Laboratories (Ayu) Ltd',60.0,33.0,9),
('Bolent','20 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',25.0,13.75,72),
('Sukrise','150 gm','Powder','jar','Index Laboratories (Ayu) Ltd',740.0,407.0,6),
('Livaly','60 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',18.0,9.9,120),
('Ferudex','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',13.3,7.32,105),
('Colodex','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',20.0,11.0,97),
('Indogon','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',16.0,8.8,86),
('Zanthilima','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',19.5,10.73,106),
('Echinex','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',36.0,19.8,110),
('Digedex','50 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',9.0,4.95,126),
('Arthrodex','150 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',12.5,6.88,302),
('Nemagen','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',15.0,8.25,146),
('Pilocure','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',19.8,10.89,106),
('Livolife','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',25.0,13.75,60),
('Lobergin','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',16.5,9.08,101),
('Nephrocare','30 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',36.33,19.98,65),
('Inbiloba','60 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',19.83,10.91,70),
('Inginsen','15 cap','Capsule','cap','Index Laboratories (Ayu) Ltd',70.0,38.5,15),
('Diamum','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',18.33,10.08,30),
('Neuromum','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',20.0,11.0,126),
('Erectob','20 cap','Capsule','cap','Optimum Pharmaceuticals HLB',30.0,16.5,257),
('Off Syst','10 cap','Capsule','cap','Optimum Pharmaceuticals HLB',80.0,44.0,60),
('Lowtense','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',13.0,7.15,150),
('J Wort','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',15.0,8.25,120),
('Parmet','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',12.0,6.6,62),
('Menstone','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',20.0,11.0,60),
('Reboost','30 cap','Capsule','cap','Optimum Pharmaceuticals HLB',13.33,7.33,49)
    ) as t(name, strength, form, unit, maker, sale_price, unit_cost, qty)
    where (maker = 'Optimum Pharmaceuticals HLB') = (v_sup = v_opt) loop
      select id into v_med from public.medicines
       where lower(name) = lower(r.name) and coalesce(strength,'') = r.strength;
      if v_med is null then
        insert into public.medicines (name, manufacturer, category, strength, dosage_form, sale_unit, default_price)
        values (r.name, r.maker, 'Herbal', r.strength, r.form, r.unit, r.sale_price) returning id into v_med;
      end if;
      insert into public.medicine_batches (medicine_id, batch_no, expiry_date, unit_cost, sale_price, qty_on_hand, supplier_id)
      values (v_med, v_bno, v_exp, r.unit_cost, r.sale_price, r.qty, v_sup) returning id into v_batch;
      insert into public.purchase_items (purchase_id, medicine_id, batch_id, batch_no, expiry_date, qty, unit_cost, sale_price, line_total)
      values (v_pur, v_med, v_batch, v_bno, v_exp, r.qty, r.unit_cost, r.sale_price, round(r.qty * r.unit_cost, 2));
      insert into public.stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
      values (v_batch, v_med, 'purchase', r.qty, 'purchases', v_pur, v_uid);
      v_sub := v_sub + round(r.qty * r.unit_cost, 2);
    end loop;
    -- opening stock is already owned: mark as fully paid so no supplier due is created
    update public.purchases set subtotal = v_sub, total = v_sub, paid = v_sub where id = v_pur;
  end loop;
end $$;
