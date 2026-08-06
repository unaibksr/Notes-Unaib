-- Student Notes — Supabase schema
-- Run this in Supabase Dashboard → SQL Editor

-- Extensions (gen_random_uuid is built-in on Supabase)
create extension if not exists "pgcrypto";

-- ─── Students ───────────────────────────────────────────────────────────────

create table if not exists public.students (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists students_user_id_idx on public.students (user_id);
create index if not exists students_updated_at_idx on public.students (updated_at desc);

-- ─── Notes ──────────────────────────────────────────────────────────────────

create table if not exists public.notes (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  student_id  text not null references public.students (id) on delete cascade,
  title       text not null default '',
  content     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists notes_user_id_idx on public.notes (user_id);
create index if not exists notes_student_id_idx on public.notes (student_id);
create index if not exists notes_updated_at_idx on public.notes (updated_at desc);

-- ─── Auto-update updated_at ─────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.students enable row level security;
alter table public.notes enable row level security;

-- This is intentionally one public notebook with no sign-in. RLS remains on
-- and limits browser access to the single shared owner ID used by the app.
drop policy if exists "Users read own students" on public.students;
drop policy if exists "Users insert own students" on public.students;
drop policy if exists "Users update own students" on public.students;
drop policy if exists "Users delete own students" on public.students;
drop policy if exists "Users read own notes" on public.notes;
drop policy if exists "Users insert own notes" on public.notes;
drop policy if exists "Users update own notes" on public.notes;
drop policy if exists "Users delete own notes" on public.notes;

drop policy if exists "Shared notebook students" on public.students;
create policy "Shared notebook students"
  on public.students for all
  to anon, authenticated
  using (user_id = 'ee6bf612-7aae-450c-a3d7-53aa97a513fc'::uuid)
  with check (user_id = 'ee6bf612-7aae-450c-a3d7-53aa97a513fc'::uuid);

drop policy if exists "Shared notebook notes" on public.notes;
create policy "Shared notebook notes"
  on public.notes for all
  to anon, authenticated
  using (user_id = 'ee6bf612-7aae-450c-a3d7-53aa97a513fc'::uuid)
  with check (user_id = 'ee6bf612-7aae-450c-a3d7-53aa97a513fc'::uuid);

grant select, insert, update, delete on table public.students to anon, authenticated;
grant select, insert, update, delete on table public.notes to anon, authenticated;

-- ─── Realtime (optional — enable in Dashboard → Database → Replication) ───────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'students'
  ) then
    alter publication supabase_realtime add table public.students;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end
$$;
