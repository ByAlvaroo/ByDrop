-- =====================================================================
--  ByDrop · Configuración de Supabase
--  Copia TODO este archivo en Supabase → SQL Editor → New query → Run
--  Se puede ejecutar varias veces sin romper nada.
--  HECHO POR @BYALVARO__
-- =====================================================================

-- 1) Tabla de elementos (textos y archivos de la nube)
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('text', 'file')),
  text        text,
  file_path   text,
  file_name   text,
  file_size   bigint,
  mime        text,
  device      text,
  pinned      boolean not null default false,
  share_code  text unique,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists items_user_created_idx on public.items (user_id, created_at desc);

alter table public.items enable row level security;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items for select to authenticated using (user_id = auth.uid());
create policy "items_insert_own" on public.items for insert to authenticated with check (user_id = auth.uid());
create policy "items_update_own" on public.items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "items_delete_own" on public.items for delete to authenticated using (user_id = auth.uid());

-- 2) Tiempo real: que los cambios lleguen al instante a tus otros dispositivos
do $$
begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;

-- 3) Enlaces para compartir con amigos (sin que tengan cuenta)
create or replace function public.get_shared(code text)
returns table (kind text, text text, file_path text, file_name text, file_size bigint, mime text, expires_at timestamptz, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select i.kind, i.text, i.file_path, i.file_name, i.file_size, i.mime, i.expires_at, i.created_at
  from public.items i
  where i.share_code = code
    and (i.expires_at is null or i.expires_at > now())
  limit 1;
$$;

create or replace function public.is_shared_path(p text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.items i
    where i.file_path = p
      and i.share_code is not null
      and (i.expires_at is null or i.expires_at > now())
  );
$$;

grant execute on function public.get_shared(text) to anon, authenticated;
grant execute on function public.is_shared_path(text) to anon, authenticated;

-- 4) Almacenamiento de archivos (bucket privado, máx. 50 MB por archivo en el plan gratis)
insert into storage.buckets (id, name, public, file_size_limit)
values ('bydrop', 'bydrop', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "bydrop_read_own"    on storage.objects;
drop policy if exists "bydrop_insert_own"  on storage.objects;
drop policy if exists "bydrop_delete_own"  on storage.objects;
drop policy if exists "bydrop_read_shared" on storage.objects;

create policy "bydrop_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'bydrop' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bydrop_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'bydrop' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bydrop_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'bydrop' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "bydrop_read_shared" on storage.objects for select to anon, authenticated
  using (bucket_id = 'bydrop' and public.is_shared_path(name));

-- Listo ✅
