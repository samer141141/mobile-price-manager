-- Lager iPhone professional operations upgrade
-- Applied to production on 2026-09-26. Additive only; preserves existing inventory and sales.

create table if not exists public.lager_phone_qc (
  phone_id bigint primary key references public.phones(id) on delete cascade,
  tests jsonb not null default '{}'::jsonb,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.lager_phone_qc enable row level security;

alter table public.repairs
  add column if not exists part_id bigint references public.spare_parts(id) on delete set null,
  add column if not exists part_quantity integer not null default 0,
  add column if not exists status text not null default 'Open',
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='repairs_part_quantity_check' and conrelid='public.repairs'::regclass) then
    alter table public.repairs add constraint repairs_part_quantity_check check (part_quantity between 0 and 99);
  end if;
  if not exists (select 1 from pg_constraint where conname='repairs_status_check' and conrelid='public.repairs'::regclass) then
    alter table public.repairs add constraint repairs_status_check check (status in ('Open','Completed','Cancelled'));
  end if;
end $$;

alter table public.lager_sale_history
  add column if not exists platform_fee numeric not null default 0,
  add column if not exists shipping_cost numeric not null default 0,
  add column if not exists tax_mode text not null default 'Not set',
  add column if not exists vat_cost numeric not null default 0,
  add column if not exists gross_margin numeric not null default 0,
  add column if not exists margin_percent numeric not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='lager_sale_history_extra_costs_check' and conrelid='public.lager_sale_history'::regclass) then
    alter table public.lager_sale_history add constraint lager_sale_history_extra_costs_check check (platform_fee >= 0 and shipping_cost >= 0 and vat_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='lager_sale_history_tax_mode_check' and conrelid='public.lager_sale_history'::regclass) then
    alter table public.lager_sale_history add constraint lager_sale_history_tax_mode_check check (tax_mode in ('Not set','VMB','Normal VAT','No VAT / Other'));
  end if;
end $$;

create or replace function public.lager_operations_state()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare a jsonb:=public.lager_access(); result jsonb;
begin
  select coalesce(
    jsonb_object_agg(
      p.id::text,
      jsonb_build_object(
        'tests',coalesce(q.tests,'{}'::jsonb),
        'repairs',coalesce(r.repairs,'[]'::jsonb)
      )
    ),
    '{}'::jsonb
  ) into result
  from public.phones p
  left join public.lager_phone_qc q on q.phone_id=p.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id',x.id::text,
        'description',x.repair_type,
        'part',coalesce(sp.part_type,x.notes,''),
        'partId',x.part_id,
        'partQuantity',x.part_quantity,
        'cost',case when (a->>'can_view_financials')::boolean then coalesce(x.repair_cost,0) else 0 end,
        'technician',coalesce(x.repair_shop,''),
        'startedAt',coalesce(x.started_at,x.created_at),
        'completedAt',x.completed_at,
        'status',x.status
      ) order by coalesce(x.started_at,x.created_at)
    ) repairs
    from public.repairs x
    left join public.spare_parts sp on sp.id=x.part_id
    where x.phone_id=p.id
  ) r on true;
  return result;
end
$function$;

create or replace function public.lager_set_qc(phone_id text,test_name text,test_result text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a jsonb:=public.lager_access();
  pid bigint;
  allowed_tests text[]:=array[
    'Face ID / Touch ID','Display & touch','True Tone','Dead pixels / burn-in',
    'Front camera','Rear wide camera','Rear ultra-wide / telephoto','Camera focus & flash',
    'Microphone','Earpiece','Loudspeaker','Charging port','Wireless charging / MagSafe',
    'Wi-Fi','Bluetooth','Cellular / SIM','Buttons / silent / action button',
    'Vibration / haptics','Proximity sensor','Auto-brightness sensor','GPS / location',
    'Battery / charging behavior','Liquid damage / corrosion','Back glass / frame / screws'
  ];
begin
  if test_name is null or not test_name=any(allowed_tests) then raise exception 'Invalid device test'; end if;
  if test_result not in ('Pass','Fail','N/A','Pending') then raise exception 'Invalid test result'; end if;
  select id into pid from public.phones where id::text=phone_id;
  if pid is null then raise exception 'Phone no longer exists'; end if;

  insert into public.lager_phone_qc(phone_id,tests,updated_at,updated_by)
  values(pid,case when test_result='Pending' then '{}'::jsonb else jsonb_build_object(test_name,test_result) end,now(),auth.uid())
  on conflict(phone_id) do update
  set tests=case
      when test_result='Pending' then coalesce(public.lager_phone_qc.tests,'{}'::jsonb)-test_name
      else jsonb_set(coalesce(public.lager_phone_qc.tests,'{}'::jsonb),array[test_name],to_jsonb(test_result),true)
    end,
    updated_at=now(),updated_by=auth.uid();

  insert into public.lager_activity_log(actor_id,action,phone_id,phone_label,detail)
  select auth.uid(),'Device test',p.id::text,
    concat_ws(' ',p.model,case when p.storage_gb is not null then p.storage_gb||'GB' end),
    test_name||': '||test_result
  from public.phones p where p.id=pid;
end
$function$;

create or replace function public.lager_add_repair(
  phone_id text, description text, part_id text default null, manual_part text default null,
  part_quantity integer default 1, labor_cost numeric default 0, technician text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a jsonb:=public.lager_access();
  p public.phones;
  sp public.spare_parts;
  pid bigint;
  chosen_part_id bigint;
  qty integer:=greatest(coalesce(part_quantity,1),1);
  part_cost numeric:=0;
  extra_cost numeric:=0;
  total_cost numeric:=0;
  rid bigint;
  part_label text;
begin
  if coalesce(btrim(description),'')='' then raise exception 'Repair description is required'; end if;
  if qty>99 then raise exception 'Part quantity is too high'; end if;
  if coalesce(labor_cost,0)<0 then raise exception 'Repair cost cannot be negative'; end if;

  select * into p from public.phones where id::text=phone_id for update;
  if not found then raise exception 'Phone no longer exists'; end if;
  pid:=p.id;

  if part_id is not null and btrim(part_id)<>'' then
    select * into sp from public.spare_parts where id::text=part_id for update;
    if not found then raise exception 'Selected spare part no longer exists'; end if;
    if sp.quantity<qty then raise exception 'Not enough spare parts in stock'; end if;
    chosen_part_id:=sp.id;
    part_cost:=coalesce(sp.unit_cost,0)*qty;
    part_label:=concat_ws(' · ',sp.device_model,sp.part_type);
    update public.spare_parts set quantity=quantity-qty,updated_at=now() where id=sp.id;
  else
    qty:=0;
    part_label:=nullif(btrim(coalesce(manual_part,'')),'');
  end if;

  if (a->>'can_view_financials')::boolean then extra_cost:=coalesce(labor_cost,0); end if;
  total_cost:=part_cost+extra_cost;

  insert into public.repairs(
    phone_id,repair_type,repair_cost,repair_shop,repair_date,notes,user_id,
    part_id,part_quantity,status,started_at,updated_at
  ) values(
    pid,left(btrim(description),240),total_cost,nullif(left(btrim(coalesce(technician,'')),160),''),
    current_date,part_label,auth.uid(),chosen_part_id,qty,'Open',now(),now()
  ) returning id into rid;

  update public.phones
  set repair_cost=coalesce(repair_cost,0)+total_cost,status='Repairing',updated_at=now()
  where id=pid;

  insert into public.lager_activity_log(actor_id,action,phone_id,phone_label,detail)
  values(auth.uid(),'Repair added',pid::text,
    concat_ws(' ',p.model,case when p.storage_gb is not null then p.storage_gb||'GB' end),
    concat(left(btrim(description),160),
      case when part_label is not null then ' · '||part_label else '' end,
      case when total_cost>0 then ' · '||total_cost||' SEK' else '' end));

  return jsonb_build_object(
    'id',rid::text,'description',left(btrim(description),240),'part',coalesce(part_label,''),
    'partId',chosen_part_id,'partQuantity',qty,
    'cost',case when (a->>'can_view_financials')::boolean then total_cost else 0 end,
    'technician',coalesce(technician,''),'startedAt',now(),'completedAt',null,'status','Open'
  );
end
$function$;

create or replace function public.lager_complete_repair(repair_id text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare a jsonb:=public.lager_access(); r public.repairs; p public.phones;
begin
  select * into r from public.repairs where id::text=repair_id for update;
  if not found then raise exception 'Repair no longer exists'; end if;
  if r.status='Completed' then return; end if;
  update public.repairs set status='Completed',completed_at=now(),updated_at=now() where id=r.id;
  select * into p from public.phones where id=r.phone_id for update;
  if found and not exists(select 1 from public.repairs where phone_id=r.phone_id and status='Open') then
    update public.phones set status='In Stock',updated_at=now() where id=r.phone_id and status='Repairing';
  end if;
  insert into public.lager_activity_log(actor_id,action,phone_id,phone_label,detail)
  values(auth.uid(),'Repair completed',r.phone_id::text,
    case when p.id is not null then concat_ws(' ',p.model,case when p.storage_gb is not null then p.storage_gb||'GB' end) end,
    r.repair_type);
end
$function$;

create or replace function public.lager_complete_sale(phone_id text,sale_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a jsonb:=public.lager_access();
  p public.phones;
  final_price numeric;
  months integer;
  sold_date date:=current_date;
  platform_fee numeric:=0;
  shipping_cost numeric:=0;
  tax_mode text:='Not set';
  vat_cost numeric:=0;
  purchase numeric:=0;
  repairs numeric:=0;
  other numeric:=0;
  gross_margin numeric:=0;
  realized numeric:=0;
  margin_pct numeric:=0;
begin
  if not (a->>'can_view_financials')::boolean then raise exception 'Financial access required' using errcode='42501'; end if;
  select * into p from public.phones where id::text=phone_id for update;
  if not found then raise exception 'Phone no longer exists'; end if;
  if p.status='Sold' then raise exception 'Phone is already sold'; end if;

  final_price:=coalesce(nullif(sale_meta->>'price','')::numeric,p.selling_price,0);
  if final_price<=0 then raise exception 'Final selling price is required'; end if;
  months:=coalesce(nullif(sale_meta->>'warrantyMonths','')::integer,3);
  if months<0 or months>36 then raise exception 'Warranty must be between 0 and 36 months'; end if;
  platform_fee:=coalesce(nullif(sale_meta->>'platformFee','')::numeric,0);
  shipping_cost:=coalesce(nullif(sale_meta->>'shippingCost','')::numeric,0);
  if platform_fee<0 or shipping_cost<0 then raise exception 'Sale costs must be nonnegative'; end if;

  tax_mode:=coalesce(nullif(sale_meta->>'taxMode',''),'Not set');
  if tax_mode not in ('Not set','VMB','Normal VAT','No VAT / Other') then raise exception 'Invalid VAT mode'; end if;

  purchase:=coalesce(p.purchase_price,0);
  repairs:=coalesce(p.repair_cost,0);
  other:=coalesce(p.other_cost,0);
  gross_margin:=final_price-purchase;

  if coalesce(sale_meta->>'vatCost','')<>'' then
    vat_cost:=(sale_meta->>'vatCost')::numeric;
  elsif tax_mode='VMB' then
    vat_cost:=greatest(gross_margin,0)/5;
  elsif tax_mode='Normal VAT' then
    vat_cost:=final_price/5;
  else
    vat_cost:=0;
  end if;
  if vat_cost<0 then raise exception 'VAT cost must be nonnegative'; end if;

  realized:=final_price-purchase-repairs-other-platform_fee-shipping_cost-vat_cost;
  margin_pct:=case when final_price>0 then (realized/final_price)*100 else 0 end;

  update public.phones set selling_price=final_price,status='Sold',updated_at=now() where id=p.id;

  insert into public.lager_sale_history(
    phone_id,inventory_scope,model,storage_gb,grade,condition,
    purchase_price,repair_cost,other_cost,selling_price,realized_profit,sold_by,
    buyer_name,buyer_contact,payment,sales_channel,order_ref,warranty_months,warranty_until,
    platform_fee,shipping_cost,tax_mode,vat_cost,gross_margin,margin_percent
  ) values(
    p.id::text,p.inventory_scope,p.model,p.storage_gb,p.grade,p.condition,
    purchase,repairs,other,final_price,realized,auth.uid(),
    nullif(left(coalesce(sale_meta->>'buyer',''),200),''),
    nullif(left(coalesce(sale_meta->>'contact',''),240),''),
    nullif(left(coalesce(sale_meta->>'payment',''),80),''),
    nullif(left(coalesce(sale_meta->>'channel',''),80),''),
    nullif(left(coalesce(sale_meta->>'orderRef',''),160),''),
    months,case when months>0 then sold_date+make_interval(months=>months) else sold_date end,
    platform_fee,shipping_cost,tax_mode,vat_cost,gross_margin,margin_pct
  );

  insert into public.lager_activity_log(actor_id,action,phone_id,phone_label,detail)
  values(auth.uid(),'Phone sold',p.id::text,
    concat_ws(' ',p.model,case when p.storage_gb is not null then p.storage_gb||'GB' end),
    concat(final_price,' SEK · ',coalesce(sale_meta->>'channel','Direct'),' · Net ',round(realized,2),
      ' SEK · ',tax_mode,' · Warranty ',months,' month(s)'));
end
$function$;

revoke execute on function public.lager_operations_state() from PUBLIC, anon;
revoke execute on function public.lager_set_qc(text,text,text) from PUBLIC, anon;
revoke execute on function public.lager_add_repair(text,text,text,text,integer,numeric,text) from PUBLIC, anon;
revoke execute on function public.lager_complete_repair(text) from PUBLIC, anon;

grant execute on function public.lager_operations_state() to authenticated;
grant execute on function public.lager_set_qc(text,text,text) to authenticated;
grant execute on function public.lager_add_repair(text,text,text,text,integer,numeric,text) to authenticated;
grant execute on function public.lager_complete_repair(text) to authenticated;
