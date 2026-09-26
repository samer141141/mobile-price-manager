alter table public.phones
  add column if not exists imei_check jsonb,
  add column if not exists imei_checked_at timestamptz;

create unique index if not exists phones_imei_unique_nonblank
  on public.phones (imei)
  where imei is not null and btrim(imei) <> '';

create or replace function public.lager_record_imei_check(
  device_imei text,
  check_result jsonb
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  a jsonb:=public.lager_access();
  affected integer;
begin
  if coalesce(device_imei,'') !~ '^[0-9]{15}$' then
    raise exception 'IMEI must contain 15 digits';
  end if;
  if check_result is null or jsonb_typeof(check_result) <> 'object' then
    raise exception 'IMEI check result must be an object';
  end if;

  update public.phones
  set imei_check=check_result,
      imei_checked_at=coalesce(nullif(check_result->>'checked_at','')::timestamptz,now()),
      updated_at=now()
  where imei=device_imei;

  get diagnostics affected=row_count;
  if affected>1 then raise exception 'Multiple phones use this IMEI'; end if;

  if affected=1 then
    insert into public.lager_activity_log(actor_id,action,phone_id,phone_label,detail,metadata)
    select auth.uid(),'IMEI checked',p.id::text,
      concat_ws(' ',p.model,nullif(p.storage_gb::text,'')||'GB'),
      concat(
        'Blacklist: ',coalesce(check_result->>'blacklist','Unknown'),
        ' · SIM: ',coalesce(check_result->>'sim_lock','Unknown'),
        ' · FMI: ',coalesce(check_result->>'fmi','Unknown')
      ),
      jsonb_build_object('provider',check_result->>'provider','checked_at',check_result->>'checked_at')
    from public.phones p where p.imei=device_imei;
  end if;

  return affected=1;
end
$$;

revoke all on function public.lager_record_imei_check(text,jsonb) from public, anon;
grant execute on function public.lager_record_imei_check(text,jsonb) to authenticated;

create or replace function public.lager_dashboard()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare a jsonb:=public.lager_access(); p jsonb; m jsonb; h jsonb;
begin
 select coalesce(jsonb_agg(visible order by created_at desc),'[]'::jsonb) into p from (
 select ph.created_at,
 (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(ph)) where key=any(
 array[
   'id','model','storage_gb','color','grade','battery_health','condition',
   'imei','imei_check','imei_checked_at','status','selling_price',
   'purchase_source','purchase_date','notes','inventory_scope',
   'created_at','updated_at'
 ] ||
 case when (a->>'can_view_financials')::boolean
   then array['purchase_price','repair_cost','other_cost']
   else array[]::text[]
 end)) visible
 from public.phones ph) rows;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'model',model,'storage_gb',storage_gb,'condition',condition,
   'source',source,'market_price',market_price,'listing_url',listing_url
 ) order by created_at desc),'[]'::jsonb) into m from public.market_prices;
 select case when (a->>'can_view_financials')::boolean
   then coalesce(jsonb_agg(to_jsonb(sh) order by sold_at desc),'[]'::jsonb)
   else '[]'::jsonb
 end into h
 from public.lager_sale_history sh where inventory_scope='business';
 return jsonb_build_object('access',a,'phones',p,'market_prices',m,'sale_history',h);
end
$$;
