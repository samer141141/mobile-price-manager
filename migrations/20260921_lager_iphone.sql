-- Lager iPhone: additive schema changes and an authenticated, permission-checked API.
-- Run as postgres in Supabase SQL Editor, then bootstrap an Admin using README.md.
-- No existing phone or market-price rows are deleted, reset or rewritten.
begin;

do $$
declare missing text;
begin
 if to_regclass('public.phones') is null then
  raise exception 'Expected existing public.phones table. No changes applied.';
 end if;
 select string_agg(c, ', ') into missing from unnest(array['id','model','storage_gb','color','battery_health','condition','status','purchase_price','repair_cost','other_cost','selling_price','purchase_source','notes','created_at']) c
 where not exists(select 1 from information_schema.columns where table_schema='public' and table_name='phones' and column_name=c);
 if missing is not null then raise exception 'phones schema differs from the original application. Missing: %. Inspect before adapting this migration.',missing; end if;
end $$;

alter table public.phones add column if not exists imei text;
-- IMEI remains nullable; existing records do not need an invented identifier.
create table if not exists public.market_prices (
 id uuid primary key default gen_random_uuid(), model text, storage_gb integer,
 condition text, source text, market_price numeric, listing_url text,
 created_at timestamptz default now()
);
alter table public.market_prices add column if not exists model text;
alter table public.market_prices add column if not exists storage_gb integer;
alter table public.market_prices add column if not exists condition text;
alter table public.market_prices add column if not exists source text;
alter table public.market_prices add column if not exists market_price numeric;
alter table public.market_prices add column if not exists listing_url text;
alter table public.market_prices add column if not exists created_at timestamptz default now();

-- Fail safely for unknown required fields instead of deploying a broken insert API.
do $$
declare problem text;
begin
 select string_agg(table_name||'.'||column_name, ', ') into problem
 from information_schema.columns
 where table_schema='public' and table_name in ('phones','market_prices')
 and is_nullable='NO' and column_default is null and is_identity='NO' and is_generated='NEVER'
 and not(column_name=any(case when table_name='phones' then
 array['model','storage_gb','color','battery_health','condition','status','purchase_price','repair_cost','other_cost','selling_price','purchase_source','notes','imei','user_id']
 else array['model','storage_gb','condition','source','market_price','listing_url','user_id'] end));
 if problem is not null then raise exception 'Required columns without defaults need schema-specific handling: %. Transaction rolled back.',problem; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='phones' and column_name='imei' and data_type not in ('text','character varying','character')) then
  raise exception 'Existing IMEI column must be text to preserve leading zeros. Inspect schema before migration.';
 end if;
end $$;

create table if not exists public.lager_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','employee')),
 can_view_financials boolean not null default false,
 can_delete boolean not null default false
);
alter table public.lager_memberships enable row level security;
alter table public.phones enable row level security;
alter table public.market_prices enable row level security;

-- Direct table access is replaced with the narrowly scoped RPCs below. Existing
-- policies remain intact, but cannot override revoked table/column privileges.
revoke all on public.phones,public.market_prices,public.lager_memberships from public,anon,authenticated;
do $$
declare r record;
begin
 for r in select table_name,string_agg(quote_ident(column_name),',') cols
 from information_schema.columns where table_schema='public'
 and table_name in ('phones','market_prices','lager_memberships') group by table_name loop
 execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',r.cols,r.cols,r.cols,r.cols,r.table_name);
 end loop;
 -- Owner-executed views can otherwise bypass the underlying table grants.
 for r in select distinct v.oid::regclass as view_name from pg_class v
 join pg_rewrite rw on rw.ev_class=v.oid join pg_depend d on d.objid=rw.oid
 where v.relkind in ('v','m') and d.refobjid in ('public.phones'::regclass,'public.market_prices'::regclass,'public.lager_memberships'::regclass) loop
 execute format('revoke all on %s from public, anon, authenticated',r.view_name);
 end loop;
end $$;

create or replace function public.lager_access() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.lager_memberships;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into m from public.lager_memberships where user_id=auth.uid();
 if not found then raise exception 'Your account needs an Admin or Employee assignment' using errcode='42501'; end if;
 return jsonb_build_object('role',m.role,'can_view_financials',m.role='admin' or m.can_view_financials,'can_delete',m.role='admin' or m.can_delete);
end $$;

create or replace function public.lager_dashboard() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a jsonb:=public.lager_access(); p jsonb; m jsonb;
begin
 -- Explicit allowlist: unknown/generated financial columns never leak to Employees.
 select coalesce(jsonb_agg(visible order by created_at desc),'[]'::jsonb) into p from (
 select ph.created_at,
 (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(ph)) where key=any(
 array['id','model','storage_gb','color','battery_health','condition','imei','status','selling_price','purchase_source','notes','created_at'] ||
 case when (a->>'can_view_financials')::boolean then array['purchase_price','repair_cost','other_cost'] else array[]::text[] end)) visible
 from public.phones ph) rows;
 select coalesce(jsonb_agg(jsonb_build_object('model',model,'storage_gb',storage_gb,'condition',condition,'source',source,'market_price',market_price,'listing_url',listing_url) order by created_at desc),'[]'::jsonb) into m from public.market_prices;
 return jsonb_build_object('access',a,'phones',p,'market_prices',m);
end $$;

create or replace function public.lager_save_phone(phone_id text,payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a jsonb:=public.lager_access(); k text; cols text; vals text; changes text; previous jsonb; n integer;
 allowed text[]:=array['model','storage_gb','color','battery_health','condition','imei','status','selling_price','purchase_source','notes'];
begin
 if (a->>'can_view_financials')::boolean then allowed:=allowed||array['purchase_price','repair_cost','other_cost']; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or payload='{}'::jsonb then raise exception 'Phone information is required'; end if;
 if phone_id is not null then
  select to_jsonb(p) into previous from public.phones p where id::text=phone_id for update;
  if not found then raise exception 'Phone no longer exists. Refresh inventory.'; end if;
 end if;
 for k in select jsonb_object_keys(payload) loop
  if not k=any(allowed) then raise exception 'Field is not permitted: %',k using errcode='42501'; end if;
  -- Unchanged legacy values stay valid and are never normalized automatically.
  if previous is not null and payload->k=previous->k then continue; end if;
  if k='model' and coalesce(length(btrim(payload->>k)),0)=0 then raise exception 'Model is required'; end if;
  if k='storage_gb' and (payload->>k is null or (payload->>k)::numeric<=0 or (payload->>k)::numeric<>trunc((payload->>k)::numeric)) then raise exception 'Storage must be a positive whole number'; end if;
  if k in ('purchase_price','repair_cost','other_cost','selling_price') and (payload->>k is null or (payload->>k)::numeric<0 or (payload->>k) in ('NaN','Infinity','-Infinity')) then raise exception 'Prices and costs must be nonnegative numbers'; end if;
  if k='battery_health' and payload->>k is not null and ((payload->>k)::numeric not between 0 and 100 or (payload->>k)::numeric<>trunc((payload->>k)::numeric)) then raise exception 'Battery health must be a whole percentage between 0 and 100'; end if;
  if k='imei' and coalesce(payload->>k,'')<>'' and (payload->>k)!~'^[0-9]{15}$' then raise exception 'IMEI must contain 15 digits or be blank'; end if;
  if k='status' and coalesce(payload->>k,'') not in ('In Stock','Repairing','Listed','Sold') then raise exception 'Invalid phone status'; end if;
  if k='condition' and coalesce(payload->>k,'') not in ('Excellent','Good','Fair','Damaged') then raise exception 'Invalid condition'; end if;
 end loop;
 if phone_id is null then
  if coalesce(length(btrim(payload->>'model')),0)=0 or not payload?'storage_gb' then raise exception 'Model and storage are required'; end if;
  -- Defaults are only supplied on insert, never when an Employee edits an existing row.
  payload:=jsonb_build_object('purchase_price',0,'repair_cost',0,'other_cost',0,'selling_price',0,'status','In Stock','condition','Good')||payload;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='phones' and column_name='user_id') then payload:=payload||jsonb_build_object('user_id',auth.uid()); end if;
  select string_agg(format('%I',key),','),string_agg(format('r.%I',key),',') into cols,vals from jsonb_object_keys(payload) key;
  execute format('insert into public.phones (%s) select %s from jsonb_populate_record(null::public.phones,$1) r',cols,vals) using payload;
 else
  select string_agg(format('%I=r.%I',key,key),',') into changes from jsonb_object_keys(payload) key;
  execute format('update public.phones p set %s from jsonb_populate_record(null::public.phones,$1) r where p.id::text=$2',changes) using payload,phone_id;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Expected exactly one phone to update'; end if;
 end if;
end $$;

create or replace function public.lager_delete_phone(phone_id text) returns void
language plpgsql security definer set search_path='' as $$
declare a jsonb:=public.lager_access(); n integer;
begin
 if not (a->>'can_delete')::boolean then raise exception 'Deletion is restricted' using errcode='42501'; end if;
 delete from public.phones where id::text=phone_id;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Phone no longer exists'; end if;
end $$;

create or replace function public.lager_add_market(payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a jsonb:=public.lager_access(); k text; cols text; vals text;
begin
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Market information is required'; end if;
 for k in select jsonb_object_keys(payload) loop
  if k not in ('model','storage_gb','condition','source','market_price','listing_url') then raise exception 'Unknown field: %',k; end if;
 end loop;
 if coalesce(length(btrim(payload->>'model')),0)=0 then raise exception 'Model is required'; end if;
 if payload->>'storage_gb' is null or (payload->>'storage_gb')::numeric<=0 or (payload->>'storage_gb')::numeric<>trunc((payload->>'storage_gb')::numeric) then raise exception 'Storage must be a positive whole number'; end if;
 if coalesce(payload->>'condition','') not in ('Excellent','Good','Fair','Damaged') then raise exception 'Invalid condition'; end if;
 if coalesce(payload->>'source','') not in ('Tradera','Blocket','Swappie','Back Market','Other') then raise exception 'Invalid market source'; end if;
 if payload->>'market_price' is null or (payload->>'market_price')::numeric<=0 or (payload->>'market_price') in ('NaN','Infinity','-Infinity') then raise exception 'Market price must be positive'; end if;
 if coalesce(payload->>'listing_url','')<>'' and (payload->>'listing_url')!~*'^https?://' then raise exception 'Listing URL must start with http:// or https://'; end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='market_prices' and column_name='user_id') then payload:=payload||jsonb_build_object('user_id',auth.uid()); end if;
 select string_agg(format('%I',key),','),string_agg(format('r.%I',key),',') into cols,vals from jsonb_object_keys(payload) key;
 execute format('insert into public.market_prices (%s) select %s from jsonb_populate_record(null::public.market_prices,$1) r',cols,vals) using payload;
end $$;

create or replace function public.lager_members() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if public.lager_access()->>'role'<>'admin' then raise exception 'Admin access required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('email',u.email) order by u.email),'[]'::jsonb) from public.lager_memberships m join auth.users u on u.id=m.user_id);
end $$;

create or replace function public.lager_set_member(member_email text,member_role text,financial_access boolean,delete_access boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if public.lager_access()->>'role'<>'admin' then raise exception 'Admin access required' using errcode='42501'; end if;
 if member_role is null or member_role not in ('admin','employee') then raise exception 'Invalid role'; end if;
 select id into target from auth.users where lower(email)=lower(btrim(member_email));
 if target is null then raise exception 'No Supabase Auth user has that email'; end if;
 if target=auth.uid() and member_role<>'admin' then raise exception 'You cannot demote your own Admin account'; end if;
 insert into public.lager_memberships(user_id,role,can_view_financials,can_delete)
 values(target,member_role,member_role='admin' or coalesce(financial_access,false),member_role='admin' or coalesce(delete_access,false))
 on conflict(user_id) do update set role=excluded.role,can_view_financials=excluded.can_view_financials,can_delete=excluded.can_delete;
end $$;

do $$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('lager_access','lager_dashboard','lager_save_phone','lager_delete_phone','lager_add_market','lager_members','lager_set_member') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to authenticated',f);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
