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

-- Students policies
drop policy if exists "Users read own students" on public.students;
create policy "Users read own students"
  on public.students for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own students" on public.students;
create policy "Users insert own students"
  on public.students for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own students" on public.students;
create policy "Users update own students"
  on public.students for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own students" on public.students;
create policy "Users delete own students"
  on public.students for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Notes policies
drop policy if exists "Users read own notes" on public.notes;
create policy "Users read own notes"
  on public.notes for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own notes" on public.notes;
create policy "Users insert own notes"
  on public.notes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own notes" on public.notes;
create policy "Users update own notes"
  on public.notes for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own notes" on public.notes;
create policy "Users delete own notes"
  on public.notes for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Data API privileges. RLS policies above still enforce per-user ownership.
revoke all on table public.students from anon;
revoke all on table public.notes from anon;
grant select, insert, update, delete on table public.students to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

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
