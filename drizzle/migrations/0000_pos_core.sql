
create type public.app_role as enum ('admin','manager','cashier');
create type public.pay_method as enum ('cash','bkash','nagad','rocket','bank');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id)
$$;
create or replace function public.is_manager(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','manager'))
$$;

create policy "staff read profiles" on public.profiles for select to authenticated using (public.is_staff(auth.uid()) or id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "read own or admin roles" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));

-- first user becomes admin, others cashier
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email);
  if not exists (select 1 from public.user_roles) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'cashier');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table public.settings (
  id int primary key default 1 check (id = 1),
  pharmacy_name text not null default 'My Pharmacy',
  address text not null default '',
  phone text not null default '',
  invoice_footer text not null default 'Thank you. Get well soon!',
  currency text not null default 'BDT',
  receipt_format text not null default 'thermal' check (receipt_format in ('thermal','a4')),
  low_stock_threshold int not null default 10 check (low_stock_threshold >= 0),
  expiry_alert_days int not null default 90 check (expiry_alert_days >= 0),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);
grant select, update on public.settings to authenticated;
grant all on public.settings to service_role;
alter table public.settings enable row level security;
create policy "staff read settings" on public.settings for select to authenticated using (public.is_staff(auth.uid()));
create policy "admin update settings" on public.settings for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text, address text, notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.medicines (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null check (length(trim(name)) > 0),
  name_bn text,
  generic_name text,
  manufacturer text,
  category text,
  strength text,
  dosage_form text,
  sale_unit text not null default 'pcs',
  barcode text unique,
  prescription_required boolean not null default false,
  default_price numeric(14,2) not null default 0 check (default_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medicines_name_idx on public.medicines (lower(name));
create index medicines_generic_idx on public.medicines (lower(generic_name));

create table public.medicine_batches (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  batch_no text not null,
  expiry_date date not null,
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  sale_price numeric(14,2) not null check (sale_price >= 0),
  qty_on_hand numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  supplier_id uuid references public.suppliers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medicine_id, batch_no)
);
create index batches_fefo_idx on public.medicine_batches (medicine_id, expiry_date);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text unique,
  address text, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.purchase_no_seq;
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,
  idempotency_key uuid not null unique,
  supplier_id uuid not null references public.suppliers(id),
  supplier_invoice_no text,
  purchase_date date not null default (now() at time zone 'Asia/Dhaka')::date,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  status text not null default 'posted' check (status in ('posted','cancelled')),
  note text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid <= total)
);
create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid not null references public.medicine_batches(id),
  batch_no text not null,
  expiry_date date not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  sale_price numeric(14,2) not null check (sale_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id);

create sequence public.invoice_no_seq;
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  idempotency_key uuid not null unique,
  customer_id uuid references public.customers(id),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  item_discount numeric(14,2) not null default 0 check (item_discount >= 0),
  bill_discount numeric(14,2) not null default 0 check (bill_discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  paid numeric(14,2) not null default 0 check (paid >= 0),
  due numeric(14,2) not null default 0 check (due >= 0),
  status text not null default 'completed' check (status in ('completed','cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sales_created_idx on public.sales (created_at desc);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  medicine_id uuid not null references public.medicines(id),
  batch_id uuid not null references public.medicine_batches(id),
  medicine_name text not null,
  batch_no text not null,
  expiry_date date not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  method public.pay_method not null,
  amount numeric(14,2) not null check (amount > 0),
  kind text not null default 'sale' check (kind in ('sale','due_collection','refund')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default (now() at time zone 'Asia/Dhaka')::date,
  method public.pay_method not null default 'cash',
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.medicine_batches(id),
  medicine_id uuid not null references public.medicines(id),
  movement_type text not null check (movement_type in ('purchase','sale','sale_return','sale_cancel','purchase_cancel','adjustment')),
  qty_change numeric(14,3) not null check (qty_change <> 0),
  ref_table text, ref_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index stock_movements_batch_idx on public.stock_movements (batch_id, created_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid, action text not null, entity text, entity_id uuid, details jsonb,
  created_at timestamptz not null default now()
);

-- timestamps
create trigger t_med before update on public.medicines for each row execute function public.touch_updated_at();
create trigger t_bat before update on public.medicine_batches for each row execute function public.touch_updated_at();
create trigger t_sup before update on public.suppliers for each row execute function public.touch_updated_at();
create trigger t_cus before update on public.customers for each row execute function public.touch_updated_at();
create trigger t_prof before update on public.profiles for each row execute function public.touch_updated_at();

-- grants: reads for staff; direct writes only on master data
grant select, insert, update on public.medicines, public.suppliers, public.customers to authenticated;
grant select on public.medicine_batches, public.purchases, public.purchase_items, public.sales, public.sale_items, public.sale_payments, public.stock_movements to authenticated;
grant select, insert on public.expenses to authenticated;
grant select on public.audit_log to authenticated;
grant all on public.medicines, public.suppliers, public.customers, public.medicine_batches, public.purchases, public.purchase_items, public.sales, public.sale_items, public.sale_payments, public.stock_movements, public.expenses, public.audit_log to service_role;

alter table public.medicines enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.medicine_batches enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

create policy "staff read" on public.medicines for select to authenticated using (public.is_staff(auth.uid()));
create policy "mgr insert" on public.medicines for insert to authenticated with check (public.is_manager(auth.uid()));
create policy "mgr update" on public.medicines for update to authenticated using (public.is_manager(auth.uid())) with check (public.is_manager(auth.uid()));
create policy "staff read" on public.suppliers for select to authenticated using (public.is_staff(auth.uid()));
create policy "mgr insert" on public.suppliers for insert to authenticated with check (public.is_manager(auth.uid()));
create policy "mgr update" on public.suppliers for update to authenticated using (public.is_manager(auth.uid())) with check (public.is_manager(auth.uid()));
create policy "staff read" on public.customers for select to authenticated using (public.is_staff(auth.uid()));
create policy "staff insert" on public.customers for insert to authenticated with check (public.is_staff(auth.uid()));
create policy "mgr update" on public.customers for update to authenticated using (public.is_manager(auth.uid())) with check (public.is_manager(auth.uid()));
create policy "staff read" on public.medicine_batches for select to authenticated using (public.is_staff(auth.uid()));
create policy "mgr read" on public.purchases for select to authenticated using (public.is_manager(auth.uid()));
create policy "mgr read" on public.purchase_items for select to authenticated using (public.is_manager(auth.uid()));
create policy "staff read" on public.sales for select to authenticated using (public.is_manager(auth.uid()) or created_by = auth.uid());
create policy "staff read" on public.sale_items for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and (public.is_manager(auth.uid()) or s.created_by = auth.uid())));
create policy "staff read" on public.sale_payments for select to authenticated using (exists (select 1 from public.sales s where s.id = sale_id and (public.is_manager(auth.uid()) or s.created_by = auth.uid())));
create policy "mgr read" on public.stock_movements for select to authenticated using (public.is_manager(auth.uid()));
create policy "mgr read" on public.expenses for select to authenticated using (public.is_manager(auth.uid()));
create policy "mgr insert" on public.expenses for insert to authenticated with check (public.is_manager(auth.uid()) and created_by = auth.uid());
create policy "admin read" on public.audit_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

-- ===== post_purchase =====
create or replace function public.post_purchase(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_existing record;
  v_id uuid; v_no text;
  it jsonb; v_batch uuid;
  v_sub numeric(14,2) := 0; v_disc numeric(14,2) := coalesce((p->>'discount')::numeric,0);
  v_paid numeric(14,2) := coalesce((p->>'paid')::numeric,0);
  v_qty numeric; v_cost numeric; v_price numeric; v_exp date; v_bno text; v_med uuid;
begin
  if uid is null or not public.is_manager(uid) then raise exception 'Not allowed: managers only'; end if;
  if v_key is null then raise exception 'Missing idempotency key'; end if;
  select id, purchase_no into v_existing from purchases where idempotency_key = v_key;
  if found then return jsonb_build_object('id', v_existing.id, 'purchase_no', v_existing.purchase_no, 'duplicate', true); end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one item'; end if;
  if v_disc < 0 or v_paid < 0 then raise exception 'Invalid discount or paid amount'; end if;

  v_id := gen_random_uuid();
  v_no := 'PUR-' || lpad(nextval('purchase_no_seq')::text, 6, '0');
  insert into purchases (id, purchase_no, idempotency_key, supplier_id, supplier_invoice_no, purchase_date, subtotal, discount, total, paid, note, created_by)
  values (v_id, v_no, v_key, (p->>'supplier_id')::uuid, nullif(p->>'supplier_invoice_no',''),
          coalesce((p->>'purchase_date')::date, (now() at time zone 'Asia/Dhaka')::date), 0, 0, 0, 0, p->>'note', uid);

  for it in select * from jsonb_array_elements(p->'items') loop
    v_med := (it->>'medicine_id')::uuid; v_bno := trim(it->>'batch_no'); v_exp := (it->>'expiry_date')::date;
    v_qty := (it->>'qty')::numeric; v_cost := (it->>'unit_cost')::numeric; v_price := (it->>'sale_price')::numeric;
    if v_bno is null or v_bno = '' then raise exception 'Batch number required'; end if;
    if v_exp is null then raise exception 'Expiry date required'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    if v_cost is null or v_cost < 0 or v_price is null or v_price < 0 then raise exception 'Invalid cost or price'; end if;

    insert into medicine_batches (medicine_id, batch_no, expiry_date, unit_cost, sale_price, qty_on_hand, supplier_id)
    values (v_med, v_bno, v_exp, v_cost, v_price, 0, (p->>'supplier_id')::uuid)
    on conflict (medicine_id, batch_no) do update set unit_cost = excluded.unit_cost, sale_price = excluded.sale_price
    returning id into v_batch;
    if (select expiry_date from medicine_batches where id = v_batch) <> v_exp then
      raise exception 'Batch % already exists with a different expiry date', v_bno;
    end if;
    update medicine_batches set qty_on_hand = qty_on_hand + v_qty where id = v_batch;
    insert into purchase_items (purchase_id, medicine_id, batch_id, batch_no, expiry_date, qty, unit_cost, sale_price, line_total)
    values (v_id, v_med, v_batch, v_bno, v_exp, v_qty, v_cost, v_price, round(v_qty * v_cost, 2));
    insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
    values (v_batch, v_med, 'purchase', v_qty, 'purchases', v_id, uid);
    v_sub := v_sub + round(v_qty * v_cost, 2);
  end loop;

  if v_disc > v_sub then raise exception 'Discount exceeds subtotal'; end if;
  if v_paid > v_sub - v_disc then raise exception 'Paid amount exceeds total'; end if;
  update purchases set subtotal = v_sub, discount = v_disc, total = v_sub - v_disc, paid = v_paid where id = v_id;
  insert into audit_log (actor, action, entity, entity_id) values (uid, 'post_purchase', 'purchases', v_id);
  return jsonb_build_object('id', v_id, 'purchase_no', v_no, 'duplicate', false);
end $$;

-- ===== post_sale (FEFO, row locks) =====
create or replace function public.post_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_existing record;
  v_id uuid; v_no text;
  it jsonb; pay jsonb; b record; m record;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_need numeric; v_take numeric; v_price numeric; v_line_disc numeric; v_ratio numeric;
  v_sub numeric(14,2) := 0; v_idisc numeric(14,2) := 0;
  v_bdisc numeric(14,2) := coalesce((p->>'bill_discount')::numeric, 0);
  v_paid numeric(14,2) := 0; v_total numeric(14,2);
  v_alloc numeric(14,2);
  v_cust uuid := nullif(p->>'customer_id','')::uuid;
begin
  if uid is null or not public.is_staff(uid) then raise exception 'Not allowed'; end if;
  if v_key is null then raise exception 'Missing idempotency key'; end if;
  select id, invoice_no into v_existing from sales where idempotency_key = v_key;
  if found then return jsonb_build_object('id', v_existing.id, 'invoice_no', v_existing.invoice_no, 'duplicate', true); end if;
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Cart is empty'; end if;
  if v_bdisc < 0 then raise exception 'Invalid discount'; end if;

  v_id := gen_random_uuid();
  v_no := 'INV-' || lpad(nextval('invoice_no_seq')::text, 6, '0');
  insert into sales (id, invoice_no, idempotency_key, customer_id, subtotal, total, created_by)
  values (v_id, v_no, v_key, v_cust, 0, 0, uid);

  for it in select * from jsonb_array_elements(p->'items') loop
    v_need := (it->>'qty')::numeric;
    v_line_disc := coalesce((it->>'discount')::numeric, 0);
    if v_need is null or v_need <= 0 then raise exception 'Quantity must be positive'; end if;
    if v_line_disc < 0 then raise exception 'Invalid line discount'; end if;
    select * into m from medicines where id = (it->>'medicine_id')::uuid;
    if not found or not m.is_active then raise exception 'Medicine not available'; end if;
    v_ratio := v_need;  -- remember for discount split

    if it ? 'batch_id' and nullif(it->>'batch_id','') is not null then
      select * into b from medicine_batches where id = (it->>'batch_id')::uuid and medicine_id = m.id for update;
      if not found then raise exception 'Batch not found for %', m.name; end if;
      if b.expiry_date <= v_today then raise exception 'Batch % of % is expired', b.batch_no, m.name; end if;
      if b.qty_on_hand < v_need then raise exception 'Insufficient stock for % (batch %): % available', m.name, b.batch_no, b.qty_on_hand; end if;
      v_price := b.sale_price;
      update medicine_batches set qty_on_hand = qty_on_hand - v_need where id = b.id;
      insert into sale_items (sale_id, medicine_id, batch_id, medicine_name, batch_no, expiry_date, qty, unit_price, discount, unit_cost, line_total)
      values (v_id, m.id, b.id, m.name, b.batch_no, b.expiry_date, v_need, v_price, v_line_disc, b.unit_cost, round(v_need*v_price - v_line_disc, 2));
      insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
      values (b.id, m.id, 'sale', -v_need, 'sales', v_id, uid);
      if v_line_disc > round(v_need*v_price,2) then raise exception 'Discount exceeds line amount for %', m.name; end if;
      v_sub := v_sub + round(v_need*v_price, 2); v_idisc := v_idisc + v_line_disc;
    else
      -- FEFO across non-expired batches; discount allocated proportionally
      if (select coalesce(sum(qty_on_hand),0) from medicine_batches where medicine_id = m.id and expiry_date > v_today) < v_need then
        raise exception 'Insufficient stock for %', m.name;
      end if;
      for b in select * from medicine_batches
               where medicine_id = m.id and expiry_date > v_today and qty_on_hand > 0
               order by expiry_date, created_at for update loop
        exit when v_need <= 0;
        v_take := least(v_need, b.qty_on_hand);
        v_alloc := round(v_line_disc * v_take / v_ratio, 2);
        update medicine_batches set qty_on_hand = qty_on_hand - v_take where id = b.id;
        insert into sale_items (sale_id, medicine_id, batch_id, medicine_name, batch_no, expiry_date, qty, unit_price, discount, unit_cost, line_total)
        values (v_id, m.id, b.id, m.name, b.batch_no, b.expiry_date, v_take, b.sale_price, v_alloc, b.unit_cost, round(v_take*b.sale_price - v_alloc, 2));
        insert into stock_movements (batch_id, medicine_id, movement_type, qty_change, ref_table, ref_id, created_by)
        values (b.id, m.id, 'sale', -v_take, 'sales', v_id, uid);
        if v_alloc > round(v_take*b.sale_price,2) then raise exception 'Discount exceeds line amount for %', m.name; end if;
        v_sub := v_sub + round(v_take*b.sale_price, 2); v_idisc := v_idisc + v_alloc;
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then raise exception 'Insufficient stock for %', m.name; end if;
    end if;
  end loop;

  v_total := v_sub - v_idisc - v_bdisc;
  if v_total < 0 then raise exception 'Discount exceeds bill amount'; end if;

  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    if coalesce((pay->>'amount')::numeric,0) <= 0 then continue; end if;
    insert into sale_payments (sale_id, method, amount, kind, created_by)
    values (v_id, (pay->>'method')::pay_method, (pay->>'amount')::numeric, 'sale', uid);
    v_paid := v_paid + (pay->>'amount')::numeric;
  end loop;
  if v_paid > v_total then raise exception 'Paid amount (%) exceeds payable (%). Give change in cash outside the system.', v_paid, v_total; end if;
  if v_total - v_paid > 0 and v_cust is null then raise exception 'Select a customer for due/credit sales'; end if;

  update sales set subtotal = v_sub, item_discount = v_idisc, bill_discount = v_bdisc, total = v_total,
         paid = v_paid, due = v_total - v_paid where id = v_id;
  return jsonb_build_object('id', v_id, 'invoice_no', v_no, 'duplicate', false);
end $$;

revoke execute on function public.post_sale(jsonb) from public, anon;
revoke execute on function public.post_purchase(jsonb) from public, anon;
grant execute on function public.post_sale(jsonb) to authenticated;
grant execute on function public.post_purchase(jsonb) to authenticated;
