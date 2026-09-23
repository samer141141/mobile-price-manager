-- Cloud photo storage for Lager iPhone.
-- Keeps phone photos available across computers and phones for authenticated team members.
begin;

create or replace function public.lager_has_access()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.lager_memberships m
      where m.user_id = auth.uid()
    );
$$;

revoke all on function public.lager_has_access() from public, anon, authenticated;
grant execute on function public.lager_has_access() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'phone-photos',
  'phone-photos',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "lager_phone_photos_select" on storage.objects;
create policy "lager_phone_photos_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'phone-photos'
  and public.lager_has_access()
);

drop policy if exists "lager_phone_photos_insert" on storage.objects;
create policy "lager_phone_photos_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'phone-photos'
  and public.lager_has_access()
);

drop policy if exists "lager_phone_photos_update" on storage.objects;
create policy "lager_phone_photos_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'phone-photos'
  and public.lager_has_access()
)
with check (
  bucket_id = 'phone-photos'
  and public.lager_has_access()
);

drop policy if exists "lager_phone_photos_delete" on storage.objects;
create policy "lager_phone_photos_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'phone-photos'
  and public.lager_has_access()
);

commit;
