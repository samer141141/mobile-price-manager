-- Secure IMEI provider integration using Supabase Vault.
-- Applied to production on 2026-09-26.

create or replace function public.lager_set_imei_provider(
  provider_token text,
  provider_service_id integer default 1
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a jsonb:=public.lager_access();
  existing_id uuid;
  cfg jsonb;
begin
  if coalesce(a->>'role','') <> 'admin' then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if coalesce(length(btrim(provider_token)),0) < 8 then
    raise exception 'A valid IMEI provider API token is required';
  end if;
  if provider_service_id is null or provider_service_id <= 0 then
    raise exception 'Service ID must be a positive number';
  end if;

  cfg := jsonb_build_object(
    'provider','imeicheck.net',
    'token',btrim(provider_token),
    'serviceId',provider_service_id,
    'updatedAt',now()
  );

  select id into existing_id
  from vault.decrypted_secrets
  where name='lager_imeicheck_config'
  limit 1;

  if existing_id is null then
    perform vault.create_secret(
      cfg::text,
      'lager_imeicheck_config',
      'Lager iPhone IMEIcheck.net API configuration'
    );
  else
    perform vault.update_secret(
      existing_id,
      cfg::text,
      'lager_imeicheck_config',
      'Lager iPhone IMEIcheck.net API configuration'
    );
  end if;

  insert into public.lager_activity_log(actor_id,action,phone_label,detail,metadata)
  values (
    auth.uid(),
    'IMEI provider configured',
    'System',
    'IMEIcheck.net API connection updated by Admin.',
    jsonb_build_object('serviceId',provider_service_id)
  );

  return jsonb_build_object(
    'configured',true,
    'provider','IMEIcheck.net',
    'serviceId',provider_service_id
  );
end
$$;

revoke all on function public.lager_set_imei_provider(text,integer) from public, anon;
grant execute on function public.lager_set_imei_provider(text,integer) to authenticated;

create or replace function public.lager_imei_provider_status()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a jsonb:=public.lager_access();
  raw text;
  cfg jsonb;
begin
  if coalesce(a->>'role','') <> 'admin' then
    raise exception 'Admin access required' using errcode='42501';
  end if;

  select decrypted_secret into raw
  from vault.decrypted_secrets
  where name='lager_imeicheck_config'
  limit 1;

  if raw is null then
    return jsonb_build_object(
      'configured',false,
      'provider','IMEIcheck.net',
      'serviceId',1
    );
  end if;

  cfg := raw::jsonb;
  return jsonb_build_object(
    'configured',coalesce(length(cfg->>'token'),0) >= 8,
    'provider',coalesce(cfg->>'provider','imeicheck.net'),
    'serviceId',coalesce((cfg->>'serviceId')::integer,1),
    'updatedAt',cfg->>'updatedAt'
  );
end
$$;

revoke all on function public.lager_imei_provider_status() from public, anon;
grant execute on function public.lager_imei_provider_status() to authenticated;

create or replace function public.lager_edge_imei_config()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  raw text;
begin
  select decrypted_secret into raw
  from vault.decrypted_secrets
  where name='lager_imeicheck_config'
  limit 1;

  if raw is null then
    return jsonb_build_object('configured',false);
  end if;

  return (raw::jsonb) || jsonb_build_object('configured',true);
end
$$;

revoke all on function public.lager_edge_imei_config() from public, anon, authenticated;
grant execute on function public.lager_edge_imei_config() to service_role;
