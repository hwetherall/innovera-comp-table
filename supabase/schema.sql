create extension if not exists pgcrypto;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  title text not null,
  created_at timestamptz not null default now(),
  json_path text not null,
  html_path text,
  is_public boolean not null default true
);

alter table public.reports enable row level security;

drop policy if exists "Public reports are readable" on public.reports;
create policy "Public reports are readable"
on public.reports
for select
using (is_public = true);

insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Public report objects are readable" on storage.objects;
create policy "Public report objects are readable"
on storage.objects
for select
using (
  bucket_id = 'reports'
  and exists (
    select 1
    from public.reports r
    where r.json_path = storage.objects.name
      and r.is_public = true
  )
);
